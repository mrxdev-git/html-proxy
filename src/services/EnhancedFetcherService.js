const EventEmitter = require('events');
const crypto = require('crypto');
const logger = require('../logger');

/**
 * Enhanced Fetcher Service with Dependency Injection
 * Orchestrates fetching with intelligent routing, caching, and monitoring
 */
class EnhancedFetcherService extends EventEmitter {
    constructor(dependencies = {}) {
        super();
        
        // Dependency injection
        this.resourceManager = dependencies.resourceManager;
        this.adapterRouter = dependencies.adapterRouter;
        this.cacheService = dependencies.cacheService;
        this.metricsCollector = dependencies.metricsCollector;
        
        // Configuration
        this.config = {
            maxRetries: dependencies.config?.maxRetries || 3,
            retryDelay: dependencies.config?.retryDelay || 1000,
            timeout: dependencies.config?.timeout || 30000,
            cacheEnabled: dependencies.config?.cacheEnabled !== false,
            cacheTTL: dependencies.config?.cacheTTL || 3600000, // 1 hour
            circuitBreakerEnabled: dependencies.config?.circuitBreakerEnabled !== false,
            metricsEnabled: dependencies.config?.metricsEnabled !== false,
            ...dependencies.config
        };
        
        // Request tracking
        this.activeRequests = new Map();
        this.requestHistory = [];
        this.maxHistorySize = 1000;
        
        // Statistics
        this.stats = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            cachedRequests: 0,
            retriedRequests: 0,
            totalDuration: 0
        };
        
