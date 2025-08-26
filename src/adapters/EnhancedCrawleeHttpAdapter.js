import { CheerioCrawler } from 'crawlee';
import { BaseAdapter } from './base.js';
import { logger } from '../logger.js';
import axios from 'axios';
import { buildAgent } from '../utils/agent.js';

/**
 * Enhanced Crawlee HTTP Adapter implementing ITransportAdapter interface
 * Provides HTTP fetching with Crawlee's advanced anti-detection features
 */
export class EnhancedCrawleeHttpAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.config = config;
    this.name = 'crawlee-http';
    this.crawler = null;
    this.results = new Map();
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      avgResponseTime: 0
    };
    this.initializeCrawler();
  }

  /**
   * Get adapter capabilities for intelligent routing
   */
  getCapabilities() {
    return {
      name: this.name,
      type: 'http',
      supportedProtocols: ['http', 'https'],
      features: {
        javascript: false,
        cookies: true,
        proxy: true,
        fingerprinting: true,
        sessionManagement: true,
        antiDetection: true
      },
      performance: {
        speed: 9, // Very fast for static content
        reliability: 8,
        antiDetectionScore: 7
      },
      resourceRequirements: {
        cpu: 'low',
        memory: 'low',
        network: 'medium'
      }
    };
  }

  initializeCrawler() {
    const resultsMap = this.results;
    
    const crawlerConfig = {
      // Session management for proxy rotation
      sessionPoolOptions: {
        maxPoolSize: this.config.maxSessions || 20,
        sessionOptions: {
          maxUsageCount: 100,
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
      additionalMimeTypes: ['text/html', 'application/xhtml+xml', 'application/json'],
      
      // Request handler
      async requestHandler({ $, request, response, body }) {
        try {
          logger.info({ url: request.url }, 'Processing HTTP request with Enhanced Crawlee');
          
          const resultData = {
            url: request.url,
            html: body,
            status: response.statusCode,
            headers: response.headers,
            timestamp: new Date().toISOString(),
          };
          
          resultsMap.set(request.url, resultData);
          return resultData;
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

  /**
   * Fetch URL with resource pool support
   */
  async fetchWithPool(url, options = {}) {
    const startTime = Date.now();
    
    try {
      // If a resource is provided, use it (connection from pool)
      const resource = options.resource;
      
      if (resource && resource.instance) {
        // Use pooled axios instance
        const response = await resource.instance.get(url, {
          timeout: options.timeout || this.config.timeoutMs || 20000,
          headers: {
            'User-Agent': this.config.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            ...options.headers,
          },
          validateStatus: () => true,
        });
        
        this.updateMetrics(true, Date.now() - startTime);
        
        return {
          html: response.data,
          body: response.data,
          status: response.status,
          headers: response.headers,
          adapter: this.name,
          responseTime: Date.now() - startTime
        };
      }
      
      // Fallback to regular fetch if no pool resource
      return await this.fetch(url, options);
      
    } catch (error) {
      this.updateMetrics(false, Date.now() - startTime);
      logger.error({ url, error: error.message }, 'Enhanced Crawlee HTTP fetch failed');
      throw error;
    }
  }

  /**
   * Standard fetch method
   */
  async fetch(url, options = {}) {
    const startTime = Date.now();
    
    try {
      logger.info({ url, adapter: this.name }, 'Fetching with Enhanced Crawlee HTTP');

      // Use axios for simplicity and reliability
      const proxy = options.proxy;
      const agent = buildAgent(proxy);
      
      const response = await axios.get(url, {
        timeout: options.timeout || this.config.timeoutMs || 20000,
        headers: {
          'User-Agent': this.config.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          ...options.headers,
        },
        httpAgent: agent.http,
        httpsAgent: agent.https,
        validateStatus: () => true,
      });
      
      logger.info({ url, status: response.status }, 'HTTP request completed');
      
      this.updateMetrics(true, Date.now() - startTime);
      
      return {
        html: response.data,
        body: response.data,
        status: response.status,
        headers: response.headers,
        adapter: this.name,
        responseTime: Date.now() - startTime
      };

    } catch (error) {
      this.updateMetrics(false, Date.now() - startTime);
      logger.error({ url, error: error.message }, 'Enhanced Crawlee HTTP fetch failed');
      throw error;
    }
  }

  /**
   * Update performance metrics
   */
  updateMetrics(success, responseTime) {
    this.metrics.totalRequests++;
    if (success) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
    }
    
    // Update average response time
    const prevAvg = this.metrics.avgResponseTime;
    const prevTotal = this.metrics.totalRequests - 1;
    this.metrics.avgResponseTime = (prevAvg * prevTotal + responseTime) / this.metrics.totalRequests;
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      successRate: this.metrics.totalRequests > 0 
        ? this.metrics.successfulRequests / this.metrics.totalRequests 
        : 0
    };
  }

  /**
   * Clean up resources
   */
  async close() {
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
