const { ResourcePool } = require('../managers/ResourceManager');
const axios = require('axios');
const { HttpProxyAgent } = require('http-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const crypto = require('crypto');

/**
 * HTTP Connection Pool for managing axios instances with proxy rotation
 */
class HttpConnectionPool extends ResourcePool {
    constructor(config = {}) {
        super('HttpConnectionPool', {
            minSize: config.minSize || 5,
            maxSize: config.maxSize || 50,
            acquireTimeout: config.acquireTimeout || 10000,
            idleTimeout: config.idleTimeout || 120000, // 2 minutes
            evictionInterval: config.evictionInterval || 30000,
            ...config
        });
        
        this.proxies = config.proxies || [];
        this.rotateProxies = config.rotateProxies !== false && this.proxies.length > 0;
        this.currentProxyIndex = 0;
        
        this.defaultHeaders = {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            ...config.defaultHeaders
        };
        
        this.userAgents = config.userAgents || [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        ];
        
        this.connectionConfig = {
            timeout: config.timeout || 30000,
            maxRedirects: config.maxRedirects || 5,
            validateStatus: config.validateStatus || ((status) => status < 500),
            decompress: true,
            ...config.connectionConfig
        };
    }

    /**
     * Create a new HTTP connection resource
     */
    async _createResource() {
        const startTime = Date.now();
        
        try {
            const connectionId = crypto.randomBytes(8).toString('hex');
            
            // Get proxy configuration if available
            const proxyConfig = this._getProxyConfig();
            
            // Select random user agent
            const userAgent = this._getRandomUserAgent();
            
            // Create axios instance with configuration
            const axiosConfig = {
                ...this.connectionConfig,
                headers: {
                    ...this.defaultHeaders,
                    'User-Agent': userAgent
                }
            };
            
            // Add proxy if available
            if (proxyConfig) {
                if (proxyConfig.url.startsWith('https')) {
                    axiosConfig.httpsAgent = new HttpsProxyAgent(proxyConfig.url);
                    axiosConfig.httpAgent = new HttpProxyAgent(proxyConfig.url);
                } else {
                    axiosConfig.httpAgent = new HttpProxyAgent(proxyConfig.url);
                }
                axiosConfig.proxy = false; // Disable axios built-in proxy
            }
            
            const instance = axios.create(axiosConfig);
            
            // Add request interceptor for metrics
            instance.interceptors.request.use(
                (config) => {
                    config.metadata = { startTime: Date.now() };
                    return config;
                },
                (error) => {
                    return Promise.reject(error);
                }
            );
            
            // Add response interceptor for metrics
            instance.interceptors.response.use(
                (response) => {
                    const duration = Date.now() - response.config.metadata.startTime;
                    this.emit('request-complete', {
                        connectionId,
                        duration,
                        status: response.status
                    });
                    return response;
                },
                (error) => {
                    if (error.config && error.config.metadata) {
                        const duration = Date.now() - error.config.metadata.startTime;
                        this.emit('request-error', {
                            connectionId,
                            duration,
                            error: error.message
                        });
                    }
                    return Promise.reject(error);
                }
            );
            
            const resource = {
                id: connectionId,
                instance,
                proxy: proxyConfig,
                userAgent,
                created: Date.now(),
                lastUsed: Date.now(),
                requestCount: 0,
                errors: 0,
                totalResponseTime: 0
            };
            
            this.resources.push(resource);
            this.available.push(resource);
            this.metrics.created++;
            
            this.emit('connection-created', {
                id: resource.id,
                proxy: proxyConfig ? proxyConfig.url : null,
                duration: Date.now() - startTime
            });
            
            return resource;
        } catch (error) {
            this.metrics.errors++;
            this.emit('error', error);
            throw error;
        }
    }

    /**
     * Destroy an HTTP connection resource
     */
    async _destroyResource(resource) {
        try {
            // Cancel any pending requests
            if (resource.instance.defaults.cancelToken) {
                resource.instance.defaults.cancelToken.cancel('Connection pool cleanup');
            }
            
            // Remove from resources array
            const index = this.resources.indexOf(resource);
            if (index !== -1) {
                this.resources.splice(index, 1);
            }
            
            this.metrics.destroyed++;
            this.emit('connection-destroyed', { id: resource.id });
        } catch (error) {
            this.emit('error', error);
        }
    }

    /**
     * Validate HTTP connection resource
     */
    async _validateResource(resource) {
        try {
            // Check error rate
            if (resource.errors > 10) {
                return false;
            }
            
            // Check if connection has been used too much
            if (resource.requestCount > 500) {
                return false;
            }
            
            // Check age (rotate connections periodically)
            const age = Date.now() - resource.created;
            if (age > 1800000) { // 30 minutes
                return false;
            }
            
            // Check average response time
            if (resource.requestCount > 0) {
                const avgResponseTime = resource.totalResponseTime / resource.requestCount;
                if (avgResponseTime > 10000) { // 10 seconds average
                    return false;
                }
            }
            
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Execute HTTP request with connection
     */
    async request(resource, config) {
        try {
            resource.requestCount++;
            resource.lastUsed = Date.now();
            
            const startTime = Date.now();
            const response = await resource.instance.request(config);
            
            resource.totalResponseTime += (Date.now() - startTime);
            
            return response;
        } catch (error) {
            resource.errors++;
            
            // Check if proxy error
            if (this._isProxyError(error) && resource.proxy) {
                this.emit('proxy-error', {
                    connectionId: resource.id,
                    proxy: resource.proxy.url,
                    error: error.message
                });
                
                // Mark proxy as bad
                this._markProxyBad(resource.proxy);
            }
            
            throw error;
        }
    }

    /**
     * Get proxy configuration
     */
    _getProxyConfig() {
        if (!this.rotateProxies || this.proxies.length === 0) {
            return null;
        }
        
        // Find next working proxy
        let attempts = 0;
        while (attempts < this.proxies.length) {
            const proxy = this.proxies[this.currentProxyIndex];
            this.currentProxyIndex = (this.currentProxyIndex + 1) % this.proxies.length;
            
            if (!proxy.isBad || Date.now() - proxy.lastBadTime > 300000) { // 5 minutes
                proxy.isBad = false;
                return proxy;
            }
            
            attempts++;
        }
        
        // All proxies are bad, reset and try first one
        this.proxies.forEach(p => p.isBad = false);
        return this.proxies[0];
    }

    /**
     * Mark proxy as bad
     */
    _markProxyBad(proxy) {
        if (proxy) {
            proxy.isBad = true;
            proxy.lastBadTime = Date.now();
        }
    }

    /**
     * Check if error is proxy-related
     */
    _isProxyError(error) {
        if (!error) return false;
        
        const proxyErrors = [
            'ECONNREFUSED',
            'ETIMEDOUT',
            'ENOTFOUND',
            'ECONNRESET',
            'EHOSTUNREACH',
            'ENETUNREACH',
            'EPROTO'
        ];
        
        return proxyErrors.some(code => 
            error.code === code || 
            (error.message && error.message.includes(code))
        );
    }

    /**
     * Get random user agent
     */
    _getRandomUserAgent() {
        return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
    }

    /**
     * Get pool statistics
     */
    getStatistics() {
        const stats = {
            ...this.getMetrics(),
            connections: this.resources.map(r => ({
                id: r.id,
                created: new Date(r.created).toISOString(),
                requestCount: r.requestCount,
                errors: r.errors,
                avgResponseTime: r.requestCount > 0 
                    ? Math.round(r.totalResponseTime / r.requestCount) 
                    : 0,
                proxy: r.proxy ? r.proxy.url : null,
                userAgent: r.userAgent.substring(0, 50) + '...'
            })),
            proxies: this.proxies.map(p => ({
                url: p.url,
                isBad: p.isBad || false,
                lastBadTime: p.lastBadTime 
                    ? new Date(p.lastBadTime).toISOString() 
                    : null
            }))
        };
        
        return stats;
    }

    /**
     * Add proxy to rotation
     */
    addProxy(proxyUrl) {
        this.proxies.push({
            url: proxyUrl,
            isBad: false,
            lastBadTime: null
        });
    }

    /**
     * Remove proxy from rotation
     */
    removeProxy(proxyUrl) {
        const index = this.proxies.findIndex(p => p.url === proxyUrl);
        if (index !== -1) {
            this.proxies.splice(index, 1);
        }
    }
}

module.exports = HttpConnectionPool;
