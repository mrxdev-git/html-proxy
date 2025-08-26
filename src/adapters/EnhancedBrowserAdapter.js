const ITransportAdapter = require('./interfaces/ITransportAdapter');
const { chromium } = require('playwright');
const logger = require('../logger');

/**
 * Enhanced Browser Adapter implementing ITransportAdapter interface
 * Uses browser pool for efficient resource management
 */
class EnhancedBrowserAdapter extends ITransportAdapter {
    constructor(config = {}) {
        super(config);
        
        this.name = 'EnhancedBrowserAdapter';
        this.timeout = config.timeout || 30000;
        this.headless = config.headless !== false;
        
        // Performance tracking
        this.metrics = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            totalResponseTime: 0,
            lastError: null,
            lastSuccessTime: null
        };
        
        // Browser pool reference (if provided)
        this.browserPool = config.browserPool || null;
    }

    /**
     * Initialize adapter
     */
    async initialize() {
        this.initialized = true;
        return Promise.resolve();
    }

    /**
     * Fetch content from URL using browser
     */
    async fetch(url, options = {}) {
        const startTime = Date.now();
        this.metrics.totalRequests++;
        
        let page = null;
        let browserResource = null;
        
        try {
            // Use browser pool if available
            if (options.browserResource) {
                browserResource = options.browserResource;
                page = await this.browserPool.getPage(browserResource);
            } else {
                // Fallback to creating own browser
                page = await this._createStandalonePage();
            }
            
            // Configure page
            await this._configurePage(page, options);
            
            // Navigate to URL
            const response = await page.goto(url, {
                waitUntil: options.waitUntil || 'networkidle',
                timeout: options.timeout || this.timeout
            });
            
            // Wait for specific selector if provided
            if (options.waitForSelector) {
                await page.waitForSelector(options.waitForSelector, {
                    timeout: options.selectorTimeout || 10000
                });
            }
            
            // Execute custom JavaScript if provided
            if (options.executeScript) {
                await page.evaluate(options.executeScript);
            }
            
            // Take screenshot if requested
            let screenshot = null;
            if (options.screenshot) {
                screenshot = await page.screenshot({
                    fullPage: options.fullPage || false,
                    type: 'png'
                });
            }
            
            // Get page content
            const html = await page.content();
            
            // Get cookies if requested
            let cookies = null;
            if (options.getCookies) {
                cookies = await page.context().cookies();
            }
            
            // Update metrics
            this.metrics.successfulRequests++;
            this.metrics.lastSuccessTime = Date.now();
            this.metrics.totalResponseTime += (Date.now() - startTime);
            
            // Update browser resource metrics if using pool
            if (browserResource) {
                browserResource.requestCount++;
            }
            
            return {
                success: true,
                html,
                status: response ? response.status() : 200,
                headers: response ? response.headers() : {},
                url: page.url(),
                screenshot,
                cookies
            };
            
        } catch (error) {
            this.metrics.failedRequests++;
            this.metrics.lastError = {
                message: error.message,
                timestamp: Date.now()
            };
            
            // Update browser resource error count if using pool
            if (browserResource) {
                browserResource.errors++;
            }
            
            throw error;
            
        } finally {
            // Clean up page if not using pool
            if (!options.browserResource && page) {
                await page.close().catch(() => {});
            }
            
            this.metrics.totalResponseTime += (Date.now() - startTime);
        }
    }

    /**
     * Create standalone page without pool
     */
    async _createStandalonePage() {
        const browser = await chromium.launch({
            headless: this.headless,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--disable-dev-shm-usage',
                '--no-sandbox',
                '--disable-setuid-sandbox'
            ]
        });
        
        const context = await browser.newContext({
            ignoreHTTPSErrors: true,
            viewport: { width: 1920, height: 1080 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });
        
        const page = await context.newPage();
        
        // Store browser reference for cleanup
        page._browser = browser;
        page._context = context;
        
        // Override close to also close browser
        const originalClose = page.close.bind(page);
        page.close = async () => {
            await originalClose();
            await context.close().catch(() => {});
            await browser.close().catch(() => {});
        };
        
        return page;
    }

    /**
     * Configure page with options
     */
    async _configurePage(page, options) {
        // Set viewport if provided
        if (options.viewport) {
            await page.setViewportSize(options.viewport);
        }
        
        // Set user agent if provided
        if (options.userAgent) {
            await page.setExtraHTTPHeaders({
                'User-Agent': options.userAgent
            });
        }
        
        // Set extra headers if provided
        if (options.headers) {
            await page.setExtraHTTPHeaders(options.headers);
        }
        
        // Set cookies if provided
        if (options.cookies && options.cookies.length > 0) {
            await page.context().addCookies(options.cookies);
        }
        
        // Block resources if specified
        if (options.blockResources) {
            await page.route('**/*', (route) => {
                const resourceType = route.request().resourceType();
                if (options.blockResources.includes(resourceType)) {
                    route.abort();
                } else {
                    route.continue();
                }
            });
        }
        
        // Add stealth scripts if requested
        if (options.stealth) {
            await page.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined
                });
                
                Object.defineProperty(navigator, 'plugins', {
                    get: () => [1, 2, 3, 4, 5]
                });
                
                window.chrome = {
                    runtime: {},
                    loadTimes: function() {},
                    csi: function() {}
                };
            });
        }
    }

    /**
     * Get adapter capabilities
     */
    getCapabilities() {
        return {
            supportsJavaScript: true,
            supportsCookies: true,
            supportsProxy: true,
            supportsHeaders: true,
            supportsScreenshot: true,
            supportsUserAgent: true,
            supportsStealth: true,
            supportsCache: false,
            maxConcurrency: 10,
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
            activeRequests: 0,
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
        // Higher priority for JS-heavy sites
        const jsHeavyDomains = [
            'facebook.com',
            'twitter.com',
            'instagram.com',
            'linkedin.com',
            'youtube.com',
            'netflix.com',
            'amazon.com',
            'google.com/maps',
            'airbnb.com',
            'uber.com'
        ];
        
        const requiresBrowser = [
            'cloudflare.com/cdn-cgi/challenge',
            'recaptcha',
            'captcha',
            'challenge'
        ];
        
        // Check if URL requires browser
        const needsBrowser = requiresBrowser.some(pattern => url.includes(pattern));
        if (needsBrowser) {
            return 95; // Very high priority
        }
        
        // Check if JS-heavy domain
        const isJsHeavy = jsHeavyDomains.some(domain => url.includes(domain));
        if (isJsHeavy) {
            return 85; // High priority
        }
        
        // Default medium priority for browser adapter
        return 40;
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
        
        return this._getSuccessRate() > 0.7;
    }

    /**
     * Cleanup adapter
     */
    async cleanup() {
        this.initialized = false;
        return Promise.resolve();
    }
}

module.exports = EnhancedBrowserAdapter;