        this._validateDependencies();
        this._setupEventListeners();
    }

    /**
     * Validate required dependencies
     */
    _validateDependencies() {
        const required = ['resourceManager', 'adapterRouter'];
        for (const dep of required) {
            if (!this[dep]) {
                throw new Error(`Missing required dependency: ${dep}`);
            }
        }
    }

    /**
     * Setup event listeners
     */
    _setupEventListeners() {
        // Listen to router events
        if (this.adapterRouter) {
            this.adapterRouter.on('fallback-attempt', (data) => {
                logger.warn('Adapter fallback triggered', data);
                this.emit('fallback', data);
            });
            
            this.adapterRouter.on('routing-rule-matched', (data) => {
                logger.debug('Routing rule matched', data);
            });
        }
        
        // Listen to resource manager events
        if (this.resourceManager) {
            this.resourceManager.on('pool-error', (data) => {
                logger.error('Resource pool error', data);
                this.emit('pool-error', data);
            });
        }
    }

    /**
     * Main fetch method with all enhancements
     */
    async fetch(url, options = {}) {
        const requestId = crypto.randomBytes(8).toString('hex');
        const startTime = Date.now();
        
        // Track request
        this.activeRequests.set(requestId, {
            url,
            options,
            startTime,
            status: 'pending'
        });
        
        this.stats.totalRequests++;
        
        try {
            // Check cache first
            if (this.config.cacheEnabled && this.cacheService && !options.noCache) {
                const cached = await this._checkCache(url, options);
                if (cached) {
                    this.stats.cachedRequests++;
                    this._recordRequest(requestId, url, startTime, true, null, true);
                    return cached;
                }
            }
            
            // Execute fetch with retries
            const result = await this._fetchWithRetries(url, options, requestId);
            
            // Cache successful result
            if (this.config.cacheEnabled && this.cacheService && result.success) {
                await this._cacheResult(url, options, result);
            }
            
            // Record metrics
            this._recordRequest(requestId, url, startTime, true, null, false);
            this.stats.successfulRequests++;
            
            return result;
            
        } catch (error) {
            this.stats.failedRequests++;
            this._recordRequest(requestId, url, startTime, false, error, false);
            
            logger.error('Fetch failed', {
                requestId,
                url,
                error: error.message,
                duration: Date.now() - startTime
            });
            
            throw error;
            
        } finally {
            this.activeRequests.delete(requestId);
            this.stats.totalDuration += (Date.now() - startTime);
        }
    }

    /**
     * Fetch with retry logic
     */
    async _fetchWithRetries(url, options, requestId) {
        let lastError = null;
        const maxAttempts = Math.max(1, this.config.maxRetries);
        
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                logger.debug(`Fetch attempt ${attempt}/${maxAttempts}`, { requestId, url });
                
                // Update request status
                const request = this.activeRequests.get(requestId);
                if (request) {
                    request.status = `attempt-${attempt}`;
                    request.currentAttempt = attempt;
                }
                
                // Execute fetch through router
                const result = await this._executeFetch(url, options, requestId);
                
                // Validate result
                if (this._validateResult(result)) {
                    return result;
                }
                
                throw new Error('Invalid result structure');
                
            } catch (error) {
                lastError = error;
                
                logger.warn(`Fetch attempt ${attempt} failed`, {
                    requestId,
                    url,
                    error: error.message,
                    willRetry: attempt < maxAttempts
                });
                
                if (attempt < maxAttempts) {
                    this.stats.retriedRequests++;
                    await this._delay(this.config.retryDelay * attempt);
                }
            }
        }
        
        throw lastError || new Error('All fetch attempts failed');
    }

    /**
     * Execute fetch through adapter router
     */
    async _executeFetch(url, options, requestId) {
        const fetchOptions = {
            ...options,
            timeout: options.timeout || this.config.timeout,
            requestId
        };
        
        // Select adapter and fetch
        const adapterInfo = await this.adapterRouter.selectAdapter(url, fetchOptions);
        
        logger.info('Adapter selected', {
            requestId,
            adapter: adapterInfo.name,
            score: adapterInfo.score
        });
        
        // Get resources if needed
        let browserResource = null;
        let httpResource = null;
        
        try {
            // Acquire resources based on adapter type
            if (adapterInfo.adapter.getCapabilities().supportsJavaScript) {
                // Browser adapter - get browser from pool
                browserResource = await this.resourceManager.acquire('BrowserPool');
                fetchOptions.browserResource = browserResource;
            } else {
                // HTTP adapter - get connection from pool
                httpResource = await this.resourceManager.acquire('HttpConnectionPool');
                fetchOptions.httpResource = httpResource;
            }
            
            // Execute fetch through router
            const result = await this.adapterRouter.execute(url, fetchOptions);
            
            // Record metrics
            if (this.metricsCollector) {
                this.metricsCollector.recordRequest({
                    url,
                    adapter: adapterInfo.name,
                    duration: Date.now() - this.activeRequests.get(requestId).startTime,
                    status: result.status || 200,
                    success: true,
                    size: result.html ? result.html.length : 0
                });
            }
            
            return {
                success: true,
                html: result.html || result.body || result.content,
                status: result.status || 200,
                headers: result.headers || {},
                adapter: adapterInfo.name,
                requestId,
                ...result
            };
            
        } finally {
            // Release resources
            if (browserResource) {
                await this.resourceManager.release('BrowserPool', browserResource);
            }
            if (httpResource) {
                await this.resourceManager.release('HttpConnectionPool', httpResource);
            }
        }
    }

    /**
     * Check cache for existing result
     */
    async _checkCache(url, options) {
        if (!this.cacheService) return null;
        
        try {
            const cacheKey = this._generateCacheKey(url, options);
            const cached = await this.cacheService.get(cacheKey);
            
            if (cached) {
                logger.debug('Cache hit', { url, cacheKey });
                this.emit('cache-hit', { url, cacheKey });
                return cached;
            }
            
            logger.debug('Cache miss', { url, cacheKey });
            this.emit('cache-miss', { url, cacheKey });
            return null;
            
        } catch (error) {
            logger.error('Cache check failed', { url, error: error.message });
            return null;
        }
    }

    /**
     * Cache fetch result
     */
    async _cacheResult(url, options, result) {
        if (!this.cacheService || !result.html) return;
        
        try {
            const cacheKey = this._generateCacheKey(url, options);
            const ttl = options.cacheTTL || this.config.cacheTTL;
            
            await this.cacheService.set(cacheKey, {
                ...result,
                cachedAt: Date.now()
            }, ttl);
            
            logger.debug('Result cached', { url, cacheKey, ttl });
            this.emit('cache-set', { url, cacheKey, ttl });
            
        } catch (error) {
            logger.error('Cache set failed', { url, error: error.message });
        }
    }

    /**
     * Generate cache key
     */
    _generateCacheKey(url, options) {
        const keyData = {
            url,
            javascript: options.javascript || false,
            waitForSelector: options.waitForSelector || null,
            headers: options.headers || {}
        };
        
        return crypto
            .createHash('sha256')
            .update(JSON.stringify(keyData))
            .digest('hex');
    }

    /**
     * Validate fetch result
     */
    _validateResult(result) {
        return result && 
               (result.html || result.body || result.content) &&
               result.success !== false;
    }

    /**
     * Record request for history and metrics
     */
    _recordRequest(requestId, url, startTime, success, error, cached) {
        const record = {
            requestId,
            url,
            timestamp: startTime,
            duration: Date.now() - startTime,
            success,
            cached,
            error: error ? error.message : null
        };
        
        this.requestHistory.push(record);
        
        // Limit history size
        if (this.requestHistory.length > this.maxHistorySize) {
            this.requestHistory.shift();
        }
        
        this.emit('request-complete', record);
    }

    /**
     * Delay helper
     */
    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get active requests
     */
    getActiveRequests() {
        return Array.from(this.activeRequests.entries()).map(([id, req]) => ({
            id,
            ...req,
            duration: Date.now() - req.startTime
        }));
    }

    /**
     * Get service statistics
     */
    getStatistics() {
        const avgDuration = this.stats.totalRequests > 0
            ? this.stats.totalDuration / this.stats.totalRequests
            : 0;
        
        const successRate = this.stats.totalRequests > 0
            ? this.stats.successfulRequests / this.stats.totalRequests
            : 0;
        
        const cacheHitRate = this.stats.totalRequests > 0
            ? this.stats.cachedRequests / this.stats.totalRequests
            : 0;
        
        return {
            ...this.stats,
            avgDuration: Math.round(avgDuration),
            successRate: Math.round(successRate * 100) / 100,
            cacheHitRate: Math.round(cacheHitRate * 100) / 100,
            activeRequests: this.activeRequests.size,
            recentHistory: this.requestHistory.slice(-10)
        };
    }

    /**
     * Clear cache
     */
    async clearCache() {
        if (this.cacheService && this.cacheService.clear) {
            await this.cacheService.clear();
            logger.info('Cache cleared');
            this.emit('cache-cleared');
        }
    }

    /**
     * Warm up service
     */
    async warmup() {
        logger.info('Warming up fetcher service');
        
        // Initialize pools
        if (this.resourceManager) {
            const browserPool = this.resourceManager.getPool('BrowserPool');
            if (browserPool && browserPool.initialize) {
                await browserPool.initialize();
            }
            
            const httpPool = this.resourceManager.getPool('HttpConnectionPool');
            if (httpPool && httpPool.initialize) {
                await httpPool.initialize();
            }
        }
        
        logger.info('Fetcher service warmed up');
        this.emit('warmed-up');
    }

    /**
     * Shutdown service
     */
    async shutdown() {
        logger.info('Shutting down fetcher service');
        
        // Wait for active requests to complete
        const timeout = 30000;
        const startTime = Date.now();
        
        while (this.activeRequests.size > 0 && Date.now() - startTime < timeout) {
            logger.info(`Waiting for ${this.activeRequests.size} active requests`);
            await this._delay(1000);
        }
        
        // Force clear remaining requests
        if (this.activeRequests.size > 0) {
            logger.warn(`Force clearing ${this.activeRequests.size} active requests`);
            this.activeRequests.clear();
        }
        
        // Shutdown dependencies
        if (this.adapterRouter && this.adapterRouter.shutdown) {
            await this.adapterRouter.shutdown();
        }
        
        if (this.resourceManager && this.resourceManager.shutdown) {
            await this.resourceManager.shutdown();
        }
        
        if (this.metricsCollector && this.metricsCollector.shutdown) {
            await this.metricsCollector.shutdown();
        }
        
        logger.info('Fetcher service shut down');
        this.emit('shutdown');
    }
}

module.exports = EnhancedFetcherService;
