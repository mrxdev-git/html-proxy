import { CheerioCrawler } from 'crawlee';
import { BaseAdapter } from './base.js';
import { logger } from '../logger.js';

export class CrawleeHttpAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.config = config;
    this.crawler = null;
    this.results = new Map(); // Store results temporarily
    this.initializeCrawler();
  }

  initializeCrawler() {
    // Store reference to results map for use in request handler
    const resultsMap = this.results;
    
    const crawlerConfig = {
      // Session management for proxy rotation
      sessionPoolOptions: {
        maxPoolSize: this.config.maxSessions || 10,
        sessionOptions: {
          maxUsageCount: 100, // HTTP can handle more requests per session
          maxErrorScore: 5,
        },
      },

      // Proxy configuration
      proxyConfiguration: this.createProxyConfiguration(),

      // Request timeout
      requestHandlerTimeoutSecs: Math.floor(this.config.timeoutMs / 1000) || 20,

      // Retry configuration
      maxRequestRetries: this.config.maxRetries || 2,

      // HTTP-specific options
      additionalMimeTypes: ['text/html', 'application/xhtml+xml'],
      
      // Request handler
      async requestHandler({ $, request, response, body }) {
        try {
          logger.info({ url: request.url }, 'Processing HTTP request with Crawlee');
          
          // Store result in temporary map (avoid Dataset.pushData restriction)
          const resultData = {
            url: request.url,
            html: body,
            status: response.statusCode,
            timestamp: new Date().toISOString(),
          };
          
          logger.info({ url: request.url, statusCode: response.statusCode, htmlLength: body?.length }, 'Storing HTTP result in map');
          resultsMap.set(request.url, resultData);

          return { html: body, status: response.statusCode };
        } catch (error) {
          logger.warn({ url: request.url, error: error.message }, 'HTTP request handler error');
          throw error;
        }
      },

      // Failed request handler
      async failedRequestHandler({ request }) {
        logger.error({ url: request.url }, 'HTTP request failed after all retries');
      },
    };

    this.crawler = new CheerioCrawler(crawlerConfig);
  }

  createProxyConfiguration() {
    if (!this.config.proxies || this.config.proxies.length === 0) {
      return undefined;
    }

    const proxyUrls = this.config.proxies.map(proxy => {
      if (typeof proxy === 'string') {
        return proxy;
      }
      return `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`;
    });

    return {
      proxyUrls,
      sessionPoolOptions: {
        sessionOptions: {
          maxUsageCount: 100,
        },
      },
    };
  }

  async fetch(url, options = {}) {
    try {
      logger.info({ url, adapter: 'crawlee-http' }, 'Fetching with Crawlee HTTP');

      // Use a simpler approach - just use axios for HTTP requests
      // The CheerioCrawler is overkill for simple HTTP fetching and has issues
      const axios = (await import('axios')).default;
      const { buildAgent } = await import('../utils/agent.js');
      
      const proxy = options.proxy;
      const agent = buildAgent(proxy);
      
      const response = await axios.get(url, {
        timeout: this.config.timeoutMs || 20000,
        headers: {
          'User-Agent': this.config.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          ...options.headers,
        },
        httpAgent: agent.http,
        httpsAgent: agent.https,
        validateStatus: () => true, // Accept any status code
      });
      
      logger.info({ url, status: response.status }, 'HTTP request completed');
      
      return {
        body: response.data,
        status: response.status,
      };

    } catch (error) {
      logger.error({ url, error: error.message }, 'Crawlee HTTP fetch failed');
      throw error;
    }
  }

  async close() {
    // Clear any stored results
    if (this.results) {
      this.results.clear();
    }
    
    if (this.crawler && typeof this.crawler.teardown === 'function') {
      try {
        await this.crawler.teardown();
      } catch (error) {
        logger.warn({ error: error.message }, 'Error during crawler teardown');
      }
    }
  }
}
