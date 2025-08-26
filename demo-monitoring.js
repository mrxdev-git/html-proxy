#!/usr/bin/env node

import { ArchitectureIntegration } from './src/services/ArchitectureIntegration.js';
import MonitoringDashboard from './src/services/MonitoringDashboard.js';
import PerformanceBenchmark from './src/services/PerformanceBenchmark.js';
import { FetcherService } from './src/services/fetcherService.js';
import { logger } from './src/logger.js';

/**
 * Demo script for monitoring dashboard and performance benchmarking
 */
async function runDemo() {
    logger.info('Starting Enhanced Architecture Demo with Monitoring & Benchmarking');
    
    // Set required environment variables for the demo BEFORE importing config
    process.env.USE_ENHANCED_FETCHER = 'true';
    process.env.USE_METRICS_COLLECTOR = 'true';
    process.env.USE_ADAPTER_ROUTER = 'true';
    process.env.USE_BROWSER_POOL = 'true';
    process.env.USE_HTTP_POOL = 'true';
    process.env.USE_CIRCUIT_BREAKER = 'true';
    
    // Import migration config after setting env vars
    const { default: migrationConfig } = await import('./src/config/migration.js');
    
    // Initialize architecture with proper config
    const architecture = new ArchitectureIntegration(migrationConfig);
    await architecture.initialize();
    
    // Debug: Check if metricsCollector is initialized
    console.log('Architecture initialized:', {
        hasMetricsCollector: !!architecture.metricsCollector,
        metricsCollector: architecture.metricsCollector
    });
    
    // Wait for architecture to be fully initialized
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Initialize monitoring dashboard
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
        metricsCollector: architecture.metricsCollector,
        architecture: architecture
    });
    
    // Start monitoring
    dashboard.start();
    logger.info('📊 Monitoring Dashboard available at http://localhost:3001');
    
    // Initialize benchmark service
    const benchmark = new PerformanceBenchmark({
        iterations: 50,
        warmupIterations: 5,
        concurrency: 5,
        testUrls: [
            'https://example.com',
            'https://httpbin.org/html',
            'https://www.google.com'
        ],
        scenarios: ['sequential', 'concurrent']
    });
    
    // Initialize legacy fetcher for comparison
    const legacyFetcher = new FetcherService();
    
    // Initialize benchmark with both fetchers
    await benchmark.initialize(legacyFetcher, architecture.enhancedFetcher);
    
    // Wait a moment for dashboard to be ready
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
        'https://www.google.com',
        'https://github.com'
    ];
    
    // Sequential requests
    logger.info('Sending sequential requests...');
    for (const url of sampleUrls) {
        try {
            await architecture.enhancedFetcher.fetch(url);
            logger.info(`✅ Fetched: ${url}`);
        } catch (error) {
            logger.warn(`❌ Failed: ${url}`);
        }
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Concurrent requests
    logger.info('Sending concurrent requests...');
    const concurrentPromises = sampleUrls.map(url => 
        architecture.enhancedFetcher.fetch(url)
            .then(() => logger.info(`✅ Concurrent fetch: ${url}`))
            .catch(() => logger.warn(`❌ Concurrent fail: ${url}`))
    );
    await Promise.all(concurrentPromises);
    
    logger.info('');
    logger.info('='.repeat(60));
    logger.info('📈 Running Performance Benchmarks');
    logger.info('='.repeat(60));
    logger.info('This will compare legacy vs enhanced architecture performance');
    logger.info('Please wait, this may take a minute...');
    
    // Run benchmarks
    const results = await benchmark.runBenchmarks();
    
    // Display results
    logger.info('');
    logger.info('='.repeat(60));
    logger.info('📊 BENCHMARK RESULTS');
    logger.info('='.repeat(60));
    
    for (const [scenario, data] of Object.entries(results.scenarios)) {
        logger.info(`\n${scenario.toUpperCase()} Scenario:`);
        logger.info('-'.repeat(40));
        
        logger.info('Legacy Architecture:');
        logger.info(`  Avg Response Time: ${data.legacy.avgResponseTime?.toFixed(0)}ms`);
        logger.info(`  Throughput: ${data.legacy.throughput?.toFixed(1)} req/s`);
        logger.info(`  Success Rate: ${(data.legacy.successRate * 100).toFixed(1)}%`);
        
        logger.info('Enhanced Architecture:');
        logger.info(`  Avg Response Time: ${data.enhanced.avgResponseTime?.toFixed(0)}ms`);
        logger.info(`  Throughput: ${data.enhanced.throughput?.toFixed(1)} req/s`);
        logger.info(`  Success Rate: ${(data.enhanced.successRate * 100).toFixed(1)}%`);
        
        const comparison = results.comparison[scenario];
        logger.info('Improvements:');
        logger.info(`  Response Time: ${comparison.responseTimeImprovement > 0 ? '⬇️' : '⬆️'} ${Math.abs(comparison.responseTimeImprovement).toFixed(1)}%`);
        logger.info(`  Throughput: ${comparison.throughputImprovement > 0 ? '⬆️' : '⬇️'} ${Math.abs(comparison.throughputImprovement).toFixed(1)}%`);
    }
    
    logger.info('');
    logger.info('='.repeat(60));
    logger.info('📋 OVERALL SUMMARY');
    logger.info('='.repeat(60));
    logger.info(`Average Response Time Improvement: ${results.summary.avgResponseTimeImprovement > 0 ? '⬇️' : '⬆️'} ${Math.abs(results.summary.avgResponseTimeImprovement).toFixed(1)}%`);
    logger.info(`Average Throughput Improvement: ${results.summary.avgThroughputImprovement > 0 ? '⬆️' : '⬇️'} ${Math.abs(results.summary.avgThroughputImprovement).toFixed(1)}%`);
    logger.info(`\nRecommendation: ${results.summary.recommendation}`);
    
    // Export results
    await benchmark.exportResults('./benchmark-results.json');
    
    // Generate HTML report
    const htmlReport = benchmark.generateHTMLReport();
    const fs = await import('fs/promises');
    await fs.writeFile('./benchmark-report.html', htmlReport);
    logger.info('\n📄 Detailed reports saved:');
    logger.info('  - benchmark-results.json');
    logger.info('  - benchmark-report.html');
    
    // Get architecture status
    const status = architecture.getStatistics();
    logger.info('');
    logger.info('='.repeat(60));
    logger.info('🔧 ARCHITECTURE STATUS');
    logger.info('='.repeat(60));
    logger.info(`Total Requests: ${status.totalRequests}`);
    logger.info(`Cache Hit Rate: ${(status.cacheHitRate * 100).toFixed(1)}%`);
    logger.info(`Active Pools: ${status.activePools}`);
    logger.info(`Active Adapters: ${status.activeAdapters}`);
    
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
        await architecture.shutdown();
        process.exit(0);
    });
}

// Run the demo
runDemo().catch(error => {
    logger.error('Demo failed:', error.message);
    console.error('Full error:', error);
    process.exit(1);
});
