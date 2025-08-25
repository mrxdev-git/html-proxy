import { PlaywrightCrawler, CheerioCrawler, Configuration } from 'crawlee';
import { logger } from '../logger.js';
import EventEmitter from 'events';

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
  constructor(config) {
    super();
    this.config = config;
    this.crawlers = new Map(); // Pool of active crawlers
    this.browserContexts = new Map(); // Reusable browser contexts
    this.requestQueue = []; // Pending requests
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

        // Browser pool configuration
        browserPoolOptions: {
          useFingerprints: true,
          maxOpenPagesPerBrowser: 5,
          retireBrowserAfterPageCount: 100,
          // Reuse browser contexts for performance
          preLaunchHooks: [
            async (pageId, browserController) => {
              // Cache browser context for reuse
              this.browserContexts.set(pageId, browserController);
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
        await this.applyStealth(page);
        
        // Get response status
        const status = response ? response.status() : 200;
        
        // Get HTML content
        const html = await page.content();
        
        // Store result
        const result = {
          html,
          status,
          crawlerId,
          responseTime: Date.now() - startTime,
        };
        
        // Emit result event
        this.emit(`result:${requestId}`, result);
        
        // Update stats
        this.updateStats(true, Date.now() - startTime);
        
        // Update circuit breaker
        this.recordSuccess();
        
      } catch (error) {
        logger.error({ crawlerId, requestId, error: error.message }, 'Request handler error');
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
    return async ({ request }) => {
      const requestId = request.userData.requestId;
      logger.error({ crawlerId, requestId, url: request.url }, 'Request failed after retries');
      
      this.emit(`failed:${requestId}`, new Error('Request failed after all retries'));
      this.updateStats(false);
      this.recordFailure();
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
    
    return new Promise((resolve, reject) => {
      // Set up event listeners for this request
      const cleanup = () => {
        this.removeAllListeners(`result:${requestId}`);
        this.removeAllListeners(`error:${requestId}`);
        this.removeAllListeners(`failed:${requestId}`);
      };
      
      this.once(`result:${requestId}`, (result) => {
        cleanup();
        resolve(result);
      });
      
      this.once(`error:${requestId}`, (error) => {
        cleanup();
        reject(error);
      });
      
      this.once(`failed:${requestId}`, (error) => {
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
      
      // Process queue
      this.processQueue();
    });
  }

  async processQueue() {
    // Check if we have available crawlers
    const availableCrawler = this.getAvailableCrawler();
    
    if (!availableCrawler || this.requestQueue.length === 0) {
      return;
    }
    
    // Get batch of requests
    const batch = this.requestQueue.splice(0, this.poolConfig.batchSize);
    
    // Mark crawler as busy
    availableCrawler.status = 'BUSY';
    availableCrawler.lastUsed = Date.now();
    
    try {
      // Add requests to crawler
      const crawlerRequests = batch.map(req => ({
        url: req.url,
        userData: {
          requestId: req.requestId,
          ...req.options,
        },
      }));
      
      await availableCrawler.crawler.addRequests(crawlerRequests);
      
      // Run crawler
      await availableCrawler.crawler.run();
      
      // Update request count
      availableCrawler.requestCount += batch.length;
      
    } catch (error) {
      logger.error({ error: error.message }, 'Error processing batch');
      
      // Emit errors for all requests in batch
      batch.forEach(req => {
        this.emit(`error:${req.requestId}`, error);
      });
    } finally {
      // Mark crawler as idle
      availableCrawler.status = 'IDLE';
      
      // Continue processing queue if there are more requests
      if (this.requestQueue.length > 0) {
        setImmediate(() => this.processQueue());
      }
    }
  }

  getAvailableCrawler() {
    // Find idle crawler
    for (const [id, crawler] of this.crawlers) {
      if (crawler.status === 'IDLE') {
        return crawler;
      }
    }
    
    // Create new crawler if under max size
    if (this.crawlers.size < this.poolConfig.maxSize) {
      const newId = `crawler-${this.crawlers.size}`;
      this.createCrawler(newId);
      return this.crawlers.get(newId);
    }
    
    return null;
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

  // Monitoring
  startMonitoring() {
    this.monitoringInterval = setInterval(() => {
      // Clean up idle crawlers
      const now = Date.now();
      
      for (const [id, crawler] of this.crawlers) {
        if (
          crawler.status === 'IDLE' &&
          now - crawler.lastUsed > this.poolConfig.idleTimeout &&
          this.crawlers.size > this.poolConfig.minSize
        ) {
          this.removeCrawler(id);
        }
      }
      
      // Log stats
      logger.info({ stats: this.stats }, 'Crawler pool stats');
      
    }, 30000); // Every 30 seconds
  }
  
  // Stop monitoring
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }
  
  // Destroy the pool and clean up all resources
  async destroy() {
    this.stopMonitoring();
    
    // Stop accepting new requests
    this.circuitBreaker.state = 'OPEN';
    
    // Clear the queue
    this.requestQueue = [];
    
    // Destroy all crawlers
    for (const crawler of this.crawlers.values()) {
      try {
        if (crawler && crawler.crawler && typeof crawler.crawler.teardown === 'function') {
          await crawler.crawler.teardown();
        }
      } catch (error) {
        logger.error({ error: error.message }, 'Error tearing down crawler');
      }
    }
    
    this.crawlers.clear();
    this.browserContexts.clear();
    this.processing.clear();
    this.removeAllListeners();
  }

  async removeCrawler(id) {
    const crawler = this.crawlers.get(id);
    
    if (crawler) {
      try {
        if (crawler.crawler && typeof crawler.crawler.teardown === 'function') {
          await crawler.crawler.teardown();
        }
      } catch (error) {
        logger.warn({ id, error: error.message }, 'Error during crawler teardown');
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
