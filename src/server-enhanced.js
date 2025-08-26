const express = require('express');
const cors = require('cors');
const { getArchitectureIntegration } = require('./services/ArchitectureIntegration');
const fetcherService = require('./services/fetcherService');
const logger = require('./logger');
const crypto = require('crypto');

/**
 * Enhanced Server with New Architecture Integration
 * This is an example of how to integrate the new architecture with gradual rollout
 */
class EnhancedServer {
    constructor(config = {}) {
        this.app = express();
        this.config = config;
        this.architecture = null;
        this.legacyFetcher = fetcherService;
    }

    /**
     * Initialize server and architecture
     */
    async initialize() {
        logger.info('Initializing enhanced server');
        
        // Setup middleware
        this.app.use(cors());
        this.app.use(express.json());
        this.app.use(express.urlencoded({ extended: true }));
        
        // Initialize enhanced architecture
        this.architecture = getArchitectureIntegration(this.config);
        await this.architecture.initialize();
        
        // Setup routes
        this._setupRoutes();
        
        // Setup health and monitoring endpoints
        this._setupMonitoring();
        
        logger.info('Enhanced server initialized');
    }

    /**
     * Setup API routes
     */
    _setupRoutes() {
        // Main fetch endpoint with gradual rollout
        this.app.post('/fetch', async (req, res) => {
            const requestId = crypto.randomBytes(8).toString('hex');
            const startTime = Date.now();
            
            try {
                const { url, options = {} } = req.body;
                
                if (!url) {
                    return res.status(400).json({
                        success: false,
                        error: 'URL is required'
                    });
                }
                
                logger.info('Fetch request received', {
                    requestId,
                    url,
                    options: Object.keys(options)
                });
                
                // Determine which fetcher to use
                const fetcher = this.architecture.getFetcher(requestId);
                
                let result;
                if (fetcher) {
                    // Use enhanced fetcher
                    result = await fetcher.fetch(url, {
                        ...options,
                        requestId
                    });
                    result.architecture = 'enhanced';
                } else {
                    // Use legacy fetcher
                    result = await this.legacyFetcher.fetch(url, options);
                    result.architecture = 'legacy';
                }
                
                // Add metadata
                result.requestId = requestId;
                result.duration = Date.now() - startTime;
                
                logger.info('Fetch completed', {
                    requestId,
                    architecture: result.architecture,
                    duration: result.duration,
                    status: result.status
                });
                
                res.json(result);
                
            } catch (error) {
                logger.error('Fetch failed', {
                    requestId,
                    error: error.message,
                    stack: error.stack
                });
                
                res.status(500).json({
                    success: false,
                    error: error.message,
                    requestId
                });
            }
        });
        
        // Batch fetch endpoint
        this.app.post('/fetch/batch', async (req, res) => {
            const batchId = crypto.randomBytes(8).toString('hex');
            
            try {
                const { urls, options = {} } = req.body;
                
                if (!urls || !Array.isArray(urls)) {
                    return res.status(400).json({
                        success: false,
                        error: 'URLs array is required'
                    });
                }
                
                logger.info('Batch fetch request', {
                    batchId,
                    count: urls.length
                });
                
                const results = await Promise.allSettled(
                    urls.map(async (url) => {
                        const requestId = crypto.randomBytes(8).toString('hex');
                        const fetcher = this.architecture.getFetcher(requestId);
                        
                        if (fetcher) {
                            return await fetcher.fetch(url, {
                                ...options,
                                requestId
                            });
                        } else {
                            return await this.legacyFetcher.fetch(url, options);
                        }
                    })
                );
                
                const response = {
                    success: true,
                    batchId,
                    results: results.map((result, index) => ({
                        url: urls[index],
                        success: result.status === 'fulfilled',
                        data: result.status === 'fulfilled' ? result.value : null,
                        error: result.status === 'rejected' ? result.reason.message : null
                    }))
                };
                
                res.json(response);
                
            } catch (error) {
                logger.error('Batch fetch failed', {
                    batchId,
                    error: error.message
                });
                
                res.status(500).json({
                    success: false,
                    error: error.message,
                    batchId
                });
            }
        });
        
        // Cache management endpoints
        this.app.post('/cache/clear', async (req, res) => {
            try {
                if (this.architecture.enhancedFetcher) {
                    await this.architecture.enhancedFetcher.clearCache();
                }
                
                res.json({
                    success: true,
                    message: 'Cache cleared'
                });
                
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });
    }

    /**
     * Setup monitoring endpoints
     */
    _setupMonitoring() {
        // Health check endpoint
        this.app.get('/health', async (req, res) => {
            try {
                const health = await this.architecture.healthCheck();
                const statusCode = health.status === 'healthy' ? 200 : 503;
                
                res.status(statusCode).json(health);
                
            } catch (error) {
                res.status(503).json({
                    status: 'error',
                    error: error.message
                });
            }
        });
        
        // Statistics endpoint
        this.app.get('/stats', (req, res) => {
            try {
                const stats = this.architecture.getStatistics();
                res.json(stats);
                
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });
        
        // Metrics endpoint (Prometheus format)
        this.app.get('/metrics', (req, res) => {
            try {
                if (!this.architecture.metricsCollector) {
                    return res.status(404).send('Metrics not enabled');
                }
                
                const metrics = this.architecture.metricsCollector.exportMetrics();
                
                // Convert to Prometheus format
                const prometheusMetrics = this._formatPrometheusMetrics(metrics);
                
                res.set('Content-Type', 'text/plain');
                res.send(prometheusMetrics);
                
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });
        
        // Configuration endpoint
        this.app.get('/config', (req, res) => {
            const config = {
                features: this.architecture.config.features,
                rollout: {
                    enhancedFetcher: this.architecture.config.features.enhancedFetcherRollout,
                    browserPool: this.architecture.config.features.browserPoolRollout
                },
                pools: {
                    browser: this.architecture.config.pools.browser,
                    http: this.architecture.config.pools.http
                }
            };
            
            res.json(config);
        });
        
        // Active requests endpoint
        this.app.get('/requests/active', (req, res) => {
            try {
                const activeRequests = this.architecture.enhancedFetcher
                    ? this.architecture.enhancedFetcher.getActiveRequests()
                    : [];
                
                res.json({
                    count: activeRequests.length,
                    requests: activeRequests
                });
                
            } catch (error) {
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });
    }

    /**
     * Format metrics for Prometheus
     */
    _formatPrometheusMetrics(metrics) {
        const lines = [];
        
        // Request metrics
        lines.push('# HELP http_requests_total Total number of HTTP requests');
        lines.push('# TYPE http_requests_total counter');
        lines.push(`http_requests_total ${metrics.requests.total}`);
        
        lines.push('# HELP http_requests_success_total Total number of successful requests');
        lines.push('# TYPE http_requests_success_total counter');
        lines.push(`http_requests_success_total ${metrics.requests.successful}`);
        
        lines.push('# HELP http_request_duration_seconds Request duration in seconds');
        lines.push('# TYPE http_request_duration_seconds histogram');
        if (metrics.requests.avgDuration) {
            lines.push(`http_request_duration_seconds_sum ${metrics.requests.totalDuration / 1000}`);
            lines.push(`http_request_duration_seconds_count ${metrics.requests.total}`);
        }
        
        // Adapter metrics
        Object.entries(metrics.adapters || {}).forEach(([name, adapter]) => {
            lines.push(`# HELP adapter_${name}_requests_total Total requests for ${name} adapter`);
            lines.push(`# TYPE adapter_${name}_requests_total counter`);
            lines.push(`adapter_${name}_requests_total ${adapter.requests}`);
            
            lines.push(`# HELP adapter_${name}_success_rate Success rate for ${name} adapter`);
            lines.push(`# TYPE adapter_${name}_success_rate gauge`);
            lines.push(`adapter_${name}_success_rate ${adapter.successRate}`);
        });
        
        // Pool metrics
        Object.entries(metrics.pools || {}).forEach(([name, pool]) => {
            lines.push(`# HELP pool_${name}_size Current size of ${name} pool`);
            lines.push(`# TYPE pool_${name}_size gauge`);
            lines.push(`pool_${name}_size ${pool.currentSize}`);
            
            lines.push(`# HELP pool_${name}_available Available resources in ${name} pool`);
            lines.push(`# TYPE pool_${name}_available gauge`);
            lines.push(`pool_${name}_available ${pool.available}`);
        });
        
        return lines.join('\n');
    }

    /**
     * Start the server
     */
    async start(port = 3000) {
        return new Promise((resolve) => {
            this.server = this.app.listen(port, () => {
                logger.info(`Enhanced server listening on port ${port}`);
                logger.info(`Health check: http://localhost:${port}/health`);
                logger.info(`Statistics: http://localhost:${port}/stats`);
                logger.info(`Metrics: http://localhost:${port}/metrics`);
                resolve();
            });
        });
    }

    /**
     * Graceful shutdown
     */
    async shutdown() {
        logger.info('Shutting down enhanced server');
        
        // Stop accepting new requests
        if (this.server) {
            await new Promise((resolve) => {
                this.server.close(resolve);
            });
        }
        
        // Shutdown architecture
        if (this.architecture) {
            await this.architecture.shutdown();
        }
        
        logger.info('Enhanced server shut down');
    }
}

// Export for use
module.exports = EnhancedServer;

// Run if executed directly
if (require.main === module) {
    const server = new EnhancedServer();
    
    server.initialize()
        .then(() => server.start(process.env.PORT || 3000))
        .catch((error) => {
            logger.error('Failed to start server', error);
            process.exit(1);
        });
    
    // Graceful shutdown handlers
    process.on('SIGTERM', async () => {
        logger.info('SIGTERM received');
        await server.shutdown();
        process.exit(0);
    });
    
    process.on('SIGINT', async () => {
        logger.info('SIGINT received');
        await server.shutdown();
        process.exit(0);
    });
}
