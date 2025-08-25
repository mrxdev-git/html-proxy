import { HttpAdapter } from '../adapters/http.js';
import { BrowserAdapter } from '../adapters/browser.js';
import { CrawleeHttpAdapter } from '../adapters/crawleeHttp.js';
import { CrawleeBrowserAdapter } from '../adapters/crawleeBrowser.js';
import { CrawleeService } from './crawleeService.js';
import { ProxyPool } from '../proxy/proxyPool.js';
import { logger } from '../logger.js';
import { validateUrlSafety } from '../utils/ssrf.js';
import { getCacheService } from './cacheService.js';

export class FetcherService {
  constructor(config) {
    this.config = config;
    this.proxyPool = new ProxyPool(config.proxies || []);
    
    // Initialize cache service for high-performance data retrieval
    this.cache = getCacheService({
      maxSize: config.cacheMaxSize || 500,
      defaultTTL: config.cacheTTL || 3600000, // 1 hour
    });
    
    // Initialize both legacy and Crawlee adapters
    this.adapters = {
      // Legacy adapters
      http: new HttpAdapter({ timeoutMs: config.timeoutMs, userAgent: config.userAgent }),
      browser: new BrowserAdapter({ timeoutMs: config.timeoutMs, userAgent: config.userAgent, headless: config.headless }),
      
      // New Crawlee adapters
      'crawlee-http': new CrawleeHttpAdapter(config),
      'crawlee-browser': new CrawleeBrowserAdapter(config),
    };
    
    // Initialize adaptive Crawlee service
    this.crawleeService = new CrawleeService(config);
    
    logger.info({ cacheEnabled: true, cacheMaxSize: config.cacheMaxSize || 500 }, 'FetcherService initialized with caching');
  }

  pickAdapter(mode) {
    const key = (mode || this.config.defaultMode || 'http').toLowerCase();
    return this.adapters[key] || this.adapters.http;
  }

  async fetch(rawUrl, { mode, headers, skipCache = false } = {}) {
    const safeUrl = await validateUrlSafety(rawUrl, {
      allowPrivateNetworks: this.config.allowPrivateNetworks,
      blocklistHosts: this.config.blocklistHosts,
    });

    const requestedMode = mode || this.config.defaultMode || 'http';
    
    // Check cache first for maximum performance
    if (!skipCache) {
      const cached = this.cache.get(safeUrl.href, { mode: requestedMode });
      if (cached) {
        logger.info({ url: rawUrl, mode: requestedMode }, 'Returning cached result');
        return cached;
      }
    }

    // Use adaptive Crawlee service for 'adaptive' mode
    if (requestedMode === 'adaptive') {
      try {
        return await this.crawleeService.fetch(safeUrl.href, { mode: requestedMode, headers });
      } catch (error) {
        logger.warn({ url: rawUrl, error: error.message }, 'Adaptive Crawlee fetch failed');
        throw error;
      }
    }

    // Use specific adapters for other modes
    const adapter = this.pickAdapter(requestedMode);

    // Enhanced retry strategy with intelligent fallback
    const maxAttempts = Math.max(1, this.config.maxRetries + 1);
    let lastErr;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const proxy = this.proxyPool.size() > 0 ? this.proxyPool.next() : null;
      try {
        const res = await adapter.fetch(safeUrl.href, { proxy, headers });
        if (proxy) this.proxyPool.reportSuccess(proxy);
        
        // Cache the successful result for future requests
        if (!skipCache && res && res.body) {
          this.cache.set(safeUrl.href, res, { mode: requestedMode });
        }
        
        return res;
      } catch (e) {
        if (proxy) this.proxyPool.reportFailure(proxy);
        lastErr = e;
        logger.warn({ attempt: attempt + 1, proxy, err: e.message }, 'Fetch attempt failed');
        
        // Intelligent fallback: if Crawlee adapter fails, try legacy adapter
        if (attempt === maxAttempts - 1 && requestedMode.startsWith('crawlee-')) {
          const fallbackMode = requestedMode.replace('crawlee-', '');
          if (this.adapters[fallbackMode]) {
            logger.info({ fallbackMode }, 'Attempting fallback to legacy adapter');
            try {
              const fallbackAdapter = this.adapters[fallbackMode];
              const res = await fallbackAdapter.fetch(safeUrl.href, { proxy, headers });
              
              // Cache the successful fallback result
              if (!skipCache && res && res.body) {
                this.cache.set(safeUrl.href, res, { mode: requestedMode });
              }
              
              return { ...res, adapter: `${fallbackMode}-fallback` };
            } catch (fallbackErr) {
              logger.warn({ fallbackErr: fallbackErr.message }, 'Fallback adapter also failed');
            }
          }
        }
        
        if (attempt === maxAttempts - 1) break;
      }
    }
    throw lastErr || new Error('Fetch failed');
  }

  async close() {
    // Cleanup Crawlee resources
    if (this.crawleeService) {
      await this.crawleeService.close();
    }
    
    // Cleanup Crawlee adapters
    for (const adapter of Object.values(this.adapters)) {
      if (adapter.close) {
        await adapter.close();
      }
    }
  }
}
