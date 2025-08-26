import { EventEmitter } from 'events';

/**
 * Base ResourcePool class for managing pooled resources
 */
class ResourcePool extends EventEmitter {
    constructor(name, config = {}) {
        super();
        this.name = name;
        this.config = {
            minSize: config.minSize || 1,
            maxSize: config.maxSize || 10,
            acquireTimeout: config.acquireTimeout || 30000,
            idleTimeout: config.idleTimeout || 60000,
            evictionInterval: config.evictionInterval || 30000,
            ...config
        };
        
        this.resources = [];
        this.available = [];
        this.inUse = new Set();
        this.waitQueue = [];
        this.metrics = {
            created: 0,
            destroyed: 0,
            acquired: 0,
            released: 0,
            timeouts: 0,
            errors: 0
        };
        
        this.initialized = false;
        this.evictionTimer = null;
    }

    async initialize() {
        if (this.initialized) return;
        
        // Create minimum resources
        const promises = [];
        for (let i = 0; i < this.config.minSize; i++) {
            promises.push(this._createResource());
        }
        await Promise.all(promises);
        
        // Start eviction timer
        this._startEviction();
        this.initialized = true;
    }

    async acquire() {
        this.metrics.acquired++;
        
        // Try to get available resource
        if (this.available.length > 0) {
            const resource = this.available.shift();
            this.inUse.add(resource);
            return resource;
        }
        
        // Create new resource if under max
        if (this.resources.length < this.config.maxSize) {
            const resource = await this._createResource();
            this.inUse.add(resource);
            return resource;
        }
        
        // Wait for available resource
        return this._waitForResource();
    }

    async release(resource) {
        if (!this.inUse.has(resource)) {
            return;
        }
        
        this.metrics.released++;
        this.inUse.delete(resource);
        
        // Check if resource is still valid
        if (await this._validateResource(resource)) {
            // Fulfill waiting request or return to pool
            if (this.waitQueue.length > 0) {
                const waiter = this.waitQueue.shift();
                this.inUse.add(resource);
                waiter.resolve(resource);
            } else {
                resource.lastUsed = Date.now();
                this.available.push(resource);
            }
        } else {
            await this._destroyResource(resource);
        }
    }

    async _createResource() {
        throw new Error('_createResource must be implemented');
    }

    async _destroyResource(resource) {
        throw new Error('_destroyResource must be implemented');
    }

    async _validateResource(resource) {
        return true;
    }

    async _waitForResource() {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                const index = this.waitQueue.findIndex(w => w.resolve === resolve);
                if (index !== -1) {
                    this.waitQueue.splice(index, 1);
                    this.metrics.timeouts++;
                    reject(new Error(`Resource acquisition timeout after ${this.config.acquireTimeout}ms`));
                }
            }, this.config.acquireTimeout);
            
            this.waitQueue.push({
                resolve: (resource) => {
                    clearTimeout(timeout);
                    resolve(resource);
                },
                reject
            });
        });
    }

    _startEviction() {
        this.evictionTimer = setInterval(() => {
            const now = Date.now();
            const toEvict = this.available.filter(
                r => now - r.lastUsed > this.config.idleTimeout
            );
            
            toEvict.forEach(resource => {
                const index = this.available.indexOf(resource);
                if (index !== -1) {
                    this.available.splice(index, 1);
                    this._destroyResource(resource);
                }
            });
        }, this.config.evictionInterval);
    }

    async shutdown() {
        if (this.evictionTimer) {
            clearInterval(this.evictionTimer);
        }
        
        // Reject all waiting requests
        this.waitQueue.forEach(waiter => {
            waiter.reject(new Error('Pool is shutting down'));
        });
        this.waitQueue = [];
        
        // Destroy all resources
        const allResources = [...this.available, ...this.inUse];
        await Promise.all(allResources.map(r => this._destroyResource(r)));
        
        this.resources = [];
        this.available = [];
        this.inUse.clear();
        this.initialized = false;
    }

    getMetrics() {
        return {
            ...this.metrics,
            total: this.resources.length,
            available: this.available.length,
            inUse: this.inUse.size,
            waiting: this.waitQueue.length
        };
    }
}

/**
 * Centralized ResourceManager for managing all resource pools
 */
class ResourceManager extends EventEmitter {
    constructor() {
        super();
        this.pools = new Map();
        this.metrics = new Map();
        this.shutdownHandlers = [];
    }

    /**
     * Register a resource pool
     */
    registerPool(name, pool) {
        if (this.pools.has(name)) {
            throw new Error(`Pool ${name} already registered`);
        }
        
        this.pools.set(name, pool);
        this.metrics.set(name, {
            acquisitions: 0,
            releases: 0,
            errors: 0,
            avgAcquireTime: 0
        });
        
        // Listen to pool events
        pool.on('error', (err) => {
            this.emit('pool-error', { pool: name, error: err });
        });
        
        return pool;
    }

    /**
     * Get a resource pool
     */
    getPool(name) {
        return this.pools.get(name);
    }

    /**
     * Acquire resource from pool
     */
    async acquire(poolName, options = {}) {
        const pool = this.pools.get(poolName);
        if (!pool) {
            throw new Error(`Pool ${poolName} not found`);
        }
        
        const startTime = Date.now();
        try {
            const resource = await pool.acquire();
            const metrics = this.metrics.get(poolName);
            metrics.acquisitions++;
            metrics.avgAcquireTime = 
                (metrics.avgAcquireTime * (metrics.acquisitions - 1) + (Date.now() - startTime)) / 
                metrics.acquisitions;
            return resource;
        } catch (error) {
            const metrics = this.metrics.get(poolName);
            metrics.errors++;
            throw error;
        }
    }

    /**
     * Release resource to pool
     */
    async release(poolName, resource) {
        const pool = this.pools.get(poolName);
        if (!pool) {
            throw new Error(`Pool ${poolName} not found`);
        }
        
        const metrics = this.metrics.get(poolName);
        metrics.releases++;
        await pool.release(resource);
    }

    /**
     * Get all metrics
     */
    getAllMetrics() {
        const allMetrics = {};
        for (const [name, pool] of this.pools) {
            allMetrics[name] = {
                ...this.metrics.get(name),
                pool: pool.getMetrics()
            };
        }
        return allMetrics;
    }

    /**
     * Graceful shutdown
     */
    async shutdown() {
        this.emit('shutdown-start');
        
        // Run shutdown handlers
        for (const handler of this.shutdownHandlers) {
            await handler();
        }
        
        // Shutdown all pools
        const shutdownPromises = [];
        for (const [name, pool] of this.pools) {
            shutdownPromises.push(
                pool.shutdown().catch(err => {
                    console.error(`Error shutting down pool ${name}:`, err);
                })
            );
        }
        
        await Promise.all(shutdownPromises);
        this.pools.clear();
        this.metrics.clear();
        
        this.emit('shutdown-complete');
    }

    /**
     * Register shutdown handler
     */
    onShutdown(handler) {
        this.shutdownHandlers.push(handler);
    }
}

export { ResourcePool, ResourceManager };
export default ResourceManager;
