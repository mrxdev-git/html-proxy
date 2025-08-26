#!/usr/bin/env node

import { logger } from './src/logger.js';
import MetricsCollector from './src/adapters/managers/MetricsCollector.js';
import ResourceManager from './src/adapters/managers/ResourceManager.js';
import BrowserPool from './src/adapters/pools/BrowserPool.js';
import HttpConnectionPool from './src/adapters/pools/HttpConnectionPool.js';
import AdapterRouter from './src/adapters/managers/AdapterRouter.js';
import EnhancedHttpAdapter from './src/adapters/EnhancedHttpAdapter.js';
import EnhancedBrowserAdapter from './src/adapters/EnhancedBrowserAdapter.js';
import EnhancedFetcherService from './src/services/EnhancedFetcherService.js';
import MonitoringDashboard from './src/services/MonitoringDashboard.js';
import express from 'express';

/**
 * Full integration demo with real HTTP/Browser fetching
 */
async function runFullIntegrationDemo() {
    logger.info('🚀 Starting Full Integration Demo with Real Fetching');
    
    let browserPool = null;
    let httpPool = null;
    let dashboard = null;
    let server = null;
    
    try {
        // 1. Initialize MetricsCollector
        logger.info('Initializing metrics collector...');
        const metricsCollector = new MetricsCollector({
            persistInterval: 60000,
            aggregationInterval: 10000
        });
        
        // 2. Initialize ResourceManager
        logger.info('Initializing resource manager...');
        const resourceManager = new ResourceManager();
        
        // 3. Initialize resource pools
        logger.info('Initializing resource pools...');
        
        // Browser pool with minimal configuration for testing
        browserPool = new BrowserPool({
            minSize: 1,
            maxSize: 2,
            acquireTimeout: 30000,
            idleTimeout: 300000,
            evictionInterval: 60000,
            prewarmOnInit: false  // Disable prewarming for faster startup
        });
        
        // HTTP connection pool
        httpPool = new HttpConnectionPool({
            minSize: 2,
            maxSize: 5,
            acquireTimeout: 10000,
            idleTimeout: 60000
        });
        
        // Initialize pools
        await browserPool.initialize();
        await httpPool.initialize();
        
        // Register pools with resource manager (use internal pool names)
        resourceManager.registerPool('BrowserPool', browserPool);
        resourceManager.registerPool('HttpConnectionPool', httpPool);
        
        // 4. Initialize AdapterRouter
        logger.info('Initializing adapter router...');
        const adapterRouter = new AdapterRouter({
            metricsCollector,
            resourceManager,
            circuitBreakerThreshold: 5,
            circuitBreakerTimeout: 60000
        });
        
        // 5. Initialize real adapters
        logger.info('Initializing adapters...');
        
        // Enhanced HTTP Adapter with real fetching
        const httpAdapter = new EnhancedHttpAdapter({
            timeout: 30000,
            maxRedirects: 5,
            connectionPool: httpPool
        });
        await httpAdapter.initialize();
        
        // Enhanced Browser Adapter with real Playwright
        const browserAdapter = new EnhancedBrowserAdapter({
            browserPool,
            timeout: 30000,
            waitUntil: 'networkidle',
            blockResources: ['image', 'media', 'font']
        });
        await browserAdapter.initialize();
        
        // Register adapters with router
        adapterRouter.registerAdapter('http', httpAdapter);
        adapterRouter.registerAdapter('browser', browserAdapter);
        
        // 6. Initialize EnhancedFetcherService
        logger.info('Initializing enhanced fetcher service...');
        const fetcherService = new EnhancedFetcherService({
            adapterRouter,
            metricsCollector,
            resourceManager,  // Add resourceManager to dependencies
            maxRetries: 2,
            retryDelay: 1000,
            timeout: 30000
        });
        
        // 7. Initialize monitoring dashboard
        logger.info('Initializing monitoring dashboard...');
        dashboard = new MonitoringDashboard({
            port: 3002,
            metricsCollector,
            architecture: {
                resourceManager,
                adapterRouter
            },
            updateInterval: 1000
        });
        
        await dashboard.start();
        logger.info(`📊 Monitoring Dashboard available at http://localhost:3002`);
        
        // 8. Create API server for testing
        const app = express();
        app.use(express.json());
        
        // Test endpoint for fetching URLs
        app.post('/fetch', async (req, res) => {
            const { url, adapter } = req.body;
            
            if (!url) {
                return res.status(400).json({ error: 'URL is required' });
            }
            
            try {
                logger.info(`Fetching ${url} with ${adapter || 'auto'} adapter...`);
                const result = await fetcherService.fetch(url, { 
                    preferredAdapter: adapter,
                    timeout: 30000
                });
                
                res.json({
                    success: true,
                    url,
                    adapter: result.adapter,
                    contentLength: result.html ? result.html.length : 0,
                    title: extractTitle(result.html),
                    responseTime: result.responseTime,
                    content: result.html  // Include the actual content
                });
            } catch (error) {
                logger.error(`Fetch failed for ${url}:`, error.message);
                res.status(500).json({
                    success: false,
                    error: error.message
                });
            }
        });
        
        // Health check endpoint
        app.get('/health', (req, res) => {
            const metrics = metricsCollector.getSummary();
            const pools = resourceManager.getAllMetrics();
            
            res.json({
                status: 'healthy',
                metrics: {
                    totalRequests: metrics.totalRequests,
                    successRate: metrics.successfulRequests / metrics.totalRequests || 0,
                    avgResponseTime: metrics.avgResponseTime
                },
                pools: Object.entries(pools).reduce((acc, [name, pool]) => {
                    acc[name] = {
                        available: pool.pool?.available || 0,
                        inUse: pool.pool?.inUse || 0,
                        total: pool.pool?.total || 0
                    };
                    return acc;
                }, {})
            });
        });
        
        const port = 3003;
        server = app.listen(port, () => {
            logger.info(`🌐 API Server running at http://localhost:${port}`);
            logger.info('');
            logger.info('='.repeat(60));
            logger.info('✨ Full Integration Demo Running Successfully!');
            logger.info('='.repeat(60));
            logger.info('');
            logger.info('Available endpoints:');
            logger.info('  📊 Monitoring Dashboard: http://localhost:3002');
            logger.info('  🌐 API Server: http://localhost:3003');
            logger.info('');
            logger.info('Test the fetcher with:');
            logger.info('  curl -X POST http://localhost:3003/fetch \\');
            logger.info('    -H "Content-Type: application/json" \\');
            logger.info('    -d \'{"url":"https://example.com"}\'');
            logger.info('');
            logger.info('Check health status:');
            logger.info('  curl http://localhost:3003/health');
            logger.info('');
            logger.info('Press Ctrl+C to stop the demo.');
        });
        
        // 9. Run some test fetches
        setTimeout(async () => {
            logger.info('Running test fetches...');
            const testUrls = [
                'https://example.com',
                'https://www.wikipedia.org',
                'https://httpbin.org/html'
            ];
            
            for (const url of testUrls) {
                try {
                    logger.info(`Testing fetch for ${url}...`);
                    const result = await fetcherService.fetch(url);
                    const contentLength = result.html ? result.html.length : 0;
                    logger.info(`✅ Successfully fetched ${url} using ${result.adapter} adapter (${contentLength} bytes)`);
                } catch (error) {
                    logger.error(`❌ Failed to fetch ${url}: ${error.message}`);
                }
                
                // Wait a bit between fetches
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
            logger.info('Test fetches completed. You can now test manually using the API endpoints.');
        }, 3000);
        
        // Handle graceful shutdown
        process.on('SIGINT', async () => {
            logger.info('\nShutting down full integration demo...');
            
            if (server) {
                server.close();
            }
            
            if (dashboard) {
                await dashboard.stop();
            }
            
            if (resourceManager) {
                await resourceManager.shutdown();
            }
            
            logger.info('Demo stopped. Goodbye!');
            process.exit(0);
        });
        
    } catch (error) {
        logger.error('Demo failed:', error.message);
        console.error('Full error:', error);
        
        // Cleanup on error
        if (browserPool) await browserPool.shutdown().catch(() => {});
        if (httpPool) await httpPool.shutdown().catch(() => {});
        if (dashboard) await dashboard.stop().catch(() => {});
        if (server) server.close();
        
        process.exit(1);
    }
}

// Helper function to extract title from HTML
function extractTitle(html) {
    if (!html) return null;
    const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    return match ? match[1].trim() : null;
}

// Run the demo
runFullIntegrationDemo();
