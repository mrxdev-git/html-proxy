#!/usr/bin/env node

import express from 'express';
import { logger } from './src/logger.js';

/**
 * Simplified demo for monitoring and benchmarking
 * This version focuses on demonstrating the monitoring dashboard
 */
async function runDemo() {
    logger.info('🚀 Starting Monitoring & Benchmarking Demo');
    
    try {
        // Create a simple metrics collector mock
        const metricsCollector = {
            getSummary: () => ({
                totalRequests: Math.floor(Math.random() * 1000) + 100,
                successfulRequests: Math.floor(Math.random() * 900) + 90,
                failedRequests: Math.floor(Math.random() * 100) + 10,
                totalErrors: Math.floor(Math.random() * 50) + 5,
                avgResponseTime: Math.random() * 2000 + 500,
                requestRate: Math.random() * 10 + 1,
                recentErrors: [],
                adapters: {
                    http: {
                        total: Math.floor(Math.random() * 500) + 50,
                        successful: Math.floor(Math.random() * 450) + 45,
                        failed: Math.floor(Math.random() * 50) + 5,
                        successRate: 0.9 + Math.random() * 0.09,
                        avgResponseTime: Math.random() * 1500 + 300
                    },
                    browser: {
                        total: Math.floor(Math.random() * 500) + 50,
                        successful: Math.floor(Math.random() * 450) + 45,
                        failed: Math.floor(Math.random() * 50) + 5,
                        successRate: 0.85 + Math.random() * 0.14,
                        avgResponseTime: Math.random() * 3000 + 1000
                    }
                }
            }),
            recordRequest: (data) => {
                logger.info(`Recorded request: ${data.url}`);
            },
            recordError: (error, context) => {
                logger.warn(`Recorded error: ${error.message}`);
            }
        };
        
        // Create a simple architecture mock
        const architecture = {
            initialized: true,
            resourceManager: {
                getAllMetrics: () => ({
                    browser: {
                        pool: {
                            total: 3,
                            available: 1,
                            inUse: 2,
                            maxSize: 5,
                            acquired: Math.floor(Math.random() * 100) + 10,
                            released: Math.floor(Math.random() * 100) + 10,
                            timeouts: Math.floor(Math.random() * 5)
                        }
                    },
                    http: {
                        pool: {
                            total: 10,
                            available: 7,
                            inUse: 3,
                            maxSize: 20,
                            acquired: Math.floor(Math.random() * 200) + 20,
                            released: Math.floor(Math.random() * 200) + 20,
                            timeouts: Math.floor(Math.random() * 3)
                        }
                    }
                })
            },
            adapterRouter: {
                getMetrics: () => ({
                    adapters: ['http', 'browser'],
                    routingDecisions: Math.floor(Math.random() * 500) + 100,
                    circuitBreakers: {
                        http: 'closed',
                        browser: 'closed'
                    }
                })
            }
        };
        
        // Create monitoring dashboard
        logger.info('Starting monitoring dashboard...');
        const app = express();
        const port = 3001;
        
        // Serve dashboard HTML
        app.get('/', (req, res) => {
            res.send(`
<!DOCTYPE html>
<html>
<head>
    <title>Node HTML Receiver - Monitoring Dashboard</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
        }
        .container {
            max-width: 1400px;
            margin: 0 auto;
        }
        h1 {
            color: white;
            text-align: center;
            margin-bottom: 30px;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.2);
        }
        .metrics-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .metric-card {
            background: white;
            border-radius: 12px;
            padding: 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            transition: transform 0.3s ease;
        }
        .metric-card:hover {
            transform: translateY(-5px);
        }
        .metric-title {
            font-size: 14px;
            color: #666;
            margin-bottom: 10px;
            text-transform: uppercase;
            letter-spacing: 1px;
        }
        .metric-value {
            font-size: 32px;
            font-weight: bold;
            color: #333;
            margin-bottom: 10px;
        }
        .metric-change {
            font-size: 14px;
            color: #28a745;
        }
        .metric-change.negative {
            color: #dc3545;
        }
        .status-good { color: #28a745; }
        .status-warning { color: #ffc107; }
        .status-error { color: #dc3545; }
        .chart-container {
            background: white;
            border-radius: 12px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
        }
        .adapter-stats {
            display: flex;
            justify-content: space-around;
            flex-wrap: wrap;
        }
        .adapter-card {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 15px;
            margin: 10px;
            min-width: 200px;
        }
        .pool-stats {
            display: flex;
            justify-content: space-around;
            margin-top: 20px;
        }
        .pool-card {
            background: #f8f9fa;
            border-radius: 8px;
            padding: 15px;
            text-align: center;
            flex: 1;
            margin: 0 10px;
        }
        .progress-bar {
            width: 100%;
            height: 20px;
            background: #e9ecef;
            border-radius: 10px;
            overflow: hidden;
            margin-top: 10px;
        }
        .progress-fill {
            height: 100%;
            background: linear-gradient(90deg, #667eea, #764ba2);
            transition: width 0.5s ease;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 Node HTML Receiver - Real-time Monitoring Dashboard</h1>
        
        <div class="metrics-grid">
            <div class="metric-card">
                <div class="metric-title">Total Requests</div>
                <div class="metric-value" id="totalRequests">0</div>
                <div class="metric-change">↑ 12% from last hour</div>
            </div>
            
            <div class="metric-card">
                <div class="metric-title">Success Rate</div>
                <div class="metric-value" id="successRate">0%</div>
                <div class="metric-change">↑ 2% improvement</div>
            </div>
            
            <div class="metric-card">
                <div class="metric-title">Avg Response Time</div>
                <div class="metric-value" id="avgResponseTime">0ms</div>
                <div class="metric-change negative">↑ 50ms slower</div>
            </div>
            
            <div class="metric-card">
                <div class="metric-title">Request Rate</div>
                <div class="metric-value" id="requestRate">0/s</div>
                <div class="metric-change">Stable</div>
            </div>
        </div>
        
        <div class="chart-container">
            <h2>Adapter Performance</h2>
            <div class="adapter-stats" id="adapterStats"></div>
        </div>
        
        <div class="chart-container">
            <h2>Resource Pool Status</h2>
            <div class="pool-stats" id="poolStats"></div>
        </div>
        
        <div class="chart-container">
            <h2>System Status</h2>
            <div id="systemStatus">
                <p>🟢 All systems operational</p>
                <p>Circuit Breakers: All closed</p>
                <p>Last updated: <span id="lastUpdate">Never</span></p>
            </div>
        </div>
    </div>
    
    <script>
        // Update metrics every second
        async function updateMetrics() {
            try {
                const response = await fetch('/api/metrics');
                const data = await response.json();
                
                // Update main metrics
                document.getElementById('totalRequests').textContent = data.totalRequests.toLocaleString();
                document.getElementById('successRate').textContent = data.successRate.toFixed(1) + '%';
                document.getElementById('avgResponseTime').textContent = Math.round(data.avgResponseTime) + 'ms';
                document.getElementById('requestRate').textContent = data.requestRate.toFixed(1) + '/s';
                
                // Update adapter stats
                const adapterStatsHtml = Object.entries(data.adapters).map(([name, stats]) => \`
                    <div class="adapter-card">
                        <h3>\${name.toUpperCase()} Adapter</h3>
                        <p>Requests: \${stats.total}</p>
                        <p>Success Rate: \${(stats.successRate * 100).toFixed(1)}%</p>
                        <p>Avg Time: \${Math.round(stats.avgResponseTime)}ms</p>
                    </div>
                \`).join('');
                document.getElementById('adapterStats').innerHTML = adapterStatsHtml;
                
                // Update pool stats
                const poolStatsHtml = Object.entries(data.pools).map(([name, pool]) => {
                    const utilization = ((pool.pool.inUse / pool.pool.maxSize) * 100).toFixed(0);
                    return \`
                        <div class="pool-card">
                            <h3>\${name.toUpperCase()} Pool</h3>
                            <p>In Use: \${pool.pool.inUse} / \${pool.pool.maxSize}</p>
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: \${utilization}%"></div>
                            </div>
                            <p>\${utilization}% Utilization</p>
                        </div>
                    \`;
                }).join('');
                document.getElementById('poolStats').innerHTML = poolStatsHtml;
                
                // Update last update time
                document.getElementById('lastUpdate').textContent = new Date().toLocaleTimeString();
                
            } catch (error) {
                console.error('Failed to fetch metrics:', error);
            }
        }
        
        // Start updating
        updateMetrics();
        setInterval(updateMetrics, 1000);
    </script>
</body>
</html>
            `);
        });
        
        // API endpoint for metrics
        app.get('/api/metrics', (req, res) => {
            const summary = metricsCollector.getSummary();
            const poolMetrics = architecture.resourceManager.getAllMetrics();
            
            res.json({
                totalRequests: summary.totalRequests,
                successRate: (summary.successfulRequests / summary.totalRequests * 100) || 0,
                avgResponseTime: summary.avgResponseTime,
                requestRate: summary.requestRate,
                adapters: summary.adapters,
                pools: poolMetrics,
                timestamp: new Date().toISOString()
            });
        });
        
        // Start the server
        const server = app.listen(port, () => {
            logger.info(`📊 Monitoring Dashboard running at http://localhost:${port}`);
            logger.info('');
            logger.info('='.repeat(60));
            logger.info('✨ Demo is running successfully!');
            logger.info('='.repeat(60));
            logger.info('');
            logger.info('📊 Open http://localhost:3001 in your browser to view the dashboard');
            logger.info('');
            logger.info('The dashboard shows:');
            logger.info('  • Real-time request metrics');
            logger.info('  • Adapter performance statistics');
            logger.info('  • Resource pool utilization');
            logger.info('  • System health status');
            logger.info('');
            logger.info('Metrics are updated every second with simulated data.');
            logger.info('Press Ctrl+C to stop the demo.');
        });
        
        // Simulate some activity
        setInterval(() => {
            // Simulate a request
            const urls = ['https://example.com', 'https://google.com', 'https://github.com'];
            const url = urls[Math.floor(Math.random() * urls.length)];
            metricsCollector.recordRequest({ url, adapter: Math.random() > 0.5 ? 'http' : 'browser' });
        }, 2000);
        
        // Handle graceful shutdown
        process.on('SIGINT', () => {
            logger.info('\nShutting down monitoring dashboard...');
            server.close(() => {
                logger.info('Dashboard stopped. Goodbye!');
                process.exit(0);
            });
        });
        
    } catch (error) {
        logger.error('Demo failed:', error.message);
        console.error('Full error:', error);
        process.exit(1);
    }
}

// Run the demo
runDemo();
