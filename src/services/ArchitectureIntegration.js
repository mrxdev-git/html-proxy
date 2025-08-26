import ResourceManager from '../adapters/managers/ResourceManager.js';
import AdapterRouter from '../adapters/managers/AdapterRouter.js';
import MetricsCollector from '../adapters/managers/MetricsCollector.js';
import BrowserPool from '../adapters/pools/BrowserPool.js';
import HttpConnectionPool from '../adapters/pools/HttpConnectionPool.js';
import EnhancedFetcherService from './EnhancedFetcherService.js';
import EnhancedHttpAdapter from '../adapters/EnhancedHttpAdapter.js';
import EnhancedBrowserAdapter from '../adapters/EnhancedBrowserAdapter.js';
import migrationConfig from '../config/migration.js';
import { logger } from '../logger.js';

/**
 * Architecture Integration Service
 * Bootstraps and manages the enhanced architecture components
 */
class ArchitectureIntegration {
    constructor(config = {}) {
        this.config = { ...migrationConfig, ...config };
        this.initialized = false;
        
        // Core components
        this.resourceManager = null;
        this.adapterRouter = null;
        this.metricsCollector = null;
        this.enhancedFetcher = null;
        
        // Pools
        this.browserPool = null;
        this.httpPool = null;
        
        // Adapters
        this.adapters = new Map();
    }

    /**
     * Initialize the enhanced architecture
     */
    async initialize() {
        if (this.initialized) {
            logger.warn('Architecture already initialized');
            return;
        }
        
        logger.info('Initializing enhanced architecture');
        
        try {
            // Validate configuration
            const errors = this.config.helpers.validate();
            if (errors.length > 0) {
                throw new Error(`Configuration errors: ${errors.join(', ')}`);
            }
            
            // Initialize metrics collector
            if (this.config.features.useMetricsCollector) {
                await this._initializeMetrics();
            }
            
            // Initialize resource manager and pools
            if (this.config.features.useBrowserPool || this.config.features.useHttpPool) {
                await this._initializeResourceManager();
            }
            
            // Initialize adapter router
            if (this.config.features.useAdapterRouter) {
                await this._initializeAdapterRouter();
            }
            
            // Initialize enhanced fetcher service
            if (this.config.features.useEnhancedFetcher) {
                await this._initializeEnhancedFetcher();
            }
            
            this.initialized = true;
            
            logger.info('Enhanced architecture initialized successfully', {
                activeFeatures: this.config.helpers.getActiveFeatures()
            });
            
        } catch (error) {
            logger.error('Failed to initialize architecture', error);
            throw error;
        }
    }

    /**
     * Initialize metrics collector
     */
    async _initializeMetrics() {
        logger.info('Initializing metrics collector');
        
        this.metricsCollector = new MetricsCollector({
            aggregationInterval: this.config.services.metrics.aggregationInterval,
            retentionPeriod: this.config.services.metrics.retentionPeriod,
            persistToDisk: this.config.features.enableMetricsPersistence,
            persistencePath: this.config.services.metrics.persistencePath,
            persistenceInterval: this.config.services.metrics.persistenceInterval
        });
        
        await this.metricsCollector.initialize();
        
        // Setup event listeners
        this.metricsCollector.on('metrics-aggregated', (metrics) => {
            logger.debug('Metrics aggregated', { 
                requests: metrics.requests.total,
                adapters: Object.keys(metrics.adapters).length 
            });
        });
    }

    /**
     * Initialize resource manager and pools
     */
    async _initializeResourceManager() {
        logger.info('Initializing resource manager');
        
        this.resourceManager = new ResourceManager();
        
        // Initialize browser pool
        if (this.config.features.useBrowserPool) {
            logger.info('Creating browser pool');
            
            this.browserPool = new BrowserPool({
                minSize: this.config.pools.browser.minSize,
                maxSize: this.config.pools.browser.maxSize,
                browserType: this.config.pools.browser.browserType,
                headless: this.config.pools.browser.headless,
                preWarmCount: this.config.pools.browser.preWarmCount,
                evictionInterval: this.config.pools.browser.evictionInterval,
                maxIdleTime: this.config.pools.browser.maxIdleTime,
                stealthMode: this.config.pools.browser.stealthMode,
                fingerprintRotation: this.config.pools.browser.fingerprintRotation
            });
            
            await this.browserPool.initialize();
            this.resourceManager.registerPool('BrowserPool', this.browserPool);
        }
        
        // Initialize HTTP connection pool
        if (this.config.features.useHttpPool) {
            logger.info('Creating HTTP connection pool');
            
            this.httpPool = new HttpConnectionPool({
                minSize: this.config.pools.http.minSize,
                maxSize: this.config.pools.http.maxSize,
                evictionInterval: this.config.pools.http.evictionInterval,
                maxIdleTime: this.config.pools.http.maxIdleTime,
                proxyRotation: this.config.pools.http.proxyRotation,
                userAgentRotation: this.config.pools.http.userAgentRotation
            });
            
            await this.httpPool.initialize();
            this.resourceManager.registerPool('HttpConnectionPool', this.httpPool);
        }
    }

