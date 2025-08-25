import { logger } from '../logger.js';
import crypto from 'crypto';

/**
 * CacheService - High-performance in-memory caching with TTL and LRU eviction
 * Features:
 * - In-memory storage for sub-millisecond access
 * - TTL (Time To Live) support
 * - LRU (Least Recently Used) eviction
 * - Cache warming and preloading
 * - Statistics and monitoring
 */
export class CacheService {
  constructor(config = {}) {
    this.cache = new Map();
    this.accessOrder = new Map(); // Track access times for LRU
    this.config = {
      maxSize: config.maxSize || 1000, // Maximum number of entries
      defaultTTL: config.defaultTTL || 3600000, // 1 hour default
      checkInterval: config.checkInterval || 60000, // Check expired entries every minute
      enableStats: config.enableStats !== false,
    };
    
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      expired: 0,
      size: 0,
    };
    
    // Start cleanup interval
    this.startCleanup();
  }

  /**
   * Generate cache key from URL and options
   */
  generateKey(url, options = {}) {
    const keyData = {
      url,
      ...options,
    };
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(keyData))
      .digest('hex');
  }

  /**
   * Get value from cache
   */
  get(url, options = {}) {
    const key = this.generateKey(url, options);
    const entry = this.cache.get(key);
    
    if (!entry) {
      this.stats.misses++;
      return null;
    }
    
    // Check if expired
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.accessOrder.delete(key);
      this.stats.expired++;
      this.stats.size--;
      return null;
    }
    
    // Update access time for LRU
    this.accessOrder.set(key, Date.now());
    
    this.stats.hits++;
    
    logger.debug({ 
      url, 
      cacheHit: true,
      age: Date.now() - entry.createdAt 
    }, 'Cache hit');
    
    return entry.value;
  }

  /**
   * Set value in cache
   */
  set(url, value, options = {}) {
    const key = this.generateKey(url, options);
    const ttl = options.ttl || this.config.defaultTTL;
    
    // Check if we need to evict entries
    if (this.cache.size >= this.config.maxSize) {
      this.evictLRU();
    }
    
    const entry = {
      value,
      createdAt: Date.now(),
      expiresAt: Date.now() + ttl,
      size: this.estimateSize(value),
    };
    
    this.cache.set(key, entry);
    this.accessOrder.set(key, Date.now());
    this.stats.size = this.cache.size;
    
    logger.debug({ 
      url, 
      ttl,
      cacheSize: this.cache.size 
    }, 'Value cached');
    
    return true;
  }

  /**
   * Delete specific entry from cache
   */
  delete(url, options = {}) {
    const key = this.generateKey(url, options);
    const deleted = this.cache.delete(key);
    
    if (deleted) {
      this.accessOrder.delete(key);
      this.stats.size--;
    }
    
    return deleted;
  }

  /**
   * Clear entire cache
   */
  clear() {
    const size = this.cache.size;
    this.cache.clear();
    this.accessOrder.clear();
    this.stats.size = 0;
    
    logger.info({ entriesCleared: size }, 'Cache cleared');
  }

  /**
   * Evict least recently used entry
   */
  evictLRU() {
    let oldestKey = null;
    let oldestTime = Date.now();
    
    for (const [key, time] of this.accessOrder) {
      if (time < oldestTime) {
        oldestTime = time;
        oldestKey = key;
      }
    }
    
    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.accessOrder.delete(oldestKey);
      this.stats.evictions++;
      this.stats.size--;
      
      logger.debug({ key: oldestKey }, 'LRU entry evicted');
    }
  }

  /**
   * Estimate size of cached value
   */
  estimateSize(value) {
    if (typeof value === 'string') {
      return value.length;
    }
    if (value && typeof value === 'object') {
      return JSON.stringify(value).length;
    }
    return 0;
  }

  /**
   * Clean up expired entries
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        this.accessOrder.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      this.stats.expired += cleaned;
      this.stats.size = this.cache.size;
      logger.debug({ cleaned }, 'Expired entries cleaned');
    }
  }

  /**
   * Start cleanup interval
   */
  startCleanup() {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.config.checkInterval);
  }
  
  /**
   * Stop cleanup interval
   */
  stopCleanup() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
  
  /**
   * Destroy the cache service and clean up resources
   */
  destroy() {
    this.stopCleanup();
    this.cache.clear();
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      expired: 0,
    };
  }

  /**
   * Get cache statistics
   */
  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? (this.stats.hits / (this.stats.hits + this.stats.misses)) * 100
      : 0;
    
    return {
      ...this.stats,
      hitRate: hitRate.toFixed(2) + '%',
      totalRequests: this.stats.hits + this.stats.misses,
    };
  }

  /**
   * Warm cache with frequently accessed URLs
   */
  async warmCache(urls, fetcher) {
    logger.info({ count: urls.length }, 'Warming cache');
    
    const results = await Promise.allSettled(
      urls.map(async (url) => {
        try {
          const result = await fetcher(url);
          this.set(url, result);
          return { url, status: 'cached' };
        } catch (error) {
          logger.warn({ url, error: error.message }, 'Failed to warm cache entry');
          return { url, status: 'failed' };
        }
      })
    );
    
    const successful = results.filter(r => r.value?.status === 'cached').length;
    logger.info({ successful, total: urls.length }, 'Cache warming complete');
    
    return results;
  }
}

// Singleton instance
let cacheInstance = null;

export function getCacheService(config = {}) {
  if (!cacheInstance) {
    cacheInstance = new CacheService(config);
  }
  return cacheInstance;
}

export function destroyCacheService() {
  if (cacheInstance) {
    cacheInstance.destroy();
    cacheInstance = null;
  }
}
