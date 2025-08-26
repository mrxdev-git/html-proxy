/**
 * Migration Configuration for Enhanced Architecture
 * Provides feature flags and gradual rollout configuration
 */

const migrationConfig = {
    // Feature flags for gradual rollout
    features: {
        // Enable new architecture components
        useEnhancedFetcher: process.env.USE_ENHANCED_FETCHER === 'true' || false,
        useBrowserPool: process.env.USE_BROWSER_POOL === 'true' || false,
        useHttpPool: process.env.USE_HTTP_POOL === 'true' || false,
        useAdapterRouter: process.env.USE_ADAPTER_ROUTER === 'true' || false,
        useMetricsCollector: process.env.USE_METRICS_COLLECTOR === 'true' || false,
        useCircuitBreaker: process.env.USE_CIRCUIT_BREAKER === 'true' || false,
        
        // Gradual rollout percentages (0-100)
        enhancedFetcherRollout: parseInt(process.env.ENHANCED_FETCHER_ROLLOUT || '0', 10),
        browserPoolRollout: parseInt(process.env.BROWSER_POOL_ROLLOUT || '0', 10),
        
        // Monitoring and debugging
        enableDetailedLogging: process.env.ENABLE_DETAILED_LOGGING === 'true' || false,
        enablePerformanceTracking: process.env.ENABLE_PERFORMANCE_TRACKING === 'true' || false,
        enableMetricsPersistence: process.env.ENABLE_METRICS_PERSISTENCE === 'true' || false
    },
    
    // Pool configurations
    pools: {
        browser: {
            minSize: parseInt(process.env.BROWSER_POOL_MIN_SIZE || '2', 10),
            maxSize: parseInt(process.env.BROWSER_POOL_MAX_SIZE || '10', 10),
            preWarmCount: parseInt(process.env.BROWSER_POOL_PREWARM || '2', 10),
            evictionInterval: parseInt(process.env.BROWSER_POOL_EVICTION_INTERVAL || '300000', 10),
            maxIdleTime: parseInt(process.env.BROWSER_POOL_MAX_IDLE || '600000', 10),
            browserType: process.env.BROWSER_TYPE || 'chromium',
            headless: process.env.BROWSER_HEADLESS !== 'false',
            stealthMode: process.env.BROWSER_STEALTH_MODE === 'true' || true,
            fingerprintRotation: process.env.BROWSER_FINGERPRINT_ROTATION === 'true' || true
        },
        http: {
            minSize: parseInt(process.env.HTTP_POOL_MIN_SIZE || '5', 10),
            maxSize: parseInt(process.env.HTTP_POOL_MAX_SIZE || '50', 10),
            evictionInterval: parseInt(process.env.HTTP_POOL_EVICTION_INTERVAL || '60000', 10),
            maxIdleTime: parseInt(process.env.HTTP_POOL_MAX_IDLE || '300000', 10),
            proxyRotation: process.env.HTTP_PROXY_ROTATION === 'true' || false,
            userAgentRotation: process.env.HTTP_UA_ROTATION === 'true' || true
        }
    },
    
    // Adapter configurations
    adapters: {
        // Priority and scoring weights
        scoring: {
            performanceWeight: parseFloat(process.env.ADAPTER_PERFORMANCE_WEIGHT || '0.3'),
            successRateWeight: parseFloat(process.env.ADAPTER_SUCCESS_WEIGHT || '0.3'),
            capabilityWeight: parseFloat(process.env.ADAPTER_CAPABILITY_WEIGHT || '0.2'),
            priorityWeight: parseFloat(process.env.ADAPTER_PRIORITY_WEIGHT || '0.2')
        },
        
        // Circuit breaker settings
        circuitBreaker: {
            failureThreshold: parseInt(process.env.CB_FAILURE_THRESHOLD || '5', 10),
            successThreshold: parseInt(process.env.CB_SUCCESS_THRESHOLD || '2', 10),
            timeout: parseInt(process.env.CB_TIMEOUT || '60000', 10),
            monitoringPeriod: parseInt(process.env.CB_MONITORING_PERIOD || '60000', 10)
        },
        
        // Adapter-specific settings
        http: {
            enabled: process.env.HTTP_ADAPTER_ENABLED !== 'false',
            timeout: parseInt(process.env.HTTP_ADAPTER_TIMEOUT || '30000', 10),
            maxRedirects: parseInt(process.env.HTTP_MAX_REDIRECTS || '5', 10)
        },
        browser: {
            enabled: process.env.BROWSER_ADAPTER_ENABLED !== 'false',
            timeout: parseInt(process.env.BROWSER_ADAPTER_TIMEOUT || '60000', 10),
            waitUntil: process.env.BROWSER_WAIT_UNTIL || 'networkidle'
        },
        crawlee: {
            enabled: process.env.CRAWLEE_ADAPTER_ENABLED !== 'false',
            timeout: parseInt(process.env.CRAWLEE_ADAPTER_TIMEOUT || '60000', 10)
        }
    },
    
    // Service configurations
    services: {
        fetcher: {
            maxRetries: parseInt(process.env.FETCHER_MAX_RETRIES || '3', 10),
            retryDelay: parseInt(process.env.FETCHER_RETRY_DELAY || '1000', 10),
            timeout: parseInt(process.env.FETCHER_TIMEOUT || '30000', 10),
            cacheEnabled: process.env.FETCHER_CACHE_ENABLED !== 'false',
            cacheTTL: parseInt(process.env.FETCHER_CACHE_TTL || '3600000', 10)
        },
        metrics: {
            aggregationInterval: parseInt(process.env.METRICS_AGGREGATION_INTERVAL || '60000', 10),
            retentionPeriod: parseInt(process.env.METRICS_RETENTION_PERIOD || '86400000', 10),
            persistenceInterval: parseInt(process.env.METRICS_PERSISTENCE_INTERVAL || '300000', 10),
            persistencePath: process.env.METRICS_PERSISTENCE_PATH || './storage/metrics'
        },
        monitoring: {
            enabled: process.env.MONITORING_ENABLED === 'true' || false,
            port: parseInt(process.env.MONITORING_PORT || '9090', 10),
            dashboardEnabled: process.env.MONITORING_DASHBOARD === 'true' || false,
            alertsEnabled: process.env.MONITORING_ALERTS === 'true' || false
        }
    },
    
    // Migration helpers
    helpers: {
        /**
         * Check if enhanced architecture should be used for a request
         */
        shouldUseEnhanced(requestId) {
            if (!this.features.useEnhancedFetcher) {
                return false;
            }
            
            // Use rollout percentage for gradual migration
            const rolloutPercentage = this.features.enhancedFetcherRollout;
            if (rolloutPercentage === 100) {
                return true;
            }
            if (rolloutPercentage === 0) {
                return false;
            }
            
            // Use hash of requestId for consistent routing
            const hash = requestId ? 
                requestId.split('').reduce((a, b) => {
                    a = ((a << 5) - a) + b.charCodeAt(0);
                    return a & a;
                }, 0) : Math.random() * 100;
            
            return Math.abs(hash) % 100 < rolloutPercentage;
        },
        
        /**
         * Get active features list
         */
        getActiveFeatures() {
            return Object.entries(this.features)
                .filter(([_, enabled]) => enabled === true)
                .map(([feature]) => feature);
        },
        
        /**
         * Validate configuration
         */
        validate() {
            const errors = [];
            
            // Validate pool sizes
            if (this.pools.browser.minSize > this.pools.browser.maxSize) {
                errors.push('Browser pool minSize cannot be greater than maxSize');
            }
            if (this.pools.http.minSize > this.pools.http.maxSize) {
                errors.push('HTTP pool minSize cannot be greater than maxSize');
            }
            
            // Validate scoring weights
            const totalWeight = Object.values(this.adapters.scoring)
                .reduce((sum, weight) => sum + weight, 0);
            if (Math.abs(totalWeight - 1.0) > 0.01) {
                errors.push(`Adapter scoring weights should sum to 1.0, got ${totalWeight}`);
            }
            
            // Validate rollout percentages
            if (this.features.enhancedFetcherRollout < 0 || this.features.enhancedFetcherRollout > 100) {
                errors.push('Enhanced fetcher rollout must be between 0 and 100');
            }
            
            return errors;
        }
    }
};

// Bind helpers context
migrationConfig.helpers.shouldUseEnhanced = migrationConfig.helpers.shouldUseEnhanced.bind(migrationConfig);
migrationConfig.helpers.getActiveFeatures = migrationConfig.helpers.getActiveFeatures.bind(migrationConfig);
migrationConfig.helpers.validate = migrationConfig.helpers.validate.bind(migrationConfig);

module.exports = migrationConfig;