    /**
     * Initialize adapter router
     */
    async _initializeAdapterRouter() {
        logger.info('Initializing adapter router');
        
        this.adapterRouter = new AdapterRouter({
            circuitBreakerEnabled: this.config.features.useCircuitBreaker,
            circuitBreakerConfig: this.config.adapters.circuitBreaker,
            scoringWeights: this.config.adapters.scoring,
            metricsCollector: this.metricsCollector
        });
        
        // Register adapters
        await this._registerAdapters();
        
        // Setup routing rules
        this._setupRoutingRules();
    }

    /**
     * Register adapters with router
     */
    async _registerAdapters() {
        // Register HTTP adapter
        if (this.config.adapters.http.enabled) {
            const httpAdapter = new EnhancedHttpAdapter({
                timeout: this.config.adapters.http.timeout,
                maxRedirects: this.config.adapters.http.maxRedirects,
                connectionPool: this.httpPool
            });
            
            await httpAdapter.initialize();
            this.adapters.set('http', httpAdapter);
            
            this.adapterRouter.registerAdapter('http', httpAdapter, {
                priority: 70,
                capabilities: httpAdapter.getCapabilities()
            });
            
            logger.info('Registered HTTP adapter');
        }
        
        // Register browser adapter
        if (this.config.adapters.browser.enabled) {
            const browserAdapter = new EnhancedBrowserAdapter({
                timeout: this.config.adapters.browser.timeout,
                headless: this.config.pools.browser.headless,
                browserPool: this.browserPool
            });
            
            await browserAdapter.initialize();
            this.adapters.set('browser', browserAdapter);
            
            this.adapterRouter.registerAdapter('browser', browserAdapter, {
                priority: 50,
                capabilities: browserAdapter.getCapabilities()
            });
            
            logger.info('Registered browser adapter');
        }
        
        // Note: Add Crawlee adapters here when migrated
    }

    /**
     * Setup routing rules
     */
    _setupRoutingRules() {
        // API endpoints prefer HTTP adapter
        this.adapterRouter.addRoutingRule({
            name: 'api-endpoints',
            pattern: /\/api\/|\.json$/,
            preferredAdapter: 'http',
            priority: 100
        });
        
        // JavaScript-heavy sites prefer browser
        const jsHeavySites = [
            'facebook.com', 'twitter.com', 'instagram.com',
            'linkedin.com', 'youtube.com', 'netflix.com'
        ];
        
        jsHeavySites.forEach(site => {
            this.adapterRouter.addRoutingRule({
                name: `js-heavy-${site}`,
                pattern: site,
                preferredAdapter: 'browser',
                priority: 90
            });
        });
        
        // Cloudflare challenges require browser
        this.adapterRouter.addRoutingRule({
            name: 'cloudflare-challenge',
            pattern: /cloudflare.*challenge|recaptcha|captcha/i,
            preferredAdapter: 'browser',
            priority: 95
        });
        
        logger.info('Routing rules configured');
    }

    /**
     * Initialize enhanced fetcher service
     */
    async _initializeEnhancedFetcher() {
        logger.info('Initializing enhanced fetcher service');
        
        // Get cache service if available
        let cacheService = null;
        try {
            const cacheModule = await import('./cacheService.js');
            cacheService = cacheModule.default;
        } catch (error) {
            logger.debug('Cache service not available');
        }
        
        this.enhancedFetcher = new EnhancedFetcherService({
            resourceManager: this.resourceManager,
            adapterRouter: this.adapterRouter,
            cacheService: cacheService,
            metricsCollector: this.metricsCollector,
            config: this.config.services.fetcher
        });
        
        await this.enhancedFetcher.warmup();
        
        // Setup event listeners
        this.enhancedFetcher.on('fallback', (data) => {
            logger.warn('Fetcher fallback triggered', data);
        });
        
        this.enhancedFetcher.on('pool-error', (data) => {
            logger.error('Pool error in fetcher', data);
        });
    }

