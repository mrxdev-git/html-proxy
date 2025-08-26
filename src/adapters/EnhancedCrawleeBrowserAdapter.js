import { PlaywrightCrawler } from 'crawlee';
import { BaseAdapter } from './base.js';
import { logger } from '../logger.js';
import { getCrawlerPool, destroyCrawlerPool } from '../services/crawlerPool.js';

/**
 * Enhanced Crawlee Browser Adapter implementing ITransportAdapter interface
 * Provides browser-based fetching with Crawlee's advanced anti-detection features
 */
export class EnhancedCrawleeBrowserAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.config = config;
    this.name = 'crawlee-browser';
    this.crawlerPool = getCrawlerPool(config);
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      avgResponseTime: 0
    };
    logger.info('EnhancedCrawleeBrowserAdapter initialized with pool');
  }

  /**
   * Get adapter capabilities for intelligent routing
   */
  getCapabilities() {
    return {
      name: this.name,
      type: 'browser',
      supportedProtocols: ['http', 'https'],
      features: {
        javascript: true,
        cookies: true,
        proxy: true,
        fingerprinting: true,
        sessionManagement: true,
        antiDetection: true,
        screenshots: true,
        waitForSelectors: true
      },
      performance: {
        speed: 5, // Slower due to browser overhead
        reliability: 9, // Very reliable for complex sites
        antiDetectionScore: 10 // Best anti-detection
      },
      resourceRequirements: {
        cpu: 'high',
        memory: 'high',
        network: 'medium'
      }
    };
  }

  /**
   * Fetch URL with resource pool support
   */
  async fetchWithPool(url, options = {}) {
    const startTime = Date.now();
    
    try {
      logger.info({ url, adapter: this.name }, 'Fetching with Enhanced Crawlee Browser Pool');

      // If a browser resource is provided from BrowserPool
      const resource = options.resource;
      
      if (resource && resource.instance) {
        // Use the browser page from the pool
        const page = resource.instance;
        
        // Navigate to URL
        await page.goto(url, {
          waitUntil: options.waitUntil || 'networkidle',
          timeout: options.timeout || this.config.timeoutMs || 30000
        });
        
        // Wait for any specific selectors if needed
        if (options.waitForSelector) {
          await page.waitForSelector(options.waitForSelector, {
            timeout: 5000
          });
        }
        
        // Get the HTML content
        const html = await page.content();
        
        // Get response status if available
        const response = page.response();
        const status = response ? response.status() : 200;
        
        this.updateMetrics(true, Date.now() - startTime);
        
        return {
          html,
          body: html,
          status,
          adapter: this.name,
          responseTime: Date.now() - startTime,
          screenshot: options.screenshot ? await page.screenshot({ fullPage: true }) : undefined
        };
      }
      
      // Fallback to crawler pool if no browser resource
      return await this.fetch(url, options);
      
    } catch (error) {
      this.updateMetrics(false, Date.now() - startTime);
      logger.error({ url, error: error.message }, 'Enhanced Crawlee Browser fetch failed');
      throw error;
    }
  }

  /**
   * Standard fetch method using crawler pool
   */
  async fetch(url, options = {}) {
    const startTime = Date.now();
    
    try {
      logger.info({ url, adapter: this.name }, 'Fetching with Enhanced Crawlee Browser (pooled)');

      // Use the crawler pool for maximum performance
      const result = await this.crawlerPool.processRequest(url, options);
      
      if (!result || !result.html) {
        logger.error({ url, result }, 'No data retrieved from browser crawler pool');
        throw new Error('No data retrieved from browser crawler pool');
      }
      
      this.updateMetrics(true, Date.now() - startTime);
      
      return {
        html: result.html,
        body: result.html,
        status: result.status || 200,
        adapter: this.name,
        responseTime: Date.now() - startTime
      };

    } catch (error) {
      this.updateMetrics(false, Date.now() - startTime);
      logger.error({ 
        url, 
        error: error.message,
        stack: error.stack,
        type: error.constructor.name
      }, 'Enhanced Crawlee browser pool fetch failed - detailed error');
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
        : 0,
      poolStats: this.getStats()
    };
  }

  /**
   * Get pool statistics for monitoring
   */
  getStats() {
    return this.crawlerPool.getStats();
  }

  /**
   * Clean up resources
   */
  async close() {
    // Pool handles cleanup
    logger.info('EnhancedCrawleeBrowserAdapter closing (pool will persist)');
  }
  
  /**
   * Destroy the singleton pool
   */
  async destroy() {
    await destroyCrawlerPool();
  }
}
