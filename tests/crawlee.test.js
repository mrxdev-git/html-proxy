import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { getConfig } from '../src/config/index.js';
import { CrawleeService } from '../src/services/crawleeService.js';
import { FetcherService } from '../src/services/fetcherService.js';
import { destroyCacheService } from '../src/services/cacheService.js';
import { destroyMonitoringService } from '../src/services/monitoringService.js';

describe('Crawlee Integration Tests', () => {
  let config;
  let crawleeService;
  let fetcherService;

  beforeAll(() => {
    config = getConfig();
    crawleeService = new CrawleeService(config);
    fetcherService = new FetcherService(config);
  });

  afterAll(async () => {
    // Clean up crawlee service
    if (crawleeService) {
      await crawleeService.close();
    }
    
    // Clean up fetcher service and its adapters
    if (fetcherService) {
      // Destroy the crawlee-browser adapter which has the pool
      if (fetcherService.adapters['crawlee-browser']) {
        await fetcherService.adapters['crawlee-browser'].destroy();
      }
      await fetcherService.close();
    }
    
    // Clean up singleton services
    destroyCacheService();
    destroyMonitoringService();
  });

  test('CrawleeService should initialize correctly', () => {
    expect(crawleeService).toBeDefined();
    expect(crawleeService.crawler).toBeDefined();
  });

  test('FetcherService should support new Crawlee modes', () => {
    expect(fetcherService.adapters['crawlee-http']).toBeDefined();
    expect(fetcherService.adapters['crawlee-browser']).toBeDefined();
    expect(fetcherService.crawleeService).toBeDefined();
  });

  test('should fetch simple HTML page with adaptive mode', async () => {
    const result = await fetcherService.fetch('https://httpbin.org/html', { mode: 'adaptive' });
    
    expect(result).toBeDefined();
    expect(result.body).toContain('<html');
    expect(result.status).toBe(200);
    expect(result.adapter).toBe('crawlee-adaptive');
  }, 30000);

  test('should fetch with crawlee-http adapter', async () => {
    const result = await fetcherService.fetch('https://httpbin.org/html', { mode: 'crawlee-http' });
    
    expect(result).toBeDefined();
    expect(result.body).toContain('<html');
    expect(result.status).toBe(200);
  }, 20000);

  test('should handle errors gracefully', async () => {
    // Test error handling with an invalid URL that will fail SSRF validation
    try {
      await fetcherService.fetch('file:///etc/passwd', { 
        mode: 'adaptive'
      });
      // Should not reach here
      expect(true).toBe(false);
    } catch (error) {
      // We expect an error to be thrown for invalid protocol
      expect(error).toBeDefined();
      expect(error.message).toBeDefined();
      expect(error.message).toMatch(/Only http/);
    }
  }, 5000); // Shorter timeout since SSRF validation fails quickly

  test('should validate configuration options', () => {
    expect(config.maxSessions).toBeDefined();
    expect(config.renderingDetectionRatio).toBeDefined();
    expect(config.fingerprintBrowsers).toBeDefined();
    expect(Array.isArray(config.fingerprintBrowsers)).toBe(true);
  });
});
