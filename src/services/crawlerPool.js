import { PlaywrightCrawler } from '@crawlee/playwright';
import { EventEmitter } from 'events';
import { logger } from '../logger.js';
import { createPageLoader } from '../utils/pageLoader.js';
import { platformConfig } from '../utils/platformConfig.js';

/**
 * CrawlerPool - Manages a pool of crawler instances for maximum performance
 * Features:
 * - Connection pooling for browser contexts
 * - Request queuing and batching
 * - Automatic scaling based on load
 * - Health monitoring and recovery
 * - Circuit breaker pattern
 */
export class CrawlerPool extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
    this.crawlers = new Map(); // Pool of active crawlers
    this.browserContexts = new Map(); // Reusable browser contexts
    this.requestQueue = []; // Pending requests
      this.batchTimer = null;
    this.isDestroyed = false; // Pending requests
    this.processing = new Map(); // Currently processing requests
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      averageResponseTime: 0,
      activeCrawlers: 0,
      queueLength: 0,
    };
    
    // Circuit breaker state
    this.circuitBreaker = {
      state: 'CLOSED', // CLOSED, OPEN, HALF_OPEN
      failures: 0,
      successThreshold: 5,
      failureThreshold: 5,
      timeout: 30000, // 30 seconds
      lastFailTime: null,
    };

    // Pool configuration
    this.poolConfig = {
      minSize: config.minPoolSize || 1,
      maxSize: config.maxPoolSize || 5,
      idleTimeout: config.idleTimeout || 60000, // 60 seconds
      requestTimeout: config.requestTimeout || 30000,
      batchSize: config.batchSize || 10,
      batchTimeout: config.batchTimeout || 100, // 100ms
      loadingStrategy: config.loadingStrategy || 'balanced', // Page loading strategy
    };

    // Initialize pool
    this.initializePool();
    
    // Start monitoring
    this.startMonitoring();
  }

  async initializePool() {
    logger.info({ poolConfig: this.poolConfig }, 'Initializing crawler pool');
    
    // Create minimum number of crawlers
    for (let i = 0; i < this.poolConfig.minSize; i++) {
      await this.createCrawler(`crawler-${i}`);
    }
  }

  async createCrawler(id) {
    try {
      const crawlerConfig = {
        // Keep browser instance alive between requests
        keepAlive: true,
        
        // Session pool for proxy rotation
        sessionPoolOptions: {
          maxPoolSize: this.config.maxSessions || 20,
          sessionOptions: {
            maxUsageCount: 50,
            maxErrorScore: 3,
          },
        },

        // Browser pool configuration with memory limits
        browserPoolOptions: {
          useFingerprints: true,
          maxOpenPagesPerBrowser: 2, // Reduced for memory efficiency
          retireBrowserAfterPageCount: 30, // Reduced for memory efficiency
          // Cleanup hooks for memory management
          preLaunchHooks: [
            async (pageId, browserController) => {
              // Cache browser context with cleanup tracking
              this.browserContexts.set(pageId, {
                controller: browserController,
                created: Date.now(),
              });
              
              // Clean old contexts if too many
              if (this.browserContexts.size > 5) {
                await this.cleanupOldBrowserContexts();
              }
            },
          ],
        },

        // Proxy configuration
        proxyConfiguration: this.createProxyConfiguration(),

        // Request handling
        maxRequestRetries: 2,
        requestHandlerTimeoutSecs: 30,

        // Single request handler for all requests in pool
        requestHandler: this.createRequestHandler(id),
        failedRequestHandler: this.createFailedRequestHandler(id),
      };

      const crawler = new PlaywrightCrawler(crawlerConfig);
      
      this.crawlers.set(id, {
        crawler,
        status: 'IDLE',
        lastUsed: Date.now(),
        requestCount: 0,
      });

      this.stats.activeCrawlers++;
      logger.info({ id }, 'Crawler created and added to pool');
      
      return crawler;
    } catch (error) {
      logger.error({ id, error: error.message }, 'Failed to create crawler');
      throw error;
    }
  }

  createRequestHandler(crawlerId) {
    return async ({ page, request, response }) => {
      const startTime = Date.now();
      const requestId = request.userData.requestId;
      
      try {
        logger.debug({ crawlerId, requestId, url: request.url }, 'Processing request');
        
        // Apply stealth measures
        await applyStealth(page);
        
        // Create page loader with pool configuration
        const pageLoader = createPageLoader(this.poolConfig.loadingStrategy);
        pageLoader.options.maxWaitTime = this.poolConfig.requestTimeout;
        
        // Use advanced page loading detection
        const loadResult = await pageLoader.waitForPageLoad(page, request.url);
        
        // Get response status
        const status = response ? response.status() : 200;
        
        // Use the best available content
        const html = loadResult.content;
        
        // Store result with enhanced metrics
        const result = {
          html,
          status,
          crawlerId,
          responseTime: Date.now() - startTime,
          loadingMetrics: loadResult.metrics,
          success: loadResult.success,
          fallback: loadResult.fallback,
        };
        
        // Emit result event
        this.emit(`result:${requestId}`, result);
        
        // Update stats
        this.updateStats(true, Date.now() - startTime);
        
        // Update circuit breaker
        this.recordSuccess();
        
        logger.debug({ 
          crawlerId, 
          requestId, 
          contentLength: html.length,
          metrics: loadResult.metrics 
        }, 'Request completed');
        
      } catch (error) {
        logger.error({ crawlerId, requestId, error: error.message }, 'Request handler error');
        
        // Try to emit partial content if available
        try {
          const partialContent = await page.content();
          if (partialContent && partialContent.length > 100) {
            const partialResult = {
              html: partialContent,
              status: 0,
              crawlerId,
              responseTime: Date.now() - startTime,
              partial: true,
              error: error.message,
            };
            this.emit(`result:${requestId}`, partialResult);
            logger.info({ requestId, contentLength: partialContent.length }, 'Returning partial content after error');
            return; // Don't throw, we have partial content
          }
        } catch (contentError) {
          logger.debug('Could not retrieve partial content');
        }
        
        this.emit(`error:${requestId}`, error);
        
        // Update stats
        this.updateStats(false);
        
        // Update circuit breaker
        this.recordFailure();
        
        throw error;
      }
    };
  }

  createFailedRequestHandler(crawlerId) {
    return async ({ request, error }) => {
      const requestId = request.userData?.requestId || 'unknown';
      
      // Check if it's an HTTP/2 error and suggest retry with HTTP/1.1
      const isHttp2Error = error?.message?.includes('ERR_HTTP2_PROTOCOL_ERROR');
      
      logger.error({ 
        crawlerId, 
        requestId, 
        url: request.url,
        error: error?.message,
        isHttp2Error,
      }, 'Request failed after retries');
      
      // If HTTP/2 error, emit with special flag
      if (isHttp2Error) {
        this.emit(`failed:${requestId}`, {
          error: new Error('HTTP/2 protocol error - site may not support HTTP/2'),
          isHttp2Error: true,
          suggestion: 'Retry with HTTP/1.1 or use alternative fetch method',
        });
      } else {
        this.emit(`failed:${requestId}`, new Error(error?.message || 'Request failed after all retries'));
      }
      
      // Update stats
      this.stats.failedRequests++;
    };
  }

  async applyStealth(page) {
    try {
      // Remove webdriver property
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
        });
      });

      // Mock plugins and languages
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5],
        });
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en'],
        });
      });

      // Random viewport
      const viewports = [
        { width: 1920, height: 1080 },
        { width: 1366, height: 768 },
        { width: 1440, height: 900 },
      ];
      const viewport = viewports[Math.floor(Math.random() * viewports.length)];
      await page.setViewportSize(viewport);
      
    } catch (error) {
      logger.warn({ error: error.message }, 'Failed to apply stealth measures');
    }
  }

  /**
   * Process a URL request using the pool
   */
  async processRequest(url, options = {}) {
    logger.info({ url, options }, 'CrawlerPool.processRequest called');
    
    // Check circuit breaker
    if (this.circuitBreaker.state === 'OPEN') {
      if (Date.now() - this.circuitBreaker.lastFailTime > this.circuitBreaker.timeout) {
        // Try half-open state
        this.circuitBreaker.state = 'HALF_OPEN';
        logger.info('Circuit breaker entering HALF_OPEN state');
      } else {
        throw new Error('Circuit breaker is OPEN - service unavailable');
      }
    }
    
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    logger.debug({ requestId, url }, 'Created request ID');
    
    return new Promise((resolve, reject) => {
      // Add timeout to prevent hanging
      const timeout = setTimeout(() => {
        logger.error({ requestId, url }, 'Request timed out after 30 seconds');
        cleanup();
        reject(new Error(`Request timeout for URL: ${url}`));
      }, this.poolConfig.requestTimeout || 30000);
      
      // Set up event listeners for this request
      const cleanup = () => {
        clearTimeout(timeout);
        this.removeAllListeners(`result:${requestId}`);
        this.removeAllListeners(`error:${requestId}`);
        this.removeAllListeners(`failed:${requestId}`);
      };
      
      this.once(`result:${requestId}`, (result) => {
        logger.debug({ requestId }, 'Received result event');
        cleanup();
        resolve(result);
      });
      
      this.once(`error:${requestId}`, (error) => {
        logger.error({ requestId, error: error.message }, 'Received error event');
        cleanup();
        reject(error);
      });
      
      this.once(`failed:${requestId}`, (error) => {
        logger.error({ requestId, error: error.message }, 'Received failed event');
        cleanup();
        reject(error);
      });
      
      // Add to queue
      this.requestQueue.push({
        url,
        requestId,
        options,
        timestamp: Date.now(),
      });
      
      logger.debug({ requestId, queueLength: this.requestQueue.length }, 'Added to queue');
      
      // Process queue - don't await since we're returning the promise with event listeners
      setImmediate(() => this.processQueue());
    });
  }

  async processQueue() {
    // Check if we have requests to process
    if (this.requestQueue.length === 0) {
      logger.debug('processQueue: No requests in queue');
      return;
    }
    
    // Get a single request (we'll process one at a time to avoid the run() issue)
    const request = this.requestQueue.shift();
    
    if (!request) {
      logger.debug('processQueue: No request after shift');
      return;
    }
    
    const crawlerId = `temp-crawler-${Date.now()}`;
    logger.info({ crawlerId, requestId: request.requestId, url: request.url }, 'processQueue: Starting to process request');
    
    try {
      // Get platform-specific crawler configuration
      const platformCrawlerConfig = platformConfig.getCrawlerConfig();
      
      // Create a fresh crawler instance for this request with platform-specific config
      const crawlerConfig = {
        ...platformCrawlerConfig,
        
        // Proxy configuration if available
        proxyConfiguration: this.createProxyConfiguration(),
        
        // Single request handler
        requestHandler: this.createRequestHandler(crawlerId),
        failedRequestHandler: this.createFailedRequestHandler(crawlerId),
      };
      
      logger.debug({ crawlerId }, 'processQueue: Created crawler config');
      
      // Create new crawler instance
      const crawler = new PlaywrightCrawler(crawlerConfig);
      logger.debug({ crawlerId }, 'processQueue: Created PlaywrightCrawler instance');
      
      // Add request directly to the crawler with retry strategy
      const requestToAdd = {
        url: request.url,
        userData: {
          requestId: request.requestId,
          ...request.options,
        },
        maxRetries: 3,  // Increase retries for HTTP/2 errors
        retryOnBlocked: true,
        uniqueKey: `${request.url}-${request.requestId}`,  // Ensure unique key
      };
      
      await crawler.addRequests([requestToAdd]);
      logger.debug({ crawlerId, requestId: request.requestId, request: requestToAdd }, 'processQueue: Added request to crawler');
      
      // Run the crawler (this will process the request)
      logger.info({ crawlerId, requestId: request.requestId }, 'processQueue: About to call crawler.run()');
      await crawler.run();
      logger.info({ crawlerId, requestId: request.requestId }, 'processQueue: crawler.run() completed');
      
      // Update stats
      this.stats.totalRequests++;
      
      // Clean up the crawler
      if (crawler.browserPool) {
        await crawler.browserPool.destroy();
      }
      
    } catch (error) {
      logger.error({ error: error.message, url: request.url }, 'Error processing request');
      
      // Emit error for this request
      this.emit(`error:${request.requestId}`, error);
    } finally {
      // Continue processing queue if there are more requests
      if (this.requestQueue.length > 0 && !this.isDestroyed) {
        setImmediate(() => this.processQueue());
      }
    }
  }
    createProxyConfiguration() {
    if (!this.config.proxies || this.config.proxies.length === 0) {
      return undefined;
    }

    return {
      proxyUrls: this.config.proxies,
      sessionPoolOptions: {
        sessionOptions: {
          maxUsageCount: 30,
        },
      },
    };
  }

  // Circuit breaker methods
  recordSuccess() {
    if (this.circuitBreaker.state === 'HALF_OPEN') {
      this.circuitBreaker.failures = 0;
      this.circuitBreaker.state = 'CLOSED';
      logger.info('Circuit breaker entering CLOSED state');
    }
  }

  recordFailure() {
    this.circuitBreaker.failures++;
    
    if (this.circuitBreaker.failures >= this.circuitBreaker.failureThreshold) {
      this.circuitBreaker.state = 'OPEN';
      this.circuitBreaker.lastFailTime = Date.now();
      logger.warn('Circuit breaker entering OPEN state');
    }
  }

  // Stats methods
  updateStats(success, responseTime = 0) {
    this.stats.totalRequests++;
    
    if (success) {
      this.stats.successfulRequests++;
      
      // Update average response time
      const currentAvg = this.stats.averageResponseTime;
      const totalTime = currentAvg * (this.stats.successfulRequests - 1) + responseTime;
      this.stats.averageResponseTime = totalTime / this.stats.successfulRequests;
    } else {
      this.stats.failedRequests++;
    }
    
    this.stats.queueLength = this.requestQueue.length;
  }

  // Enhanced monitoring with memory pressure detection
  startMonitoring() {
    // Clear any existing interval first
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    
    this.monitoringInterval = setInterval(async () => {
      const now = Date.now();
      
      // Check memory pressure
      const memoryUsage = process.memoryUsage();
      const memoryPressureComputed = memoryUsage.heapUsed / memoryUsage.heapTotal;
      
      // Only trigger emergency cleanup if memory pressure is very high AND we have crawlers to clean
      if (memoryPressureComputed > 0.95 && this.crawlers.size > 1) {
        logger.warn({ memoryPressureComputed, memoryUsage }, 'Critical memory pressure detected, performing emergency cleanup');
        await this.performEmergencyCleanup();
      }
      
      // Clean up idle crawlers (but keep at least 1)
      for (const [id, crawler] of this.crawlers) {
        if (
          crawler.status === 'IDLE' &&
          now - crawler.lastUsed > this.poolConfig.idleTimeout &&
          this.crawlers.size > this.poolConfig.minSize
        ) {
          await this.removeCrawler(id);
        }
      }
      
      // Clean up old browser contexts
      await this.cleanupOldBrowserContexts();
      
      // Check memory pressure
      const memoryPressure = await this.checkMemoryPressure();
      
      // Log stats with memory info (less verbose)
      if (memoryPressure > 90) {
        logger.warn({ 
          stats: this.stats, 
          memoryPressure: Math.round(memoryPressure),
          browserContexts: this.browserContexts.size 
        }, 'Crawler pool stats - high memory pressure');
      } else {
        logger.debug({ 
          stats: this.stats, 
          memoryPressure: Math.round(memoryPressure),
          browserContexts: this.browserContexts.size 
        }, 'Crawler pool stats');
      }
      
    }, 30000); // Every 30 seconds (less frequent to reduce overhead)
  }
  
  // Stop monitoring
