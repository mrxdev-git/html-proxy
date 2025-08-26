const { ResourcePool } = require('../managers/ResourceManager');
const { chromium, firefox, webkit } = require('playwright');
const crypto = require('crypto');

/**
 * High-performance BrowserPool with pre-warming and fingerprint management
 */
class BrowserPool extends ResourcePool {
    constructor(config = {}) {
        super('BrowserPool', {
            minSize: config.minSize || 2,
            maxSize: config.maxSize || 10,
            acquireTimeout: config.acquireTimeout || 30000,
            idleTimeout: config.idleTimeout || 300000, // 5 minutes
            evictionInterval: config.evictionInterval || 60000,
            ...config
        });
        
        this.browserType = config.browserType || 'chromium';
        this.headless = config.headless !== false;
        this.prewarmPages = config.prewarmPages !== false;
        this.fingerprintRotation = config.fingerprintRotation !== false;
        this.stealthMode = config.stealthMode !== false;
        
        this.fingerprints = this._generateFingerprints();
        this.currentFingerprintIndex = 0;
        
        this.browserArgs = [
            '--disable-blink-features=AutomationControlled',
            '--disable-dev-shm-usage',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            ...(config.browserArgs || [])
        ];
        
        this.contextOptions = {
            ignoreHTTPSErrors: true,
            ...config.contextOptions
        };
    }

