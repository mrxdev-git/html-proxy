import { EventEmitter } from 'events';
import express from 'express';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Monitoring Dashboard Service
 * Provides real-time monitoring interface for the enhanced architecture
 */
class MonitoringDashboard extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.config = {
            port: config.port || 3001,
            updateInterval: config.updateInterval || 1000,
            historySize: config.historySize || 100,
            alertThresholds: {
                errorRate: config.alertThresholds?.errorRate || 0.1,
                responseTime: config.alertThresholds?.responseTime || 5000,
                poolUtilization: config.alertThresholds?.poolUtilization || 0.9,
                circuitBreakerOpen: true,
                ...config.alertThresholds
            },
            ...config
        };
        
        this.app = express();
        this.server = null;
        this.wss = null;
        this.metricsCollector = null;
        this.architecture = null;
        
        this.metricsHistory = {
            timestamps: [],
            requestRate: [],
            errorRate: [],
            responseTime: [],
            poolUtilization: []
        };
        
        this.activeAlerts = new Map();
        this.updateTimer = null;
    }
    
    async initialize(dependencies = {}) {
        this.metricsCollector = dependencies.metricsCollector;
        this.architecture = dependencies.architecture;
        
        if (!this.metricsCollector) {
            throw new Error('MetricsCollector is required for monitoring dashboard');
        }
        
        this._setupRoutes();
        this._setupWebSocket();
        
        logger.info('Monitoring dashboard initialized');
    }
    
    _setupRoutes() {
        this.app.use('/static', express.static(path.join(__dirname, '../../public/dashboard')));
        
        this.app.get('/', (req, res) => {
            res.send(this._generateDashboardHTML());
        });
        
        this.app.get('/api/metrics', (req, res) => {
            res.json(this._getCurrentMetrics());
        });
        
        this.app.get('/api/metrics/history', (req, res) => {
            res.json(this.metricsHistory);
        });
        
        this.app.get('/api/alerts', (req, res) => {
            res.json(Array.from(this.activeAlerts.values()));
        });
        
        this.app.get('/api/status', (req, res) => {
            res.json(this._getArchitectureStatus());
        });
    }
    
    _setupWebSocket() {
        this.server = this.app.listen(this.config.port, () => {
            logger.info(`Monitoring dashboard running at http://localhost:${this.config.port}`);
        });
        
        this.wss = new WebSocketServer({ server: this.server });
        
        this.wss.on('connection', (ws) => {
            logger.debug('New WebSocket connection to monitoring dashboard');
            
            ws.send(JSON.stringify({
                type: 'initial',
                metrics: this._getCurrentMetrics(),
                history: this.metricsHistory,
                alerts: Array.from(this.activeAlerts.values()),
                status: this._getArchitectureStatus()
            }));
            
            ws.on('error', (error) => {
                logger.error('WebSocket error:', error);
            });
        });
    }
    
    start() {
        if (this.updateTimer) return;
        
        this.updateTimer = setInterval(() => {
            this._updateMetrics();
            this._checkAlerts();
            this._broadcastUpdates();
        }, this.config.updateInterval);
        
        logger.info('Monitoring dashboard started');
        this.emit('started');
    }
    
    stop() {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = null;
        }
        
        if (this.wss) {
            this.wss.clients.forEach(ws => ws.close());
        }
        
        if (this.server) {
            this.server.close();
        }
        
        logger.info('Monitoring dashboard stopped');
        this.emit('stopped');
    }
    
    _updateMetrics() {
        const metrics = this._getCurrentMetrics();
        const timestamp = new Date().toISOString();
        
        this.metricsHistory.timestamps.push(timestamp);
        this.metricsHistory.requestRate.push(metrics.requestRate);
        this.metricsHistory.errorRate.push(metrics.errorRate);
        this.metricsHistory.responseTime.push(metrics.avgResponseTime);
        this.metricsHistory.poolUtilization.push(metrics.poolUtilization);
        
        if (this.metricsHistory.timestamps.length > this.config.historySize) {
            const excess = this.metricsHistory.timestamps.length - this.config.historySize;
            this.metricsHistory.timestamps.splice(0, excess);
            this.metricsHistory.requestRate.splice(0, excess);
            this.metricsHistory.errorRate.splice(0, excess);
            this.metricsHistory.responseTime.splice(0, excess);
            this.metricsHistory.poolUtilization.splice(0, excess);
        }
    }
    
    _getCurrentMetrics() {
        if (!this.metricsCollector) {
            return this._getEmptyMetrics();
        }
        
        const summary = this.metricsCollector.getSummary();
        const poolMetrics = this.architecture?.resourceManager?.getAllMetrics() || {};
        
        // Calculate pool utilization
        let totalPoolUtilization = 0;
        let poolCount = 0;
        Object.values(poolMetrics).forEach(poolData => {
            if (poolData.pool && poolData.pool.total > 0 && poolData.pool.maxSize > 0) {
                totalPoolUtilization += poolData.pool.inUse / poolData.pool.maxSize;
                poolCount++;
            }
        });
        const avgPoolUtilization = poolCount > 0 ? totalPoolUtilization / poolCount : 0;
        
        // Calculate rates
        const totalRequests = summary.totalRequests || 0;
        const totalErrors = summary.totalErrors || 0;
        const errorRate = totalRequests > 0 ? totalErrors / totalRequests : 0;
        const requestRate = summary.requestRate || 0;
        
        return {
            timestamp: new Date().toISOString(),
            totalRequests,
            totalErrors,
            errorRate,
            requestRate,
            avgResponseTime: summary.avgResponseTime || 0,
            poolUtilization: avgPoolUtilization,
            adapterMetrics: summary.adapters || {},
            poolMetrics,
            circuitBreakers: this._getCircuitBreakerStatus()
        };
    }
    
    _getEmptyMetrics() {
        return {
            timestamp: new Date().toISOString(),
            totalRequests: 0,
            totalErrors: 0,
            errorRate: 0,
            requestRate: 0,
            avgResponseTime: 0,
            poolUtilization: 0,
            adapterMetrics: {},
            poolMetrics: {},
            circuitBreakers: {}
        };
    }
    
    _getCircuitBreakerStatus() {
        if (!this.architecture?.adapterRouter) {
            return {};
        }
        
        const status = {};
        const router = this.architecture.adapterRouter;
        
        if (router.circuitBreakers) {
            router.circuitBreakers.forEach((cb, name) => {
                status[name] = {
                    state: cb.state,
                    failures: cb.failures,
                    successes: cb.successes,
                    lastFailure: cb.lastFailure,
                    nextAttempt: cb.nextAttempt
                };
            });
        }
        
        return status;
    }
    
    _getArchitectureStatus() {
        if (!this.architecture) {
            return { initialized: false };
        }
        
        return {
            initialized: this.architecture.initialized,
            components: {
                resourceManager: {
                    active: !!this.architecture.resourceManager,
                    pools: this.architecture.resourceManager?.pools?.size || 0
                },
                adapterRouter: {
                    active: !!this.architecture.adapterRouter,
                    adapters: this.architecture.adapterRouter?.adapters?.size || 0,
                    rules: this.architecture.adapterRouter?.routingRules?.length || 0
                },
                metricsCollector: {
                    active: !!this.architecture.metricsCollector,
                    metricsCount: this.architecture.metricsCollector?.metrics?.length || 0
                },
                enhancedFetcher: {
                    active: !!this.architecture.enhancedFetcher,
                    activeRequests: this.architecture.enhancedFetcher?.activeRequests?.size || 0
                }
            }
        };
    }
    
    _checkAlerts() {
        const metrics = this._getCurrentMetrics();
        const thresholds = this.config.alertThresholds;
        
        if (metrics.errorRate > thresholds.errorRate) {
            this._createAlert('error-rate', 'high', 
                `Error rate (${(metrics.errorRate * 100).toFixed(1)}%) exceeds threshold`);
        } else {
            this._clearAlert('error-rate');
        }
        
        if (metrics.avgResponseTime > thresholds.responseTime) {
            this._createAlert('response-time', 'high',
                `Response time (${metrics.avgResponseTime.toFixed(0)}ms) exceeds threshold`);
        } else {
            this._clearAlert('response-time');
        }
        
        if (metrics.poolUtilization > thresholds.poolUtilization) {
            this._createAlert('pool-utilization', 'high',
                `Pool utilization (${(metrics.poolUtilization * 100).toFixed(1)}%) exceeds threshold`);
        } else {
            this._clearAlert('pool-utilization');
        }
        
        if (thresholds.circuitBreakerOpen) {
            Object.entries(metrics.circuitBreakers).forEach(([name, cb]) => {
                if (cb.state === 'OPEN') {
                    this._createAlert(`circuit-breaker-${name}`, 'critical',
                        `Circuit breaker for ${name} is OPEN`);
                } else {
                    this._clearAlert(`circuit-breaker-${name}`);
                }
            });
        }
    }
    
    _createAlert(id, severity, message) {
        const existingAlert = this.activeAlerts.get(id);
        
        if (!existingAlert) {
            const alert = {
                id,
                severity,
                message,
                timestamp: new Date().toISOString(),
                count: 1
            };
            this.activeAlerts.set(id, alert);
            logger.warn(`Alert created: ${message}`);
            this.emit('alert', alert);
        } else {
            existingAlert.count++;
            existingAlert.lastOccurrence = new Date().toISOString();
        }
    }
    
    _clearAlert(id) {
        if (this.activeAlerts.has(id)) {
            const alert = this.activeAlerts.get(id);
            this.activeAlerts.delete(id);
            logger.info(`Alert cleared: ${alert.message}`);
            this.emit('alertCleared', alert);
        }
    }
    
    _broadcastUpdates() {
        if (!this.wss) return;
        
        const update = {
            type: 'update',
            metrics: this._getCurrentMetrics(),
            timestamp: new Date().toISOString()
        };
        
        this.wss.clients.forEach(ws => {
            if (ws.readyState === ws.OPEN) {
                ws.send(JSON.stringify(update));
            }
        });
    }
    
    _generateDashboardHTML() {
        return this._getDashboardTemplate();
    }
    
    _getDashboardTemplate() {
        // Return a simple dashboard template
        return `<!DOCTYPE html>
<html>
<head>
    <title>Monitoring Dashboard</title>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        h1 { color: #333; }
        .metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; }
        .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .metric-value { font-size: 2em; font-weight: bold; color: #4CAF50; }
        .alerts { margin-top: 20px; }
        .alert { padding: 10px; margin: 10px 0; border-radius: 4px; }
        .alert.high { background: #fff3cd; border-left: 4px solid #ffc107; }
        .alert.critical { background: #f8d7da; border-left: 4px solid #dc3545; }
    </style>
</head>
<body>
    <h1>Enhanced Architecture Monitoring</h1>
    <div id="metrics" class="metrics"></div>
    <div id="alerts" class="alerts"></div>
    <script>
        const ws = new WebSocket('ws://localhost:${this.config.port}');
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            updateDashboard(data);
        };
        
        function updateDashboard(data) {
            if (data.type === 'initial' || data.type === 'update') {
                updateMetrics(data.metrics);
            }
            if (data.alerts) {
                updateAlerts(data.alerts);
            }
        }
        
        function updateMetrics(metrics) {
            const container = document.getElementById('metrics');
            container.innerHTML = \`
                <div class="card">
                    <h3>Requests</h3>
                    <div class="metric-value">\${metrics.totalRequests}</div>
                    <div>Rate: \${metrics.requestRate.toFixed(2)} req/s</div>
                </div>
                <div class="card">
                    <h3>Error Rate</h3>
                    <div class="metric-value">\${(metrics.errorRate * 100).toFixed(1)}%</div>
                </div>
                <div class="card">
                    <h3>Avg Response Time</h3>
                    <div class="metric-value">\${metrics.avgResponseTime.toFixed(0)}ms</div>
                </div>
                <div class="card">
                    <h3>Pool Utilization</h3>
                    <div class="metric-value">\${(metrics.poolUtilization * 100).toFixed(1)}%</div>
                </div>
            \`;
        }
        
        function updateAlerts(alerts) {
            const container = document.getElementById('alerts');
            if (alerts.length === 0) {
                container.innerHTML = '<div style="color: green;">✅ No active alerts</div>';
            } else {
                container.innerHTML = '<h2>Active Alerts</h2>' + 
                    alerts.map(a => \`<div class="alert \${a.severity}">\${a.message}</div>\`).join('');
            }
        }
    </script>
</body>
</html>`;
    }
}

export default MonitoringDashboard;