// Enhanced cleanup methods
  async cleanupOldBrowserContexts() {
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutes
    
    for (const [pageId, context] of this.browserContexts) {
      if (now - context.created > maxAge) {
        try {
          if (context.controller && typeof context.controller.close === 'function') {
            await context.controller.close();
          }
        } catch (error) {
          logger.warn({ pageId, error: error.message }, 'Error closing browser context');
        }
        this.browserContexts.delete(pageId);
      }
    }
  }
  
  async checkMemoryPressure() {
    const memUsage = process.memoryUsage();
    const heapUsedPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    
    if (heapUsedPercent > 85) {
      logger.warn({
        stats: this.stats,
        memoryPressure: Math.round(heapUsedPercent),
        browserContexts: this.browserPool?.pages?.size || 0,
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      }, 'Crawler pool stats - high memory pressure');
      
      // Emergency cleanup if memory pressure is critical
      if (heapUsedPercent > 90) {
        logger.error({ heapUsedPercent }, 'Critical memory pressure - initiating emergency cleanup');
        await this.emergencyCleanup();
        
        // Force garbage collection if available
        if (global.gc) {
          global.gc();
          logger.info('Forced garbage collection');
        }
      }
    }
    
    return heapUsedPercent;
  }

  async emergencyCleanup() {
    logger.warn('Performing emergency cleanup due to memory pressure');
    
    // Clear all idle crawlers
    for (const crawler of this.crawlers.values()) {
      if (crawler.status === 'idle') {
        await this.removeCrawler(crawler.id);
      }
    }
    
    // Clear request queue if too large
    if (this.requestQueue.length > 50) {
      const removed = this.requestQueue.splice(50);
      logger.warn({ removedCount: removed.length }, 'Removed excess requests from queue');
    }
    
    // Clean up browser pool if it exists
    if (this.browserPool) {
      try {
        await this.browserPool.destroy();
        this.browserPool = null;
        logger.info('Destroyed browser pool to free memory');
      } catch (error) {
        logger.error({ error }, 'Error destroying browser pool during emergency cleanup');
      }
    }
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
      logger.info('Forced garbage collection during emergency cleanup');
    }
  }

  // Destroy the pool and clean up all resources
  async destroy() {
    logger.info('Destroying crawler pool');
    this.isDestroyed = true;
    
    // Stop monitoring
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    // Clear batch timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
    
    // Stop accepting new requests
    this.circuitBreaker.state = 'OPEN';
    
    // Clear the queue
    this.requestQueue = [];
    
    // Destroy all crawlers with proper cleanup
    const destroyPromises = [];
    for (const [id, crawler] of this.crawlers) {
      destroyPromises.push(this.removeCrawler(id));
    }
    await Promise.allSettled(destroyPromises);
    
    // Clean up all browser contexts
    for (const [pageId, context] of this.browserContexts) {
      try {
        if (context.controller && typeof context.controller.close === 'function') {
          await context.controller.close();
        }
      } catch (error) {
        logger.warn({ pageId, error: error.message }, 'Error closing browser context during destroy');
      }
    }
    
    this.crawlers.clear();
    this.browserContexts.clear();
    this.processing.clear();
    this.removeAllListeners();
    
    // Force garbage collection
    if (global.gc) {
      global.gc();
    }
  }

  async removeCrawler(id) {
    const crawler = this.crawlers.get(id);
    
    if (crawler) {
      try {
        // Properly close Crawlee crawler using the correct methods
        if (crawler.crawler) {
          // Stop the crawler if it's running
          if (typeof crawler.crawler.stop === 'function') {
            await crawler.crawler.stop();
          }
          
          // Close browser pool if available
          if (crawler.crawler.browserPool && typeof crawler.crawler.browserPool.destroy === 'function') {
            await crawler.crawler.browserPool.destroy();
          }
          
          // Close session pool if available
          if (crawler.crawler.sessionPool && typeof crawler.crawler.sessionPool.teardown === 'function') {
            await crawler.crawler.sessionPool.teardown();
          }
        }
      } catch (error) {
        logger.warn({ id, error: error.message }, 'Error during crawler cleanup');
      }
      
      this.crawlers.delete(id);
      this.stats.activeCrawlers--;
      logger.info({ id }, 'Crawler removed from pool');
    }
  }

  async close() {
    logger.info('Shutting down crawler pool');
    
    // Clear queue
    this.requestQueue = [];
    
    // Close all crawlers
    for (const [id, crawler] of this.crawlers) {
      await this.removeCrawler(id);
    }
    
    // Clear browser contexts
    this.browserContexts.clear();
  }

  getStats() {
    return {
      ...this.stats,
      circuitBreakerState: this.circuitBreaker.state,
      poolSize: this.crawlers.size,
    };
  }
}

// Export singleton instance
let poolInstance = null;

export function getCrawlerPool(config) {
  if (!poolInstance) {
    poolInstance = new CrawlerPool(config);
  }
  return poolInstance;
}

export async function destroyCrawlerPool() {
  if (poolInstance) {
    await poolInstance.destroy();
    poolInstance = null;
  }
}