    /**
     * Create a new browser resource
     */
    async _createResource() {
        const startTime = Date.now();
        
        try {
            // Select browser engine
            const browserEngine = this._getBrowserEngine();
            
            // Get fingerprint for this browser
            const fingerprint = this._getNextFingerprint();
            
            // Launch browser with optimized settings
            const browser = await browserEngine.launch({
                headless: this.headless,
                args: this.browserArgs,
                ...fingerprint.launchOptions
            });
            
            // Create browser context with fingerprint
            const context = await browser.newContext({
                ...this.contextOptions,
                viewport: fingerprint.viewport,
                userAgent: fingerprint.userAgent,
                locale: fingerprint.locale,
                timezoneId: fingerprint.timezone,
                permissions: fingerprint.permissions,
                geolocation: fingerprint.geolocation
            });
            
            // Apply stealth measures
            if (this.stealthMode) {
                await this._applyStealthMeasures(context);
            }
            
            // Pre-warm pages if enabled
            const pages = [];
            if (this.prewarmPages) {
                const page = await context.newPage();
                await this._preparePage(page, fingerprint);
                pages.push(page);
            }
            
            const resource = {
                id: crypto.randomBytes(16).toString('hex'),
                browser,
                context,
                pages,
                fingerprint,
                created: Date.now(),
                lastUsed: Date.now(),
                requestCount: 0,
                errors: 0
            };
            
            this.resources.push(resource);
            this.available.push(resource);
            this.metrics.created++;
            
            this.emit('resource-created', {
                id: resource.id,
                duration: Date.now() - startTime
            });
            
            return resource;
        } catch (error) {
            this.metrics.errors++;
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Destroy a browser resource
     */
    async _destroyResource(resource) {
        try {
            // Close all pages
            for (const page of resource.pages) {
                await page.close().catch(() => {});
            }
            
            // Close context
            await resource.context.close().catch(() => {});
            
            // Close browser
            await resource.browser.close().catch(() => {});
            
            // Remove from resources array
            const index = this.resources.indexOf(resource);
            if (index !== -1) {
                this.resources.splice(index, 1);
            }
            
            this.metrics.destroyed++;
            this.emit('resource-destroyed', { id: resource.id });
        } catch (error) {
            this.emit('error', error);
        }
    }

    /**
     * Validate browser resource
     */
    async _validateResource(resource) {
        try {
            // Check if browser is still connected
            if (!resource.browser.isConnected()) {
                return false;
            }
            
            // Check error rate
            if (resource.errors > 5) {
                return false;
            }
            
            // Check age (rotate browsers periodically)
            const age = Date.now() - resource.created;
            if (age > 3600000) { // 1 hour
                return false;
            }
            
            // Check request count (rotate after many requests)
            if (resource.requestCount > 100) {
                return false;
            }
            
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get a page from browser resource
     */
    async getPage(resource) {
        try {
            // Reuse existing page if available
            if (resource.pages.length > 0) {
                const page = resource.pages[0];
                await page.goto('about:blank');
                return page;
            }
            
            // Create new page
            const page = await resource.context.newPage();
            await this._preparePage(page, resource.fingerprint);
            resource.pages.push(page);
            
            return page;
        } catch (error) {
            resource.errors++;
            throw error;
        }
    }

    /**
     * Prepare page with stealth and optimizations
     */
    async _preparePage(page, fingerprint) {
        // Set extra HTTP headers
        await page.setExtraHTTPHeaders({
            'Accept-Language': fingerprint.acceptLanguage,
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
        });
        
        // Inject stealth scripts
        if (this.stealthMode) {
            await page.addInitScript(() => {
                // Override navigator.webdriver
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined
                });
                
                // Override navigator.plugins
                Object.defineProperty(navigator, 'plugins', {
                    get: () => [1, 2, 3, 4, 5]
                });
                
                // Override navigator.languages
                Object.defineProperty(navigator, 'languages', {
                    get: () => ['en-US', 'en']
                });
                
                // Override Permissions API
                const originalQuery = window.navigator.permissions.query;
                window.navigator.permissions.query = (parameters) => (
                    parameters.name === 'notifications' ?
                        Promise.resolve({ state: Notification.permission }) :
                        originalQuery(parameters)
                );
                
                // Override Chrome runtime
                Object.defineProperty(window, 'chrome', {
                    get: () => ({
                        runtime: {},
                        loadTimes: function() {},
                        csi: function() {}
                    })
                });
            });
        }
        
        // Set default timeout
        page.setDefaultTimeout(30000);
        page.setDefaultNavigationTimeout(30000);
    }

    /**
     * Apply stealth measures to context
     */
    async _applyStealthMeasures(context) {
        await context.addInitScript(() => {
            // Hide automation indicators
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
            
            // Mock plugins
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5]
            });
            
            // Mock WebGL vendor
            const getParameter = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = function(parameter) {
                if (parameter === 37445) {
                    return 'Intel Inc.';
                }
                if (parameter === 37446) {
                    return 'Intel Iris OpenGL Engine';
                }
                return getParameter.apply(this, arguments);
            };
        });
    }

    /**
     * Generate fingerprints for rotation
     */
    _generateFingerprints() {
        const fingerprints = [];
        const viewports = [
            { width: 1920, height: 1080 },
            { width: 1366, height: 768 },
            { width: 1440, height: 900 },
            { width: 1536, height: 864 },
            { width: 1280, height: 720 }
        ];
        
        const userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ];
        
        const locales = ['en-US', 'en-GB', 'en-CA', 'en-AU'];
        const timezones = ['America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Europe/London'];
        
        for (let i = 0; i < 10; i++) {
            fingerprints.push({
                viewport: viewports[i % viewports.length],
                userAgent: userAgents[i % userAgents.length],
                locale: locales[i % locales.length],
                timezone: timezones[i % timezones.length],
                acceptLanguage: locales[i % locales.length],
                permissions: [],
                geolocation: null,
                launchOptions: {}
            });
        }
        
        return fingerprints;
    }

    /**
     * Get next fingerprint for rotation
     */
    _getNextFingerprint() {
        const fingerprint = this.fingerprints[this.currentFingerprintIndex];
        this.currentFingerprintIndex = (this.currentFingerprintIndex + 1) % this.fingerprints.length;
        return fingerprint;
    }

    /**
     * Get browser engine
     */
    _getBrowserEngine() {
        switch (this.browserType) {
            case 'firefox':
                return firefox;
            case 'webkit':
                return webkit;
            default:
                return chromium;
        }
    }

    /**
     * Get pool statistics
     */
    getStatistics() {
        const stats = {
            ...this.getMetrics(),
            browsers: this.resources.map(r => ({
                id: r.id,
                created: new Date(r.created).toISOString(),
                requestCount: r.requestCount,
                errors: r.errors,
                fingerprint: {
                    userAgent: r.fingerprint.userAgent.substring(0, 50) + '...',
                    viewport: r.fingerprint.viewport,
                    locale: r.fingerprint.locale
                }
            }))
        };
        
        return stats;
    }
}

module.exports = BrowserPool;
