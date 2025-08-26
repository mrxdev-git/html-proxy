const ITransportAdapter = require('./interfaces/ITransportAdapter');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { HttpProxyAgent } = require('http-proxy-agent');

/**
 * Enhanced HTTP Adapter implementing ITransportAdapter interface
 */
class EnhancedHttpAdapter extends ITransportAdapter {
    constructor(config = {}) {
        super(config);
        
        this.name = 'EnhancedHttpAdapter';
        this.timeout = config.timeout || 30000;
        this.userAgent = config.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        this.maxRedirects = config.maxRedirects || 5;
        
        // Performance tracking
        this.metrics = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            totalResponseTime: 0,
            lastError: null,
            lastSuccessTime: null
        };
        
        // Connection pool reference (if provided)
        this.connectionPool = config.connectionPool || null;
    }

    /**
     * Initialize adapter
     */
    async initialize() {
        this.initialized = true;
        return Promise.resolve();
    }

    /**
     * Fetch content from URL
     */
    async fetch(url, options = {}) {
        const startTime = Date.now();
        this.metrics.totalRequests++;
        
        try {
            // Use connection pool if available
            if (this.connectionPool && options.httpResource) {
                return await this._fetchWithPool(url, options);
            }
            
            // Standard fetch without pool
            return await this._standardFetch(url, options);
            
        } catch (error) {
            this.metrics.failedRequests++;
            this.metrics.lastError = {
                message: error.message,
                timestamp: Date.now()
            };
            throw error;
        } finally {
            this.metrics.totalResponseTime += (Date.now() - startTime);
        }
    }

    /**
     * Fetch using connection pool
     */
    async _fetchWithPool(url, options) {
        const resource = options.httpResource;
        
        const config = {
            url,
            method: 'GET',
            timeout: options.timeout || this.timeout,
            headers: this._buildHeaders(options),
            responseType: 'text',
            validateStatus: () => true
        };
        
        const response = await resource.instance.request(config);
        
        // Update resource metrics
        resource.requestCount++;
        resource.lastUsed = Date.now();
        
        return this._processResponse(response);
    }

    /**
     * Standard fetch without pool
     */
    async _standardFetch(url, options) {
        const agent = this._buildAgent(options.proxy);
        
        const config = {
            url,
            method: 'GET',
            timeout: options.timeout || this.timeout,
            headers: this._buildHeaders(options),
            responseType: 'text',
            decompress: true,
            validateStatus: () => true,
            httpAgent: agent,
            httpsAgent: agent,
            maxRedirects: this.maxRedirects
        };
        
        const response = await axios.request(config);
        return this._processResponse(response);
    }

    /**
     * Process axios response
     */
    _processResponse(response) {
        // Check for errors
        if (response.status >= 500) {
            const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
            error.status = response.status;
            throw error;
        }
        
        // Check for common anti-bot responses
        if (response.status === 403 || response.status === 429) {
            const error = new Error(`Blocked: HTTP ${response.status}`);
            error.status = response.status;
            error.isBlocked = true;
            throw error;
        }
        
        this.metrics.successfulRequests++;
        this.metrics.lastSuccessTime = Date.now();
        
        return {
            success: true,
            html: response.data,
            status: response.status,
            headers: response.headers,
            url: response.config.url || response.request?.res?.responseUrl
        };
    }

    /**
     * Build HTTP headers
     */
    _buildHeaders(options) {
        return {
            'User-Agent': options.userAgent || this.userAgent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'DNT': '1',
            'Upgrade-Insecure-Requests': '1',
            ...(options.headers || {})
        };
    }

    /**
     * Build proxy agent
     */
    _buildAgent(proxyUrl) {
        if (!proxyUrl) return undefined;
        
        if (proxyUrl.startsWith('https://') || proxyUrl.startsWith('socks')) {
            return new HttpsProxyAgent(proxyUrl);
        }
        return new HttpProxyAgent(proxyUrl);
    }

    /**
     * Get adapter capabilities
     */
    getCapabilities() {
        return {
            supportsJavaScript: false,
            supportsCookies: true,
            supportsProxy: true,
            supportsHeaders: true,
            supportsScreenshot: false,
            supportsUserAgent: true,
            supportsStealth: false,
            supportsCache: true,
            maxConcurrency: 100,
            avgResponseTime: this._getAvgResponseTime(),
            successRate: this._getSuccessRate()
        };
    }

    /**
     * Get health metrics
     */
    getHealthMetrics() {
        return {
            isHealthy: this._isHealthy(),
            activeRequests: 0, // HTTP is stateless
            totalRequests: this.metrics.totalRequests,
            failedRequests: this.metrics.failedRequests,
            avgResponseTime: this._getAvgResponseTime(),
            lastError: this.metrics.lastError,
            lastSuccessTime: this.metrics.lastSuccessTime
        };
    }

    /**
     * Check if adapter can handle URL
     */
    canHandle(url) {
        // HTTP adapter can handle most URLs
        // but might not be suitable for JS-heavy sites
        try {
            const urlObj = new URL(url);
            return ['http:', 'https:'].includes(urlObj.protocol);
        } catch {
            return false;
        }
    }

    /**
     * Get priority for URL
     */
    getPriority(url) {
        // Higher priority for simple sites, APIs
        // Lower priority for known JS-heavy domains
        const jsHeavyDomains = [
            'facebook.com',
            'twitter.com',
            'instagram.com',
            'linkedin.com',
            'youtube.com',
            'netflix.com',
            'amazon.com',
            'google.com/maps'
        ];
        
        const isJsHeavy = jsHeavyDomains.some(domain => url.includes(domain));
        
        if (isJsHeavy) {
            return 20; // Low priority
        }
        
        // Check for API endpoints (usually don't need browser)
        if (url.includes('/api/') || url.includes('.json')) {
            return 90; // High priority
        }
        
        // Default medium-high priority for HTTP adapter
        return 70;
    }

    /**
     * Calculate average response time
     */
    _getAvgResponseTime() {
        if (this.metrics.totalRequests === 0) return 0;
        return Math.round(this.metrics.totalResponseTime / this.metrics.totalRequests);
    }

    /**
     * Calculate success rate
     */
    _getSuccessRate() {
        if (this.metrics.totalRequests === 0) return 1;
        return this.metrics.successfulRequests / this.metrics.totalRequests;
    }

    /**
     * Check if adapter is healthy
     */
    _isHealthy() {
        // Consider unhealthy if recent failures
        if (this.metrics.lastError) {
            const errorAge = Date.now() - this.metrics.lastError.timestamp;
            if (errorAge < 60000) { // Error in last minute
                return this._getSuccessRate() > 0.5;
            }
        }
        
        return this._getSuccessRate() > 0.8;
    }

    /**
     * Cleanup adapter
     */
    async cleanup() {
        this.initialized = false;
        // HTTP adapter doesn't hold persistent resources
        return Promise.resolve();
    }
}

module.exports = EnhancedHttpAdapter;
