import { AdaptivePlaywrightCrawler } from '@crawlee/playwright';
import { logger } from '../logger.js';
import { validateUrlSafety } from '../utils/ssrf.js';
import { PageLoader } from '../utils/pageLoader.js';
import { createPageLoader } from '../utils/pageLoader.js';

export class CrawleeService {
  constructor(config) {
    this.config = config;
    this.crawler = null;
    this.results = new Map(); // Store results temporarily
    this.initializeCrawler();
  }

  initializeCrawler() {
    // Store reference to results map and loading strategy for use in request handler
    const resultsMap = this.results;
    const loadingStrategy = this.config.loadingStrategy || 'thorough';
    
    const crawlerConfig = {
      // Adaptive crawler automatically switches between HTTP and browser
      renderingTypeDetectionRatio: 0.1, // Test 10% with browser to learn
      
      // Session management for proxy rotation and state persistence
      sessionPoolOptions: {
        maxPoolSize: this.config.maxSessions || 20,
        sessionOptions: {
          maxUsageCount: 50, // Retire sessions after 50 uses
          maxErrorScore: 3,  // Retire on 3 errors
        },
      },

      // Browser fingerprint configuration (simplified)
      browserPoolOptions: {
        useFingerprints: true, // Enable by default
      },

      // Proxy configuration
      proxyConfiguration: this.createProxyConfiguration(),

      // Request timeout
      requestHandlerTimeoutSecs: Math.floor(this.config.timeoutMs / 1000) || 30,

      // Retry configuration
      maxRequestRetries: this.config.maxRetries || 2,

      // Request handler
      async requestHandler({ page, request, response }) {
        try {
          logger.info({ url: request.url }, 'Processing request with Crawlee');
          
          // Create page loader with configuration
          const pageLoader = createPageLoader(loadingStrategy);
          pageLoader.options.maxWaitTime = crawlerConfig.requestHandlerTimeoutSecs * 1000;
          
          // Use advanced page loading detection
          const loadResult = await pageLoader.waitForPageLoad(page, request.url);
          
          // Get status code safely - AdaptivePlaywrightCrawler may not provide response object
          let statusCode = 200; // Default to 200 for successful requests
          if (response) {
            if (typeof response.status === 'function') {
              statusCode = response.status();
            } else if (typeof response.status === 'number') {
              statusCode = response.status;
            } else if (response.statusCode) {
              statusCode = response.statusCode;
            }
          }
          
          // Use the best available content
          const html = loadResult.content;
          
          // Store result in temporary map with enhanced metrics
          const resultData = {
            url: request.url,
            html,
            status: statusCode,
            timestamp: new Date().toISOString(),
            metrics: loadResult.metrics,
            success: loadResult.success,
            fallback: loadResult.fallback,
            capturedVersions: loadResult.capturedVersions?.length || 0,
          };
          resultsMap.set(request.url, resultData);
          
          logger.info({
            url: request.url,
            contentLength: html.length,
            loadingMetrics: loadResult.metrics,
            success: loadResult.success
          }, 'Page content captured');

          return { html, status: statusCode };
        } catch (error) {
          logger.warn({ url: request.url, error: error.message }, 'Request handler error');
          throw error;
        }
      },

      // Failed request handler
      async failedRequestHandler({ request }) {
        logger.error({ url: request.url }, 'Request failed after all retries');
      },
    };

    this.crawler = new AdaptivePlaywrightCrawler(crawlerConfig);
  }

  createProxyConfiguration() {
    if (!this.config.proxies || this.config.proxies.length === 0) {
      return undefined;
    }

    // Convert proxy strings to Crawlee format
    const proxyUrls = this.config.proxies.map(proxy => {
      if (typeof proxy === 'string') {
        return proxy;
      }
      // Handle proxy objects if needed
      return `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`;
    });

    return {
      proxyUrls,
      // Session affinity - use same proxy for related requests
      sessionPoolOptions: {
        sessionOptions: {
          maxUsageCount: 50,
        },
      },
    };
  }

  async fetch(url, options = {}) {
    try {
      // SSRF validation
      await validateUrlSafety(url, {
        allowPrivateNetworks: this.config.allowPrivateNetworks,
        blocklistHosts: this.config.blocklistHosts,
      });

      logger.info({ url, mode: 'adaptive' }, 'Starting Crawlee fetch');

      // Clear previous results
      this.results.clear();
      
      // Create a new crawler instance for each request to avoid state issues
      const crawlerConfig = {
        maxRequestRetries: this.config.maxRetries || 3,
        requestHandlerTimeoutSecs: 60,
        
        // Browser pool configuration
        browserPoolOptions: {
          useFingerprints: true,
          maxOpenPagesPerBrowser: 1,
        },
        
        // Proxy configuration
        proxyConfiguration: this.createProxyConfiguration(),
        
        // Request handler
        requestHandler: async ({ request, page, response }) => {
          logger.info({ url: request.url }, 'Processing request with Crawlee');
          
          const pageLoader = new PageLoader({
            maxWaitTime: 30000,
            strategies: ['networkIdle', 'domContentLoaded'],
          });
          
          const result = await pageLoader.waitForPageLoad(page, request.url);
          
          // Store result
          this.results.set(request.url, {
            html: result.content,
            status: response?.status || 200,
            metadata: result.metrics,
          });
        },
        
        // Failed request handler
        failedRequestHandler: async ({ request }) => {
          logger.error({ url: request.url }, 'Request failed after all retries');
        },
      };

      const crawler = new AdaptivePlaywrightCrawler(crawlerConfig);
      
      // Add request to crawler
      await crawler.addRequests([{
        url,
        userData: {
          mode: options.mode || 'adaptive',
          timestamp: Date.now(),
        },
      }]);

      // Run the crawler
      await crawler.run();

      // Retrieve result from temporary storage
      const result = this.results.get(url);
      
      if (!result) {
        logger.error({ url }, 'No data retrieved from crawler');
        throw new Error('No data retrieved from crawler');
      }
      
      return {
        body: result.html,
        status: result.status,
        adapter: 'crawlee-adaptive',
      };

    } catch (error) {
      logger.error({ url, error: error.message }, 'Crawlee fetch failed');
      throw error;
    }
  }

  async close() {
    if (this.crawler && typeof this.crawler.teardown === 'function') {
      try {
        await this.crawler.teardown();
      } catch (error) {
        logger.warn({ error: error.message }, 'Error during crawler teardown');
      }
    }
  }
}
