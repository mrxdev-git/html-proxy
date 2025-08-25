// Tests FetcherService in HTTP mode with proxy pool present but unused
import { jest, describe, test, expect, beforeEach, afterAll, beforeAll, afterEach } from '@jest/globals';

jest.unstable_mockModule('dns/promises', () => ({
  // Provide both default export with lookup method and named export for assertions
  default: { lookup: jest.fn(async () => [{ address: '93.184.216.34', family: 4 }]) },
  lookup: jest.fn(async () => [{ address: '93.184.216.34', family: 4 }]), // example.org
}));

import nock from 'nock';
import { FetcherService } from '../src/services/fetcherService.js';
import { destroyCacheService } from '../src/services/cacheService.js';
import { setDnsModule } from '../src/utils/ssrf.js';

const HTML = '<!doctype html><html><head><title>X</title></head><body>Hello</body></html>';

describe('FetcherService HTTP', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });
  afterAll(() => {
    nock.enableNetConnect();
  });
  afterEach(() => {
    nock.cleanAll();
  });

  describe('Fetcher tests', () => {
    let fetcher;
    let config;

    beforeAll(() => {
      // Mock DNS module to prevent actual DNS lookups
      const mockDns = {
        lookup: jest.fn(async (host, options) => {
          // Return a public IP for all test domains
          return [{ address: '93.184.216.34', family: 4 }];
        })
      };
      setDnsModule(mockDns);
    });

    beforeEach(() => {
      // Reset configuration for each test
      config = {
        defaultMode: 'http',
        cacheEnabled: true,
        defaultTimeout: 5000,
        userAgent: 'test-agent',
        maxRetries: 2,
        allowPrivateNetworks: false,
        proxies: [],
        blocklistHosts: ['evil.com'],
      };
      
      fetcher = new FetcherService(config);
    });
    
    afterEach(() => {
      // Clean up any remaining nock interceptors
      nock.cleanAll();
      // Clear cache to ensure tests are isolated
      if (fetcher && fetcher.cache) {
        fetcher.cache.clear();
      }
    });

    afterAll(async () => {
      // Clean up adapters if they have destroy methods
      if (fetcher) {
        if (fetcher.adapters['crawlee-browser']) {
          await fetcher.adapters['crawlee-browser'].destroy();
        }
        if (fetcher.close) {
          await fetcher.close();
        }
      }
      
      // Clean up singleton cache service
      destroyCacheService();
    });

    test('fetches page via HTTP adapter and returns HTML', async () => {
      nock('http://example.org').get('/').reply(200, HTML, { 'Content-Type': 'text/html' });
      const res = await fetcher.fetch('http://example.org');
      expect(res.status).toBe(200);
      expect(res.body).toContain('Hello');
      // DNS was mocked; core behavior validated via status/body
    });

    test('retries on failure', async () => {
      // Use a unique URL to avoid cache conflicts
      const retryUrl = 'http://retry-test.example.org';
      
      // Set up interceptor that fails once then succeeds
      let callCount = 0;
      nock('http://retry-test.example.org')
        .get('/')
        .times(2) // Allow up to 2 calls
        .reply(() => {
          callCount++;
          if (callCount === 1) {
            return [500, 'Server Error'];
          }
          return [200, HTML];
        });

      const res = await fetcher.fetch(retryUrl);
      expect(res.status).toBe(200);
      expect(res.body).toContain('Hello');
      expect(callCount).toBe(2); // Verify it was called twice (initial + retry)
    });
  });
});
