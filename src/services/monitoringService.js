import { logger } from '../logger.js';
import os from 'os';
import process from 'process';

/**
 * MonitoringService - Health checks and performance monitoring
 * Features:
 * - System health checks
 * - Performance metrics
 * - Resource monitoring
 * - Alert thresholds
 * - Real-time statistics
 */
export class MonitoringService {
  constructor() {
    this.startTime = Date.now();
    this.metrics = {
      requests: {
        total: 0,
        successful: 0,
        failed: 0,
        cached: 0,
        avgResponseTime: 0,
        p95ResponseTime: 0,
        p99ResponseTime: 0,
      },
      system: {
        memoryUsage: {},
        cpuUsage: [],
        uptime: 0,
      },
      adapters: {
        http: { requests: 0, failures: 0 },
        browser: { requests: 0, failures: 0 },
        'crawlee-http': { requests: 0, failures: 0 },
        'crawlee-browser': { requests: 0, failures: 0 },
        adaptive: { requests: 0, failures: 0 },
      },
      errors: [],
      responseTimes: [],
    };
    
    // Start periodic collection
    this.startCollection();
  }

  /**
   * Record a request metric
   */
  recordRequest(url, adapter, success, responseTime, cached = false) {
    this.metrics.requests.total++;
    
    if (success) {
      this.metrics.requests.successful++;
    } else {
      this.metrics.requests.failed++;
    }
    
    if (cached) {
      this.metrics.requests.cached++;
    }
    
    // Track adapter-specific metrics
    if (this.metrics.adapters[adapter]) {
      this.metrics.adapters[adapter].requests++;
      if (!success) {
        this.metrics.adapters[adapter].failures++;
      }
    }
    
    // Track response times
    if (responseTime && success) {
      this.metrics.responseTimes.push(responseTime);
      
      // Keep only last 1000 response times
      if (this.metrics.responseTimes.length > 1000) {
        this.metrics.responseTimes.shift();
      }
      
      // Update average
      const times = this.metrics.responseTimes;
      this.metrics.requests.avgResponseTime = 
        times.reduce((a, b) => a + b, 0) / times.length;
      
      // Calculate percentiles
      const sorted = [...times].sort((a, b) => a - b);
      const p95Index = Math.floor(sorted.length * 0.95);
      const p99Index = Math.floor(sorted.length * 0.99);
      
      this.metrics.requests.p95ResponseTime = sorted[p95Index] || 0;
      this.metrics.requests.p99ResponseTime = sorted[p99Index] || 0;
    }
  }

  /**
   * Record an error
   */
  recordError(error, context = {}) {
    const errorEntry = {
      message: error.message || error,
      stack: error.stack,
      context,
      timestamp: new Date().toISOString(),
    };
    
    this.metrics.errors.push(errorEntry);
    
    // Keep only last 100 errors
    if (this.metrics.errors.length > 100) {
      this.metrics.errors.shift();
    }
    
    logger.error({ error: errorEntry }, 'Error recorded in monitoring');
  }

  /**
   * Get system metrics
   */
  collectSystemMetrics() {
    // Memory usage
    const memUsage = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    
    this.metrics.system.memoryUsage = {
      rss: memUsage.rss,
      heapTotal: memUsage.heapTotal,
      heapUsed: memUsage.heapUsed,
      external: memUsage.external,
      systemTotal: totalMem,
      systemFree: freeMem,
      systemUsedPercent: ((totalMem - freeMem) / totalMem * 100).toFixed(2),
    };
    
    // CPU usage
    const cpus = os.cpus();
    const cpuUsage = cpus.map(cpu => {
      const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      const idle = cpu.times.idle;
      return ((total - idle) / total * 100).toFixed(2);
    });
    
    this.metrics.system.cpuUsage = cpuUsage;
    
    // Uptime
    this.metrics.system.uptime = Date.now() - this.startTime;
  }

  /**
   * Start periodic collection
   */
  startCollection() {
    // Collect system metrics every 30 seconds
    this.collectionInterval = setInterval(() => {
      this.collectSystemMetrics();
    }, 30000);
    
    // Initial collection
    this.collectSystemMetrics();
  }

