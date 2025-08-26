import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Performance Metrics Collector for monitoring and analysis
 */
class MetricsCollector extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            flushInterval: config.flushInterval || 60000, // 1 minute
            retentionPeriod: config.retentionPeriod || 86400000, // 24 hours
            aggregationInterval: config.aggregationInterval || 300000, // 5 minutes
            persistMetrics: config.persistMetrics || false,
            metricsPath: config.metricsPath || './metrics',
            ...config
        };
        
        this.metrics = {
            requests: [],
            adapters: new Map(),
            pools: new Map(),
            errors: [],
            performance: []
        };
        
        this.aggregated = {
            hourly: new Map(),
            daily: new Map()
        };
        
        this.timers = {
            flush: null,
            cleanup: null,
            aggregation: null
        };
        
        this._startTimers();
    }

    /**
     * Record request metric
     */
    recordRequest(data) {
        const metric = {
            timestamp: Date.now(),
            url: data.url,
            adapter: data.adapter,
            duration: data.duration,
            status: data.status,
            success: data.success,
            size: data.size || 0,
            cached: data.cached || false,
            error: data.error || null,
            ...data
        };
        
        this.metrics.requests.push(metric);
        this.emit('metric-recorded', { type: 'request', metric });
        
        // Update adapter metrics
        this._updateAdapterMetrics(data.adapter, metric);
    }

    /**
     * Record pool metric
     */
    recordPoolMetric(poolName, data) {
        if (!this.metrics.pools.has(poolName)) {
            this.metrics.pools.set(poolName, {
                acquisitions: [],
                releases: [],
                timeouts: [],
                errors: []
            });
        }
        
        const poolMetrics = this.metrics.pools.get(poolName);
        const metric = {
            timestamp: Date.now(),
            ...data
        };
        
        if (data.type === 'acquisition') {
            poolMetrics.acquisitions.push(metric);
        } else if (data.type === 'release') {
            poolMetrics.releases.push(metric);
        } else if (data.type === 'timeout') {
            poolMetrics.timeouts.push(metric);
        } else if (data.type === 'error') {
            poolMetrics.errors.push(metric);
        }
        
        this.emit('metric-recorded', { type: 'pool', pool: poolName, metric });
    }

    /**
     * Record error
     */
    recordError(error, context = {}) {
        const errorMetric = {
            timestamp: Date.now(),
            message: error.message,
            stack: error.stack,
            code: error.code,
            context,
            ...context
        };
        
        this.metrics.errors.push(errorMetric);
        this.emit('error-recorded', errorMetric);
    }

    /**
     * Record performance metric
     */
    recordPerformance(name, value, unit = 'ms') {
        const metric = {
            timestamp: Date.now(),
            name,
            value,
            unit
        };
        
        this.metrics.performance.push(metric);
        this.emit('metric-recorded', { type: 'performance', metric });
    }

    /**
     * Update adapter-specific metrics
     */
    _updateAdapterMetrics(adapterName, metric) {
        if (!this.metrics.adapters.has(adapterName)) {
            this.metrics.adapters.set(adapterName, {
                totalRequests: 0,
                successfulRequests: 0,
                failedRequests: 0,
                totalDuration: 0,
                totalSize: 0,
                errors: [],
                lastRequest: null
            });
        }
        
        const adapterMetrics = this.metrics.adapters.get(adapterName);
        adapterMetrics.totalRequests++;
        adapterMetrics.totalDuration += metric.duration || 0;
        adapterMetrics.totalSize += metric.size || 0;
        adapterMetrics.lastRequest = metric.timestamp;
        
        if (metric.success) {
            adapterMetrics.successfulRequests++;
        } else {
            adapterMetrics.failedRequests++;
            if (metric.error) {
                adapterMetrics.errors.push({
                    timestamp: metric.timestamp,
                    error: metric.error
                });
            }
        }
    }

    /**
     * Get current metrics summary
     */
    getSummary() {
        const now = Date.now();
        const recentRequests = this.metrics.requests.filter(
            r => now - r.timestamp < 300000 // Last 5 minutes
        );
        
        const summary = {
            timestamp: now,
            requests: {
                total: this.metrics.requests.length,
                recent: recentRequests.length,
                successful: recentRequests.filter(r => r.success).length,
                failed: recentRequests.filter(r => !r.success).length,
                avgDuration: this._calculateAverage(recentRequests, 'duration'),
                avgSize: this._calculateAverage(recentRequests, 'size')
            },
            adapters: {},
            pools: {},
            errors: {
                total: this.metrics.errors.length,
                recent: this.metrics.errors.filter(e => now - e.timestamp < 300000).length
            }
        };
        
        // Add adapter summaries
        for (const [name, metrics] of this.metrics.adapters) {
            summary.adapters[name] = {
                total: metrics.totalRequests,
                successful: metrics.successfulRequests,
                failed: metrics.failedRequests,
                successRate: metrics.totalRequests > 0 
                    ? metrics.successfulRequests / metrics.totalRequests 
                    : 0,
                avgDuration: metrics.totalRequests > 0 
                    ? metrics.totalDuration / metrics.totalRequests 
                    : 0,
                avgSize: metrics.totalRequests > 0 
                    ? metrics.totalSize / metrics.totalRequests 
                    : 0,
                recentErrors: metrics.errors.filter(e => now - e.timestamp < 300000).length
            };
        }
        
        // Add pool summaries
        for (const [name, metrics] of this.metrics.pools) {
            const recentAcquisitions = metrics.acquisitions.filter(
                a => now - a.timestamp < 300000
            );
            
            summary.pools[name] = {
                acquisitions: recentAcquisitions.length,
                releases: metrics.releases.filter(r => now - r.timestamp < 300000).length,
                timeouts: metrics.timeouts.filter(t => now - t.timestamp < 300000).length,
                errors: metrics.errors.filter(e => now - e.timestamp < 300000).length,
                avgAcquisitionTime: this._calculateAverage(recentAcquisitions, 'duration')
            };
        }
        
        return summary;
    }

    /**
     * Get detailed metrics for time range
     */
    getMetrics(startTime, endTime = Date.now()) {
        return {
            requests: this.metrics.requests.filter(
                r => r.timestamp >= startTime && r.timestamp <= endTime
            ),
            errors: this.metrics.errors.filter(
                e => e.timestamp >= startTime && e.timestamp <= endTime
            ),
            performance: this.metrics.performance.filter(
                p => p.timestamp >= startTime && p.timestamp <= endTime
            )
        };
    }

    /**
     * Aggregate metrics
     */
    _aggregateMetrics() {
        const now = Date.now();
        const hourAgo = now - 3600000;
        const dayAgo = now - 86400000;
        
        // Hourly aggregation
        const hourlyKey = new Date(now).toISOString().substring(0, 13);
        const hourlyRequests = this.metrics.requests.filter(
            r => r.timestamp >= hourAgo
        );
        
        this.aggregated.hourly.set(hourlyKey, {
            timestamp: now,
            requests: hourlyRequests.length,
            successful: hourlyRequests.filter(r => r.success).length,
            failed: hourlyRequests.filter(r => !r.success).length,
            avgDuration: this._calculateAverage(hourlyRequests, 'duration'),
            avgSize: this._calculateAverage(hourlyRequests, 'size'),
            errors: this.metrics.errors.filter(e => e.timestamp >= hourAgo).length
        });
        
        // Daily aggregation
        const dailyKey = new Date(now).toISOString().substring(0, 10);
        const dailyRequests = this.metrics.requests.filter(
            r => r.timestamp >= dayAgo
        );
        
        this.aggregated.daily.set(dailyKey, {
            timestamp: now,
            requests: dailyRequests.length,
            successful: dailyRequests.filter(r => r.success).length,
            failed: dailyRequests.filter(r => !r.success).length,
            avgDuration: this._calculateAverage(dailyRequests, 'duration'),
            avgSize: this._calculateAverage(dailyRequests, 'size'),
            errors: this.metrics.errors.filter(e => e.timestamp >= dayAgo).length
        });
        
        this.emit('metrics-aggregated', { hourly: hourlyKey, daily: dailyKey });
    }

    /**
     * Clean up old metrics
     */
    _cleanupMetrics() {
        const cutoff = Date.now() - this.config.retentionPeriod;
        
        // Clean requests
        this.metrics.requests = this.metrics.requests.filter(
            r => r.timestamp > cutoff
        );
        
        // Clean errors
        this.metrics.errors = this.metrics.errors.filter(
            e => e.timestamp > cutoff
        );
        
        // Clean performance metrics
        this.metrics.performance = this.metrics.performance.filter(
            p => p.timestamp > cutoff
        );
        
        // Clean pool metrics
        for (const poolMetrics of this.metrics.pools.values()) {
            poolMetrics.acquisitions = poolMetrics.acquisitions.filter(
                a => a.timestamp > cutoff
            );
            poolMetrics.releases = poolMetrics.releases.filter(
                r => r.timestamp > cutoff
            );
            poolMetrics.timeouts = poolMetrics.timeouts.filter(
                t => t.timestamp > cutoff
            );
            poolMetrics.errors = poolMetrics.errors.filter(
                e => e.timestamp > cutoff
            );
        }
        
        // Clean adapter error logs
        for (const adapterMetrics of this.metrics.adapters.values()) {
            adapterMetrics.errors = adapterMetrics.errors.filter(
                e => e.timestamp > cutoff
            );
        }
        
        // Clean old aggregated data
        const hourCutoff = new Date(cutoff).toISOString().substring(0, 13);
        const dayCutoff = new Date(cutoff).toISOString().substring(0, 10);
        
        for (const key of this.aggregated.hourly.keys()) {
            if (key < hourCutoff) {
                this.aggregated.hourly.delete(key);
            }
        }
        
        for (const key of this.aggregated.daily.keys()) {
            if (key < dayCutoff) {
                this.aggregated.daily.delete(key);
            }
        }
        
        this.emit('metrics-cleaned', { cutoff: new Date(cutoff).toISOString() });
    }

    /**
     * Persist metrics to disk
     */
    async _persistMetrics() {
        if (!this.config.persistMetrics) return;
        
        try {
            await fs.mkdir(this.config.metricsPath, { recursive: true });
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `metrics-${timestamp}.json`;
            const filepath = path.join(this.config.metricsPath, filename);
            
            const data = {
                timestamp: Date.now(),
                summary: this.getSummary(),
                aggregated: {
                    hourly: Array.from(this.aggregated.hourly.entries()),
                    daily: Array.from(this.aggregated.daily.entries())
                }
            };
            
            await fs.writeFile(filepath, JSON.stringify(data, null, 2));
            this.emit('metrics-persisted', { filepath });
        } catch (error) {
            this.emit('error', error);
        }
    }

    /**
     * Calculate average
     */
    _calculateAverage(items, field) {
        if (items.length === 0) return 0;
        const sum = items.reduce((acc, item) => acc + (item[field] || 0), 0);
        return sum / items.length;
    }

    /**
     * Start timers
     */
    _startTimers() {
        // Aggregation timer
        this.timers.aggregation = setInterval(() => {
            this._aggregateMetrics();
        }, this.config.aggregationInterval);
        
        // Cleanup timer
        this.timers.cleanup = setInterval(() => {
            this._cleanupMetrics();
        }, this.config.retentionPeriod / 4);
        
        // Flush timer
        if (this.config.persistMetrics) {
            this.timers.flush = setInterval(() => {
                this._persistMetrics();
            }, this.config.flushInterval);
        }
    }

    /**
     * Stop timers
     */
    _stopTimers() {
        for (const timer of Object.values(this.timers)) {
            if (timer) clearInterval(timer);
        }
    }

    /**
     * Export metrics
     */
    async exportMetrics(format = 'json') {
        const data = {
            timestamp: Date.now(),
            metrics: this.metrics,
            aggregated: {
                hourly: Array.from(this.aggregated.hourly.entries()),
                daily: Array.from(this.aggregated.daily.entries())
            },
            summary: this.getSummary()
        };
        
        if (format === 'json') {
            return JSON.stringify(data, null, 2);
        } else if (format === 'csv') {
            // Simple CSV export of requests
            const headers = ['timestamp', 'url', 'adapter', 'duration', 'status', 'success', 'size'];
            const rows = this.metrics.requests.map(r => 
                headers.map(h => r[h] || '').join(',')
            );
            return [headers.join(','), ...rows].join('\n');
        }
        
        return data;
    }

    /**
     * Reset metrics
     */
    reset() {
        this.metrics = {
            requests: [],
            adapters: new Map(),
            pools: new Map(),
            errors: [],
            performance: []
        };
        
        this.aggregated = {
            hourly: new Map(),
            daily: new Map()
        };
        
        this.emit('metrics-reset');
    }

    /**
     * Shutdown
     */
    async shutdown() {
        this._stopTimers();
        
        if (this.config.persistMetrics) {
            await this._persistMetrics();
        }
        
        this.emit('shutdown');
    }
}

export default MetricsCollector;
