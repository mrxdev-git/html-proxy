/**
 * ITransportAdapter - Base interface for all transport adapters
 * Defines the contract that all adapters must implement
 */

class ITransportAdapter {
    /**
     * Constructor for transport adapter
     * @param {Object} config - Adapter configuration
     */
    constructor(config = {}) {
        this.config = config;
        this.name = this.constructor.name;
        this.initialized = false;
    }

    /**
     * Initialize the adapter
     * @returns {Promise<void>}
     */
    async initialize() {
        throw new Error('initialize() must be implemented by adapter');
    }

    /**
     * Fetch content from URL
     * @param {string} url - Target URL
     * @param {Object} options - Fetch options
     * @returns {Promise<Object>} - Response with html, status, headers, etc.
     */
    async fetch(url, options = {}) {
        throw new Error('fetch() must be implemented by adapter');
    }

    /**
     * Get adapter capabilities
     * @returns {Object} - Capabilities object
     */
    getCapabilities() {
        return {
            supportsJavaScript: false,
            supportsCookies: false,
            supportsProxy: false,
            supportsHeaders: true,
            supportsScreenshot: false,
            supportsUserAgent: true,
            supportsStealth: false,
            supportsCache: false,
            maxConcurrency: 1,
            avgResponseTime: 1000,
            successRate: 0.95
        };
    }

    /**
     * Get adapter health metrics
     * @returns {Object} - Health metrics
     */
    getHealthMetrics() {
        return {
            isHealthy: true,
            activeRequests: 0,
            totalRequests: 0,
            failedRequests: 0,
            avgResponseTime: 0,
            lastError: null,
            lastSuccessTime: null
        };
    }

    /**
     * Check if adapter can handle URL
     * @param {string} url - Target URL
     * @returns {boolean} - True if can handle
     */
    canHandle(url) {
        return true;
    }

    /**
     * Get adapter priority for URL
     * @param {string} url - Target URL
     * @returns {number} - Priority score (0-100)
     */
    getPriority(url) {
        return 50;
    }

    /**
     * Cleanup adapter resources
     * @returns {Promise<void>}
     */
    async cleanup() {
        this.initialized = false;
    }

    /**
     * Validate fetch options
     * @param {Object} options - Options to validate
     * @returns {Object} - Validated options
     */
    validateOptions(options) {
        return {
            timeout: options.timeout || 30000,
            headers: options.headers || {},
            proxy: options.proxy || null,
            userAgent: options.userAgent || null,
            cookies: options.cookies || [],
            waitForSelector: options.waitForSelector || null,
            screenshot: options.screenshot || false,
            ...options
        };
    }
}

module.exports = ITransportAdapter;
