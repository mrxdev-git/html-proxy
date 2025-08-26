#!/usr/bin/env node

import MetricsCollector from './src/adapters/managers/MetricsCollector.js';
import ResourceManager from './src/adapters/managers/ResourceManager.js';
import AdapterRouter from './src/adapters/managers/AdapterRouter.js';
import BrowserPool from './src/adapters/pools/BrowserPool.js';
import HttpConnectionPool from './src/adapters/pools/HttpConnectionPool.js';
import EnhancedFetcherService from './src/services/EnhancedFetcherService.js';
import EnhancedHttpAdapter from './src/adapters/EnhancedHttpAdapter.js';
import EnhancedBrowserAdapter from './src/adapters/EnhancedBrowserAdapter.js';
import MonitoringDashboard from './src/services/MonitoringDashboard.js';
import PerformanceBenchmark from './src/services/PerformanceBenchmark.js';
import { FetcherService } from './src/services/fetcherService.js';
import { logger } from './src/logger.js';

/**
 * Simple demo script that directly initializes components
 */
async function runDemo() {
    logger.info('🚀 Starting Enhanced Architecture Demo with Monitoring & Benchmarking');
    
    try {
        // Initialize MetricsCollector
        logger.info('Initializing metrics collector...');
        const metricsCollector = new MetricsCollector({
            aggregationInterval: 5000,
            retentionPeriod: 3600000
        });
        
        // Initialize ResourceManager
        logger.info('Initializing resource manager...');
        const resourceManager = new ResourceManager();
        
        // Initialize pools
        logger.info('Initializing resource pools...');
        const browserPool = new BrowserPool({
            minSize: 1,
            maxSize: 3,
            preWarm: false
        });
        await browserPool.initialize();
        resourceManager.registerPool('browser', browserPool);
        
        const httpPool = new HttpConnectionPool({
            maxConnections: 10
        });
        await httpPool.initialize();
        resourceManager.registerPool('http', httpPool);
        
        // Initialize AdapterRouter
        logger.info('Initializing adapter router...');
        const adapterRouter = new AdapterRouter({
            metricsCollector
        });
        
        // Initialize adapters
        logger.info('Initializing adapters...');
        const httpAdapter = new EnhancedHttpAdapter({
            connectionPool: httpPool
        });
        await httpAdapter.initialize();
        adapterRouter.registerAdapter('http', httpAdapter);
        
        const browserAdapter = new EnhancedBrowserAdapter({
            browserPool
        });
        await browserAdapter.initialize();
        adapterRouter.registerAdapter('browser', browserAdapter);
        
        // Initialize EnhancedFetcherService
        logger.info('Initializing enhanced fetcher service...');
        const enhancedFetcher = new EnhancedFetcherService({
            resourceManager,
            adapterRouter,
            metricsCollector,
            config: {
                maxRetries: 2,
                retryDelay: 1000,
                timeout: 30000
            }
        });
        
        // Initialize monitoring dashboard
        logger.info('Initializing monitoring dashboard...');
        const dashboard = new MonitoringDashboard({
            port: 3001,
            updateInterval: 1000,
            alertThresholds: {
                errorRate: 0.1,
                responseTime: 3000,
                poolUtilization: 0.8
            }
        });
        
        await dashboard.initialize({
            metricsCollector,
            architecture: {
                initialized: true,
                resourceManager,
                adapterRouter,
                metricsCollector,
                enhancedFetcher
            }
        });
        
        // Start monitoring
        dashboard.start();
        logger.info('📊 Monitoring Dashboard available at http://localhost:3001');
        
        // Wait for dashboard to be ready
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        logger.info('');
        logger.info('='.repeat(60));
        logger.info('🚀 DEMO: Generating sample traffic for monitoring');
        logger.info('='.repeat(60));
        
        // Generate some sample traffic
        const sampleUrls = [
            'https://example.com',
            'https://httpbin.org/html',
            'https://httpbin.org/status/404', // Will cause error
            'https://www.google.com'
        ];
        
        // Sequential requests
        logger.info('Sending sequential requests...');
        for (const url of sampleUrls) {
            try {
                const result = await enhancedFetcher.fetch(url);
                logger.info(`✅ Fetched: ${url} (${result.html.length} bytes)`);
            } catch (error) {
                logger.warn(`❌ Failed: ${url} - ${error.message}`);
            }
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Concurrent requests
        logger.info('Sending concurrent requests...');
        const concurrentPromises = sampleUrls.map(url => 
            enhancedFetcher.fetch(url)
                .then(result => logger.info(`✅ Concurrent fetch: ${url} (${result.html.length} bytes)`))
                .catch(error => logger.warn(`❌ Concurrent fail: ${url} - ${error.message}`))
        );
        await Promise.all(concurrentPromises);
        
        // Initialize benchmark service
        logger.info('');
        logger.info('='.repeat(60));
        logger.info('📈 Running Performance Benchmarks');
        logger.info('='.repeat(60));
        
        const benchmark = new PerformanceBenchmark({
            iterations: 20,
            warmupIterations: 3,
            concurrency: 3,
            testUrls: [
                'https://example.com',
                'https://httpbin.org/html'
            ],
            scenarios: ['sequential', 'concurrent']
        });
        
        // Initialize legacy fetcher for comparison
        const legacyFetcher = new FetcherService({
            maxRetries: 2,
            timeout: 30000
        });
        
        // Initialize benchmark with both fetchers
        await benchmark.initialize(legacyFetcher, enhancedFetcher);
        
        logger.info('Running benchmarks (this may take a minute)...');
        const results = await benchmark.runBenchmarks();
        
        // Display results
        logger.info('');
        logger.info('='.repeat(60));
        logger.info('📊 BENCHMARK RESULTS');
        logger.info('='.repeat(60));
        
        for (const [scenario, data] of Object.entries(results.scenarios)) {
            logger.info(`\n${scenario.toUpperCase()} Scenario:`);
            logger.info('-'.repeat(40));
            
            if (data.legacy) {
                logger.info('Legacy Architecture:');
                logger.info(`  Avg Response Time: ${data.legacy.avgResponseTime?.toFixed(0)}ms`);
                logger.info(`  Throughput: ${data.legacy.throughput?.toFixed(1)} req/s`);
                logger.info(`  Success Rate: ${(data.legacy.successRate * 100).toFixed(1)}%`);
            }
            
            if (data.enhanced) {
                logger.info('Enhanced Architecture:');
                logger.info(`  Avg Response Time: ${data.enhanced.avgResponseTime?.toFixed(0)}ms`);
                logger.info(`  Throughput: ${data.enhanced.throughput?.toFixed(1)} req/s`);
                logger.info(`  Success Rate: ${(data.enhanced.successRate * 100).toFixed(1)}%`);
            }
            
            if (results.comparison && results.comparison[scenario]) {
                const comparison = results.comparison[scenario];
                logger.info('Improvements:');
                logger.info(`  Response Time: ${comparison.responseTimeImprovement > 0 ? '⬇️' : '⬆️'} ${Math.abs(comparison.responseTimeImprovement).toFixed(1)}%`);
                logger.info(`  Throughput: ${comparison.throughputImprovement > 0 ? '⬆️' : '⬇️'} ${Math.abs(comparison.throughputImprovement).toFixed(1)}%`);
            }
        }
        
        if (results.summary) {
            logger.info('');
            logger.info('='.repeat(60));
            logger.info('📋 OVERALL SUMMARY');
            logger.info('='.repeat(60));
            logger.info(`Average Response Time Improvement: ${results.summary.avgResponseTimeImprovement > 0 ? '⬇️' : '⬆️'} ${Math.abs(results.summary.avgResponseTimeImprovement).toFixed(1)}%`);
            logger.info(`Average Throughput Improvement: ${results.summary.avgThroughputImprovement > 0 ? '⬆️' : '⬇️'} ${Math.abs(results.summary.avgThroughputImprovement).toFixed(1)}%`);
            logger.info(`\nRecommendation: ${results.summary.recommendation}`);
        }
        
        // Export results
        await benchmark.exportResults('./benchmark-results.json');
        const htmlReport = benchmark.generateHTMLReport();
        const fs = await import('fs/promises');
        await fs.writeFile('./benchmark-report.html', htmlReport);
        
        logger.info('\n📄 Detailed reports saved:');
        logger.info('  - benchmark-results.json');
        logger.info('  - benchmark-report.html');
        
        // Get metrics summary
        const metricsSummary = metricsCollector.getSummary();
        logger.info('');
        logger.info('='.repeat(60));
        logger.info('🔧 METRICS SUMMARY');
        logger.info('='.repeat(60));
        logger.info(`Total Requests: ${metricsSummary.totalRequests || 0}`);
        logger.info(`Total Errors: ${metricsSummary.totalErrors || 0}`);
        logger.info(`Average Response Time: ${metricsSummary.avgResponseTime?.toFixed(0) || 0}ms`);
        
        logger.info('');
        logger.info('='.repeat(60));
        logger.info('✨ Demo Complete!');
        logger.info('='.repeat(60));
        logger.info('📊 Monitoring Dashboard is still running at http://localhost:3001');
        logger.info('Press Ctrl+C to stop the demo and shutdown services');
        
        // Handle graceful shutdown
        process.on('SIGINT', async () => {
            logger.info('\nShutting down services...');
            dashboard.stop();
            await browserPool.shutdown();
            await httpPool.shutdown();
            process.exit(0);
        });
        
    } catch (error) {
        logger.error('Demo failed:', error.message);
        console.error('Full error:', error);
        process.exit(1);
    }
}

// Run the demo
runDemo();
