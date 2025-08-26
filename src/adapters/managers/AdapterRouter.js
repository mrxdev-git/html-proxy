const EventEmitter = require('events');

/**
 * Circuit Breaker implementation for fault tolerance
 */
class CircuitBreaker {
    constructor(name, config = {}) {
        this.name = name;
        this.failureThreshold = config.failureThreshold || 5;
        this.successThreshold = config.successThreshold || 2;
        this.timeout = config.timeout || 60000; // 1 minute
        this.halfOpenRequests = config.halfOpenRequests || 1;
        
        this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
        this.failures = 0;
        this.successes = 0;
        this.nextAttempt = Date.now();
        this.requestsInHalfOpen = 0;
        
        this.stats = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            rejectedRequests: 0,
            timeouts: 0,
            lastFailureTime: null,
            lastSuccessTime: null
        };
    }

    async execute(fn) {
        this.stats.totalRequests++;
        
        if (this.state === 'OPEN') {
            if (Date.now() < this.nextAttempt) {
                this.stats.rejectedRequests++;
                throw new Error(`Circuit breaker is OPEN for ${this.name}`);
            }
            this.state = 'HALF_OPEN';
            this.requestsInHalfOpen = 0;
        }
        
        if (this.state === 'HALF_OPEN' && this.requestsInHalfOpen >= this.halfOpenRequests) {
            this.stats.rejectedRequests++;
            throw new Error(`Circuit breaker is HALF_OPEN and at capacity for ${this.name}`);
        }
        
        try {
            if (this.state === 'HALF_OPEN') {
                this.requestsInHalfOpen++;
            }
            
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    onSuccess() {
        this.stats.successfulRequests++;
        this.stats.lastSuccessTime = Date.now();
        this.failures = 0;
        
        if (this.state === 'HALF_OPEN') {
            this.successes++;
            if (this.successes >= this.successThreshold) {
                this.state = 'CLOSED';
                this.successes = 0;
            }
        }
    }

    onFailure() {
        this.stats.failedRequests++;
        this.stats.lastFailureTime = Date.now();
        this.failures++;
        this.successes = 0;
        
        if (this.failures >= this.failureThreshold) {
            this.state = 'OPEN';
            this.nextAttempt = Date.now() + this.timeout;
        }
    }

    getState() {
        return {
            state: this.state,
            failures: this.failures,
            successes: this.successes,
            stats: { ...this.stats }
        };
    }

    reset() {
        this.state = 'CLOSED';
        this.failures = 0;
        this.successes = 0;
        this.nextAttempt = Date.now();
        this.requestsInHalfOpen = 0;
    }
}

/**
 * Intelligent AdapterRouter with scoring, circuit breakers, and routing rules
 */
class AdapterRouter extends EventEmitter {
    constructor(config = {}) {
        super();
        
        this.adapters = new Map();
        this.routingRules = [];
        this.circuitBreakers = new Map();
        this.performanceMetrics = new Map();
        
        this.config = {
            defaultTimeout: config.defaultTimeout || 30000,
            scoreUpdateInterval: config.scoreUpdateInterval || 60000,
            metricsRetentionPeriod: config.metricsRetentionPeriod || 3600000, // 1 hour
            circuitBreakerConfig: {
                failureThreshold: 5,
                successThreshold: 2,
                timeout: 60000,
                halfOpenRequests: 1,
                ...config.circuitBreakerConfig
            },
            ...config
        };
        
        this.scoreUpdateTimer = null;
        this.metricsCleanupTimer = null;
        
        this._startPeriodicTasks();
    }

    /**
     * Register an adapter
     */
    registerAdapter(name, adapter, config = {}) {
        if (this.adapters.has(name)) {
            throw new Error(`Adapter ${name} already registered`);
        }
        
        this.adapters.set(name, {
            adapter,
            config,
            score: config.initialScore || 50,
            enabled: config.enabled !== false,
            priority: config.priority || 50
        });
        
        // Initialize circuit breaker
        this.circuitBreakers.set(name, new CircuitBreaker(name, this.config.circuitBreakerConfig));
        
        // Initialize performance metrics
        this.performanceMetrics.set(name, {
            requests: [],
            avgResponseTime: 0,
            successRate: 1.0,
            lastUpdated: Date.now()
        });
        
        this.emit('adapter-registered', { name, config });
    }

    /**
     * Add routing rule
     */
    addRoutingRule(rule) {
        if (!rule.name || !rule.condition || !rule.adapter) {
            throw new Error('Routing rule must have name, condition, and adapter');
        }
        
        this.routingRules.push({
            name: rule.name,
            condition: rule.condition,
            adapter: rule.adapter,
            priority: rule.priority || 0,
            enabled: rule.enabled !== false
        });
        
        // Sort rules by priority
        this.routingRules.sort((a, b) => b.priority - a.priority);
        
        this.emit('routing-rule-added', rule);
    }

    /**
     * Select best adapter for URL
     */
    async selectAdapter(url, options = {}) {
        // Check routing rules first
        const ruleAdapter = this._checkRoutingRules(url, options);
        if (ruleAdapter) {
            return ruleAdapter;
        }
        
        // Score-based selection
        const candidates = await this._getCandidates(url, options);
        if (candidates.length === 0) {
            throw new Error('No suitable adapter available');
        }
        
        // Sort by score
        candidates.sort((a, b) => b.score - a.score);
        
        // Try adapters in order until one is available
        for (const candidate of candidates) {
            const breaker = this.circuitBreakers.get(candidate.name);
            if (breaker && breaker.state === 'OPEN') {
                continue;
            }
            
            return candidate;
        }
        
        // If all circuit breakers are open, use the best one anyway
        return candidates[0];
    }

    /**
     * Execute request with selected adapter
     */
    async execute(url, options = {}) {
        const startTime = Date.now();
        let selectedAdapter = null;
        
        try {
            // Select adapter
            const adapterInfo = await this.selectAdapter(url, options);
            selectedAdapter = adapterInfo.name;
            
            // Get circuit breaker
            const breaker = this.circuitBreakers.get(selectedAdapter);
            
            // Execute with circuit breaker
            const result = await breaker.execute(async () => {
                const adapter = this.adapters.get(selectedAdapter).adapter;
                return await adapter.fetch(url, options);
            });
            
            // Record success
            this._recordMetric(selectedAdapter, {
                success: true,
                responseTime: Date.now() - startTime,
                timestamp: Date.now()
            });
            
            return result;
        } catch (error) {
            // Record failure
            if (selectedAdapter) {
                this._recordMetric(selectedAdapter, {
                    success: false,
                    responseTime: Date.now() - startTime,
                    timestamp: Date.now(),
                    error: error.message
                });
            }
            
            // Try fallback adapter if available
            if (options.fallback !== false && selectedAdapter) {
                return this._tryFallback(url, options, selectedAdapter, error);
            }
            
            throw error;
        }
    }

    /**
     * Check routing rules
     */
    _checkRoutingRules(url, options) {
        for (const rule of this.routingRules) {
            if (!rule.enabled) continue;
            
            try {
                let matches = false;
                
                // Execute condition function or regex
                if (typeof rule.condition === 'function') {
                    matches = rule.condition(url, options);
                } else if (rule.condition instanceof RegExp) {
                    matches = rule.condition.test(url);
                } else if (typeof rule.condition === 'string') {
                    matches = url.includes(rule.condition);
                }
                
                if (matches) {
                    const adapterInfo = this.adapters.get(rule.adapter);
                    if (adapterInfo && adapterInfo.enabled) {
                        this.emit('routing-rule-matched', {
                            rule: rule.name,
                            adapter: rule.adapter,
                            url
                        });
                        
                        return {
                            name: rule.adapter,
                            ...adapterInfo
                        };
                    }
                }
            } catch (error) {
                this.emit('routing-rule-error', {
                    rule: rule.name,
                    error: error.message
                });
            }
        }
        
        return null;
    }

    /**
     * Get candidate adapters
     */
    async _getCandidates(url, options) {
        const candidates = [];
        
        for (const [name, info] of this.adapters) {
            if (!info.enabled) continue;
            
            const adapter = info.adapter;
            
            // Check if adapter can handle URL
            if (adapter.canHandle && !await adapter.canHandle(url)) {
                continue;
            }
            
            // Calculate score
            const score = await this._calculateScore(name, url, options);
            
            candidates.push({
                name,
                adapter,
                score,
                ...info
            });
        }
        
        return candidates;
    }

    /**
     * Calculate adapter score
     */
    async _calculateScore(adapterName, url, options) {
        const adapterInfo = this.adapters.get(adapterName);
        const adapter = adapterInfo.adapter;
        const metrics = this.performanceMetrics.get(adapterName);
        const breaker = this.circuitBreakers.get(adapterName);
        
        let score = adapterInfo.score;
        
        // Factor 1: Adapter priority for URL
        if (adapter.getPriority) {
            const priority = await adapter.getPriority(url);
            score = score * 0.3 + priority * 0.7;
        }
        
        // Factor 2: Performance metrics
        if (metrics && metrics.requests.length > 0) {
            const performanceScore = (metrics.successRate * 100) * 0.7 + 
                                    (1 - Math.min(metrics.avgResponseTime / 10000, 1)) * 30;
            score = score * 0.5 + performanceScore * 0.5;
        }
        
        // Factor 3: Circuit breaker state
        if (breaker) {
            const state = breaker.getState();
            if (state.state === 'OPEN') {
                score *= 0.1; // Heavily penalize open circuit
            } else if (state.state === 'HALF_OPEN') {
                score *= 0.5; // Moderately penalize half-open
            }
        }
        
        // Factor 4: Capabilities match
        if (adapter.getCapabilities) {
            const capabilities = adapter.getCapabilities();
            let capabilityScore = 50;
            
            if (options.javascript && capabilities.supportsJavaScript) {
                capabilityScore += 20;
            }
            if (options.screenshot && capabilities.supportsScreenshot) {
                capabilityScore += 15;
            }
            if (options.stealth && capabilities.supportsStealth) {
                capabilityScore += 15;
            }
            
            score = score * 0.7 + capabilityScore * 0.3;
        }
        
        return Math.max(0, Math.min(100, score));
    }

    /**
     * Try fallback adapter
     */
    async _tryFallback(url, options, failedAdapter, originalError) {
        const candidates = await this._getCandidates(url, options);
        
        // Filter out failed adapter
        const fallbacks = candidates.filter(c => c.name !== failedAdapter);
        
        if (fallbacks.length === 0) {
            throw originalError;
        }
        
        // Sort by score
        fallbacks.sort((a, b) => b.score - a.score);
        
        // Try first fallback
        const fallback = fallbacks[0];
        const breaker = this.circuitBreakers.get(fallback.name);
        
        this.emit('fallback-attempt', {
            failed: failedAdapter,
            fallback: fallback.name,
            url
        });
        
        try {
            const result = await breaker.execute(async () => {
                return await fallback.adapter.fetch(url, options);
            });
            
            this._recordMetric(fallback.name, {
                success: true,
                responseTime: Date.now(),
                timestamp: Date.now(),
                wasFallback: true
            });
            
            return result;
        } catch (fallbackError) {
            this._recordMetric(fallback.name, {
                success: false,
                responseTime: Date.now(),
                timestamp: Date.now(),
                error: fallbackError.message,
                wasFallback: true
            });
            
            throw originalError; // Throw original error
        }
    }

    /**
     * Record performance metric
     */
    _recordMetric(adapterName, metric) {
        const metrics = this.performanceMetrics.get(adapterName);
        if (!metrics) return;
        
        metrics.requests.push(metric);
        
        // Keep only recent metrics
        const cutoff = Date.now() - this.config.metricsRetentionPeriod;
        metrics.requests = metrics.requests.filter(r => r.timestamp > cutoff);
        
        // Update aggregates
        if (metrics.requests.length > 0) {
            const successful = metrics.requests.filter(r => r.success).length;
            metrics.successRate = successful / metrics.requests.length;
            
            const responseTimes = metrics.requests
                .filter(r => r.responseTime)
                .map(r => r.responseTime);
            
            if (responseTimes.length > 0) {
                metrics.avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
            }
        }
        
        metrics.lastUpdated = Date.now();
    }

    /**
     * Start periodic tasks
     */
    _startPeriodicTasks() {
        // Update scores periodically
        this.scoreUpdateTimer = setInterval(() => {
            this._updateScores();
        }, this.config.scoreUpdateInterval);
        
        // Cleanup old metrics
        this.metricsCleanupTimer = setInterval(() => {
            this._cleanupMetrics();
        }, this.config.metricsRetentionPeriod / 2);
    }

    /**
     * Update adapter scores based on performance
     */
    _updateScores() {
        for (const [name, info] of this.adapters) {
            const metrics = this.performanceMetrics.get(name);
            if (!metrics || metrics.requests.length === 0) continue;
            
            // Adjust base score based on performance
            const performanceScore = metrics.successRate * 70 + 
                                    (1 - Math.min(metrics.avgResponseTime / 10000, 1)) * 30;
            
            // Smooth score update
            info.score = info.score * 0.7 + performanceScore * 0.3;
        }
    }

    /**
     * Cleanup old metrics
     */
    _cleanupMetrics() {
        const cutoff = Date.now() - this.config.metricsRetentionPeriod;
        
        for (const metrics of this.performanceMetrics.values()) {
            metrics.requests = metrics.requests.filter(r => r.timestamp > cutoff);
        }
    }

    /**
     * Get router statistics
     */
    getStatistics() {
        const stats = {
            adapters: {},
            routingRules: this.routingRules.map(r => ({
                name: r.name,
                adapter: r.adapter,
                priority: r.priority,
                enabled: r.enabled
            }))
        };
        
        for (const [name, info] of this.adapters) {
            const metrics = this.performanceMetrics.get(name);
            const breaker = this.circuitBreakers.get(name);
            
            stats.adapters[name] = {
                enabled: info.enabled,
                score: Math.round(info.score),
                priority: info.priority,
                metrics: {
                    requests: metrics.requests.length,
                    successRate: Math.round(metrics.successRate * 100) / 100,
                    avgResponseTime: Math.round(metrics.avgResponseTime),
                    lastUpdated: new Date(metrics.lastUpdated).toISOString()
                },
                circuitBreaker: breaker.getState()
            };
        }
        
        return stats;
    }

    /**
     * Shutdown router
     */
    async shutdown() {
        if (this.scoreUpdateTimer) {
            clearInterval(this.scoreUpdateTimer);
        }
        
        if (this.metricsCleanupTimer) {
            clearInterval(this.metricsCleanupTimer);
        }
        
        this.emit('shutdown');
    }
}

module.exports = AdapterRouter;