    /**
     * Get fetcher service (enhanced or legacy)
     */
    getFetcher(requestId) {
        // Check if should use enhanced architecture
        if (this.config.helpers.shouldUseEnhanced(requestId)) {
            if (!this.enhancedFetcher) {
                throw new Error('Enhanced fetcher not initialized');
            }
            logger.debug('Using enhanced fetcher', { requestId });
            return this.enhancedFetcher;
        }
        
        // Return null to indicate legacy fetcher should be used
        logger.debug('Using legacy fetcher', { requestId });
        return null;
    }

    /**
     * Get statistics from all components
     */
    getStatistics() {
        const stats = {
            initialized: this.initialized,
            activeFeatures: this.config.helpers.getActiveFeatures(),
            rolloutPercentage: this.config.features.enhancedFetcherRollout
        };
        
        if (this.enhancedFetcher) {
            stats.fetcher = this.enhancedFetcher.getStatistics();
        }
        
        if (this.resourceManager) {
            stats.pools = this.resourceManager.getMetrics();
        }
        
        if (this.adapterRouter) {
            stats.adapters = this.adapterRouter.getMetrics();
        }
        
        if (this.metricsCollector) {
            stats.metrics = this.metricsCollector.getMetricsSummary();
        }
        
        return stats;
    }

    /**
     * Health check
     */
    async healthCheck() {
        const health = {
            status: 'healthy',
            components: {}
        };
        
        // Check resource manager
        if (this.resourceManager) {
            const pools = this.resourceManager.getMetrics();
            health.components.resourceManager = {
                status: 'healthy',
                pools: Object.keys(pools).length
            };
        }
        
        // Check adapters
        if (this.adapterRouter) {
            const adapters = this.adapterRouter.getAdapters();
            health.components.adapters = {};
            
            for (const [name, adapter] of adapters) {
                const metrics = adapter.getHealthMetrics();
                health.components.adapters[name] = {
                    status: metrics.isHealthy ? 'healthy' : 'unhealthy',
                    successRate: Math.round(metrics.avgResponseTime)
                };
            }
        }
        
        // Check if any component is unhealthy
        const unhealthyComponents = Object.entries(health.components)
            .filter(([_, component]) => 
                component.status === 'unhealthy' ||
                (component.adapters && Object.values(component.adapters)
                    .some(a => a.status === 'unhealthy'))
            );
        
        if (unhealthyComponents.length > 0) {
            health.status = 'degraded';
            health.unhealthyComponents = unhealthyComponents.map(([name]) => name);
        }
        
        return health;
    }

    /**
     * Shutdown all components gracefully
     */
    async shutdown() {
        logger.info('Shutting down enhanced architecture');
        
        try {
            // Shutdown fetcher first to stop new requests
            if (this.enhancedFetcher) {
                await this.enhancedFetcher.shutdown();
            }
            
            // Shutdown router
            if (this.adapterRouter) {
                await this.adapterRouter.shutdown();
            }
            
            // Shutdown resource manager and pools
            if (this.resourceManager) {
                await this.resourceManager.shutdown();
            }
            
            // Shutdown metrics collector
            if (this.metricsCollector) {
                await this.metricsCollector.shutdown();
            }
            
            // Cleanup adapters
            for (const [name, adapter] of this.adapters) {
                if (adapter.cleanup) {
                    await adapter.cleanup();
                }
            }
            
            this.initialized = false;
            logger.info('Enhanced architecture shut down successfully');
            
        } catch (error) {
            logger.error('Error during architecture shutdown', error);
            throw error;
        }
    }
}

// Singleton instance
let instance = null;

/**
 * Get or create architecture integration instance
 */
function getArchitectureIntegration(config) {
    if (!instance) {
        instance = new ArchitectureIntegration(config);
    }
    return instance;
}

export {
    ArchitectureIntegration,
    getArchitectureIntegration
};
