import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';
import { logger } from '../logger.js';

/**
 * Performance Benchmark Service
 * Runs comprehensive benchmarks to validate architectural improvements
 */
class PerformanceBenchmark extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            iterations: config.iterations || 100,
            warmupIterations: config.warmupIterations || 10,
            concurrency: config.concurrency || 10,
            testUrls: config.testUrls || [
                'https://example.com',
                'https://httpbin.org/html',
                'https://www.google.com',
                'https://github.com'
            ],
            scenarios: config.scenarios || ['sequential', 'concurrent', 'mixed'],
            ...config
        };
        
        this.results = {
            timestamp: null,
            scenarios: {},
            comparison: null,
            summary: null
        };
        
        this.legacyFetcher = null;
        this.enhancedFetcher = null;
    }
    
    /**
     * Initialize benchmark with fetcher services
     */
    async initialize(legacyFetcher, enhancedFetcher) {
        this.legacyFetcher = legacyFetcher;
        this.enhancedFetcher = enhancedFetcher;
        
        if (!this.legacyFetcher || !this.enhancedFetcher) {
            throw new Error('Both legacy and enhanced fetchers are required for benchmarking');
        }
        
        logger.info('Performance benchmark initialized');
    }
    
    /**
     * Run all benchmark scenarios
     */
    async runBenchmarks() {
        logger.info('Starting performance benchmarks...');
        this.results.timestamp = new Date().toISOString();
        
        // Warmup phase
        await this._warmup();
        
        // Run each scenario
        for (const scenario of this.config.scenarios) {
            logger.info(`Running ${scenario} scenario...`);
            
            switch (scenario) {
                case 'sequential':
                    await this._runSequentialBenchmark();
                    break;
                case 'concurrent':
                    await this._runConcurrentBenchmark();
                    break;
                case 'mixed':
                    await this._runMixedBenchmark();
                    break;
                default:
                    logger.warn(`Unknown scenario: ${scenario}`);
            }
        }
        
        // Generate comparison and summary
        this._generateComparison();
        this._generateSummary();
        
        logger.info('Benchmarks completed');
        this.emit('completed', this.results);
        
        return this.results;
    }
    
    /**
     * Warmup phase to stabilize performance
     */
    async _warmup() {
        logger.info('Running warmup iterations...');
        
        const warmupUrl = this.config.testUrls[0];
        const promises = [];
        
        for (let i = 0; i < this.config.warmupIterations; i++) {
            promises.push(
                this.enhancedFetcher.fetch(warmupUrl).catch(() => null)
            );
            
            if (promises.length >= 5) {
                await Promise.all(promises);
                promises.length = 0;
            }
        }
        
        if (promises.length > 0) {
            await Promise.all(promises);
        }
        
        logger.info('Warmup completed');
    }
    
    /**
     * Run sequential benchmark (one request at a time)
     */
    async _runSequentialBenchmark() {
        const scenario = 'sequential';
        this.results.scenarios[scenario] = {
            legacy: await this._runSequentialTest(this.legacyFetcher),
            enhanced: await this._runSequentialTest(this.enhancedFetcher)
        };
    }
    
    /**
     * Run sequential test for a fetcher
     */
    async _runSequentialTest(fetcher) {
        const metrics = {
            totalTime: 0,
            avgResponseTime: 0,
            minResponseTime: Infinity,
            maxResponseTime: 0,
            successCount: 0,
            errorCount: 0,
            responseTimes: []
        };
        
        const startTime = performance.now();
        
        for (let i = 0; i < this.config.iterations; i++) {
            const url = this.config.testUrls[i % this.config.testUrls.length];
            const requestStart = performance.now();
            
            try {
                await fetcher.fetch(url);
                const requestTime = performance.now() - requestStart;
                
                metrics.responseTimes.push(requestTime);
                metrics.minResponseTime = Math.min(metrics.minResponseTime, requestTime);
                metrics.maxResponseTime = Math.max(metrics.maxResponseTime, requestTime);
                metrics.successCount++;
            } catch (error) {
                metrics.errorCount++;
            }
        }
        
        metrics.totalTime = performance.now() - startTime;
        metrics.avgResponseTime = metrics.responseTimes.reduce((a, b) => a + b, 0) / metrics.responseTimes.length;
        metrics.throughput = (metrics.successCount / metrics.totalTime) * 1000; // requests per second
        metrics.successRate = metrics.successCount / this.config.iterations;
        
        // Calculate percentiles
        const sorted = [...metrics.responseTimes].sort((a, b) => a - b);
        metrics.p50 = this._percentile(sorted, 50);
        metrics.p95 = this._percentile(sorted, 95);
        metrics.p99 = this._percentile(sorted, 99);
        
        return metrics;
    }
    
    /**
     * Run concurrent benchmark (multiple requests in parallel)
     */
    async _runConcurrentBenchmark() {
        const scenario = 'concurrent';
        this.results.scenarios[scenario] = {
            legacy: await this._runConcurrentTest(this.legacyFetcher),
            enhanced: await this._runConcurrentTest(this.enhancedFetcher)
        };
    }
    
    /**
     * Run concurrent test for a fetcher
     */
    async _runConcurrentTest(fetcher) {
        const metrics = {
            totalTime: 0,
            avgResponseTime: 0,
            minResponseTime: Infinity,
            maxResponseTime: 0,
            successCount: 0,
            errorCount: 0,
            responseTimes: []
        };
        
        const startTime = performance.now();
        const batches = Math.ceil(this.config.iterations / this.config.concurrency);
        
        for (let batch = 0; batch < batches; batch++) {
            const promises = [];
            const batchSize = Math.min(
                this.config.concurrency,
                this.config.iterations - batch * this.config.concurrency
            );
            
            for (let i = 0; i < batchSize; i++) {
                const url = this.config.testUrls[i % this.config.testUrls.length];
                const requestStart = performance.now();
                
                promises.push(
                    fetcher.fetch(url)
                        .then(() => {
                            const requestTime = performance.now() - requestStart;
                            metrics.responseTimes.push(requestTime);
                            metrics.minResponseTime = Math.min(metrics.minResponseTime, requestTime);
                            metrics.maxResponseTime = Math.max(metrics.maxResponseTime, requestTime);
                            metrics.successCount++;
                        })
                        .catch(() => {
                            metrics.errorCount++;
                        })
                );
            }
            
            await Promise.all(promises);
        }
        
        metrics.totalTime = performance.now() - startTime;
        metrics.avgResponseTime = metrics.responseTimes.reduce((a, b) => a + b, 0) / metrics.responseTimes.length;
        metrics.throughput = (metrics.successCount / metrics.totalTime) * 1000;
        metrics.successRate = metrics.successCount / this.config.iterations;
        
        // Calculate percentiles
        const sorted = [...metrics.responseTimes].sort((a, b) => a - b);
        metrics.p50 = this._percentile(sorted, 50);
        metrics.p95 = this._percentile(sorted, 95);
        metrics.p99 = this._percentile(sorted, 99);
        
        return metrics;
    }
    
    /**
     * Run mixed benchmark (combination of sequential and concurrent)
     */
    async _runMixedBenchmark() {
        const scenario = 'mixed';
        const metrics = {
            legacy: {
                totalTime: 0,
                avgResponseTime: 0,
                minResponseTime: Infinity,
                maxResponseTime: 0,
                successCount: 0,
                errorCount: 0,
                responseTimes: []
            },
            enhanced: {
                totalTime: 0,
                avgResponseTime: 0,
                minResponseTime: Infinity,
                maxResponseTime: 0,
                successCount: 0,
                errorCount: 0,
                responseTimes: []
            }
        };
        
        // Run mixed workload: alternating between sequential and concurrent batches
        const halfIterations = Math.floor(this.config.iterations / 2);
        
        // Sequential part
        const seqLegacy = await this._runSequentialTest(this.legacyFetcher);
        const seqEnhanced = await this._runSequentialTest(this.enhancedFetcher);
        
        // Concurrent part
        const concLegacy = await this._runConcurrentTest(this.legacyFetcher);
        const concEnhanced = await this._runConcurrentTest(this.enhancedFetcher);
        
        // Combine metrics
        this.results.scenarios[scenario] = {
            legacy: this._combineMetrics(seqLegacy, concLegacy),
            enhanced: this._combineMetrics(seqEnhanced, concEnhanced)
        };
    }
    
    /**
     * Combine metrics from multiple tests
     */
    _combineMetrics(metrics1, metrics2) {
        const combined = {
            totalTime: metrics1.totalTime + metrics2.totalTime,
            avgResponseTime: (metrics1.avgResponseTime + metrics2.avgResponseTime) / 2,
            minResponseTime: Math.min(metrics1.minResponseTime, metrics2.minResponseTime),
            maxResponseTime: Math.max(metrics1.maxResponseTime, metrics2.maxResponseTime),
            successCount: metrics1.successCount + metrics2.successCount,
            errorCount: metrics1.errorCount + metrics2.errorCount,
            responseTimes: [...metrics1.responseTimes, ...metrics2.responseTimes]
        };
        
        combined.throughput = (combined.successCount / combined.totalTime) * 1000;
        combined.successRate = combined.successCount / (combined.successCount + combined.errorCount);
        
        const sorted = [...combined.responseTimes].sort((a, b) => a - b);
        combined.p50 = this._percentile(sorted, 50);
        combined.p95 = this._percentile(sorted, 95);
        combined.p99 = this._percentile(sorted, 99);
        
        return combined;
    }
    
    /**
     * Calculate percentile from sorted array
     */
    _percentile(sorted, percentile) {
        if (sorted.length === 0) return 0;
        const index = Math.ceil((percentile / 100) * sorted.length) - 1;
        return sorted[Math.max(0, index)];
    }
    
    /**
     * Generate comparison between legacy and enhanced
     */
    _generateComparison() {
        this.results.comparison = {};
        
        for (const [scenario, data] of Object.entries(this.results.scenarios)) {
            const legacy = data.legacy;
            const enhanced = data.enhanced;
            
            this.results.comparison[scenario] = {
                responseTimeImprovement: ((legacy.avgResponseTime - enhanced.avgResponseTime) / legacy.avgResponseTime) * 100,
                throughputImprovement: ((enhanced.throughput - legacy.throughput) / legacy.throughput) * 100,
                successRateImprovement: ((enhanced.successRate - legacy.successRate) / legacy.successRate) * 100,
                p95Improvement: ((legacy.p95 - enhanced.p95) / legacy.p95) * 100,
                p99Improvement: ((legacy.p99 - enhanced.p99) / legacy.p99) * 100
            };
        }
    }
    
    /**
     * Generate summary of benchmark results
     */
    _generateSummary() {
        const improvements = Object.values(this.results.comparison);
        
        this.results.summary = {
            avgResponseTimeImprovement: improvements.reduce((sum, i) => sum + i.responseTimeImprovement, 0) / improvements.length,
            avgThroughputImprovement: improvements.reduce((sum, i) => sum + i.throughputImprovement, 0) / improvements.length,
            avgSuccessRateImprovement: improvements.reduce((sum, i) => sum + i.successRateImprovement, 0) / improvements.length,
            recommendation: this._generateRecommendation()
        };
    }
    
    /**
     * Generate recommendation based on results
     */
    _generateRecommendation() {
        const summary = this.results.summary;
        
        if (summary.avgResponseTimeImprovement > 20 && summary.avgThroughputImprovement > 30) {
            return 'STRONG_IMPROVEMENT: Enhanced architecture shows significant performance gains. Recommended for production.';
        } else if (summary.avgResponseTimeImprovement > 10 || summary.avgThroughputImprovement > 15) {
            return 'MODERATE_IMPROVEMENT: Enhanced architecture shows notable improvements. Consider gradual rollout.';
        } else if (summary.avgResponseTimeImprovement > 0) {
            return 'MINOR_IMPROVEMENT: Enhanced architecture shows small improvements. Monitor closely during rollout.';
        } else {
            return 'NO_IMPROVEMENT: Enhanced architecture does not show performance gains. Review configuration and optimizations.';
        }
    }
    
    /**
     * Export results to file
     */
    async exportResults(filepath) {
        const fs = await import('fs/promises');
        await fs.writeFile(filepath, JSON.stringify(this.results, null, 2));
        logger.info(`Benchmark results exported to ${filepath}`);
    }
    
    /**
     * Generate HTML report
     */
    generateHTMLReport() {
        const html = `<!DOCTYPE html>
<html>
<head>
    <title>Performance Benchmark Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        h1 { color: #333; }
        .summary { background: #4CAF50; color: white; padding: 20px; border-radius: 8px; margin: 20px 0; }
        .scenario { background: white; padding: 20px; margin: 20px 0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; }
        .metric { padding: 10px; background: #f9f9f9; border-radius: 4px; }
        .improvement { color: #4CAF50; font-weight: bold; }
        .regression { color: #f44336; font-weight: bold; }
        table { width: 100%; border-collapse: collapse; margin: 10px 0; }
        th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
        th { background: #f0f0f0; }
    </style>
</head>
<body>
    <h1>Performance Benchmark Report</h1>
    <div class="summary">
        <h2>Summary</h2>
        <p>Average Response Time Improvement: <span class="improvement">${this.results.summary?.avgResponseTimeImprovement?.toFixed(1)}%</span></p>
        <p>Average Throughput Improvement: <span class="improvement">${this.results.summary?.avgThroughputImprovement?.toFixed(1)}%</span></p>
        <p>Recommendation: ${this.results.summary?.recommendation}</p>
    </div>
    ${Object.entries(this.results.scenarios).map(([scenario, data]) => `
        <div class="scenario">
            <h2>${scenario.charAt(0).toUpperCase() + scenario.slice(1)} Scenario</h2>
            <table>
                <tr>
                    <th>Metric</th>
                    <th>Legacy</th>
                    <th>Enhanced</th>
                    <th>Improvement</th>
                </tr>
                <tr>
                    <td>Avg Response Time</td>
                    <td>${data.legacy.avgResponseTime?.toFixed(0)}ms</td>
                    <td>${data.enhanced.avgResponseTime?.toFixed(0)}ms</td>
                    <td class="${this.results.comparison[scenario]?.responseTimeImprovement > 0 ? 'improvement' : 'regression'}">
                        ${this.results.comparison[scenario]?.responseTimeImprovement?.toFixed(1)}%
                    </td>
                </tr>
                <tr>
                    <td>Throughput</td>
                    <td>${data.legacy.throughput?.toFixed(1)} req/s</td>
                    <td>${data.enhanced.throughput?.toFixed(1)} req/s</td>
                    <td class="${this.results.comparison[scenario]?.throughputImprovement > 0 ? 'improvement' : 'regression'}">
                        ${this.results.comparison[scenario]?.throughputImprovement?.toFixed(1)}%
                    </td>
                </tr>
                <tr>
                    <td>P95 Latency</td>
                    <td>${data.legacy.p95?.toFixed(0)}ms</td>
                    <td>${data.enhanced.p95?.toFixed(0)}ms</td>
                    <td class="${this.results.comparison[scenario]?.p95Improvement > 0 ? 'improvement' : 'regression'}">
                        ${this.results.comparison[scenario]?.p95Improvement?.toFixed(1)}%
                    </td>
                </tr>
            </table>
        </div>
    `).join('')}
</body>
</html>`;
        
        return html;
    }
}

export default PerformanceBenchmark;