  /**
   * Stop collection
   */
  stopCollection() {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = null;
    }
  }
  
  /**
   * Destroy the monitoring service
   */
  destroy() {
    this.stopCollection();
    this.reset();
  }

  /**
   * Get health status
   */
  getHealth() {
    const now = Date.now();
    const uptime = now - this.startTime;
    const memUsage = process.memoryUsage();
    const systemMem = os.totalmem();
    const freeMem = os.freemem();
    
    // Determine health status
    let status = 'healthy';
    const issues = [];
    
    // Check memory usage
    const memPercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    if (memPercent > 90) {
      status = 'unhealthy';
      issues.push('High memory usage');
    } else if (memPercent > 75) {
      status = 'degraded';
      issues.push('Elevated memory usage');
    }
    
    // Check error rate
    const errorRate = this.metrics.requests.total > 0
      ? (this.metrics.requests.failed / this.metrics.requests.total) * 100
      : 0;
    
    if (errorRate > 50) {
      status = 'unhealthy';
      issues.push('High error rate');
    } else if (errorRate > 20) {
      status = 'degraded';
      issues.push('Elevated error rate');
    }
    
    // Check response times
    if (this.metrics.requests.p95ResponseTime > 10000) {
      status = 'degraded';
      issues.push('Slow response times');
    }
    
    return {
      status,
      timestamp: new Date().toISOString(),
      uptime: Math.floor(uptime / 1000), // seconds
      memory: {
        used: memUsage.heapUsed,
        total: memUsage.heapTotal,
        percentage: memPercent.toFixed(2),
      },
      system: {
        freeMemory: freeMem,
        totalMemory: systemMem,
        loadAverage: os.loadavg(),
      },
      requests: {
        total: this.metrics.requests.total,
        successful: this.metrics.requests.successful,
        failed: this.metrics.requests.failed,
        cached: this.metrics.requests.cached,
        errorRate: errorRate.toFixed(2),
      },
      performance: {
        avgResponseTime: Math.round(this.metrics.requests.avgResponseTime),
        p95ResponseTime: Math.round(this.metrics.requests.p95ResponseTime),
        p99ResponseTime: Math.round(this.metrics.requests.p99ResponseTime),
      },
      issues,
    };
  }

  /**
   * Get full metrics
   */
  getMetrics() {
    this.collectSystemMetrics();
    
    return {
      ...this.metrics,
      health: this.getHealth(),
      crawlerPoolStats: global.crawlerPoolStats || {},
      cacheStats: global.cacheStats || {},
    };
  }

  /**
   * Get adapter statistics
   */
  getAdapterStats() {
    const stats = {};
    
    for (const [adapter, metrics] of Object.entries(this.metrics.adapters)) {
      const successRate = metrics.requests > 0
        ? ((metrics.requests - metrics.failures) / metrics.requests * 100).toFixed(2)
        : 0;
      
      stats[adapter] = {
        ...metrics,
        successRate: `${successRate}%`,
      };
    }
    
    return stats;
  }

  /**
   * Reset metrics
   */
  reset() {
    this.metrics.requests = {
      total: 0,
      successful: 0,
      failed: 0,
      cached: 0,
      avgResponseTime: 0,
      p95ResponseTime: 0,
      p99ResponseTime: 0,
    };
    
    this.metrics.errors = [];
    this.metrics.responseTimes = [];
    
    for (const adapter of Object.keys(this.metrics.adapters)) {
      this.metrics.adapters[adapter] = { requests: 0, failures: 0 };
    }
    
    logger.info('Monitoring metrics reset');
  }
}

// Singleton instance
let monitoringInstance = null;

export function getMonitoringService() {
  if (!monitoringInstance) {
    monitoringInstance = new MonitoringService();
  }
  return monitoringInstance;
}

export function destroyMonitoringService() {
  if (monitoringInstance) {
    monitoringInstance.destroy();
    monitoringInstance = null;
  }
}
