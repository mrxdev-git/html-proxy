import { jest, describe, test, expect, afterAll, beforeAll } from '@jest/globals';
import { validateUrlSafety, hostnameMatchesBlocklist, setDnsModule } from '../src/utils/ssrf.js';
import { FetcherService } from '../src/services/fetcherService.js';
import { destroyCacheService } from '../src/services/cacheService.js';

describe('SSRF protection', () => {
  beforeAll(() => {
    // Create and inject mock DNS module
    const mockLookup = async (host, options) => {
      // Map hostnames to IP addresses
      const hostMap = {
        'private.local': '192.168.1.10',
        'loop.local': '127.0.0.1',
        'api.internal': '93.184.216.34',
        'example.org': '93.184.216.34'
      };
      
      const address = hostMap[host] || '93.184.216.34'; // default
      
      // When options.all is true, return an array of address objects
      if (options && options.all) {
        return [{ address, family: 4 }];
      }
      // For single lookup (without 'all' option)
      return { address, family: 4 };
    };
    
    const mockDns = {
      lookup: mockLookup
    };
    
    // Inject the mock DNS module
    setDnsModule(mockDns);
  });

  afterAll(() => {
    // Clean up singleton cache service
    destroyCacheService();
  });
  test('hostnameMatchesBlocklist works with exact and wildcard', () => {
    expect(hostnameMatchesBlocklist('api.internal', ['api.internal'])).toBe(true);
    expect(hostnameMatchesBlocklist('svc.prod.internal', ['*.internal'])).toBe(true);
    expect(hostnameMatchesBlocklist('example.org', ['*.internal'])).toBe(false);
  });

  test('rejects non-http protocols', async () => {
    await expect(validateUrlSafety('file:///etc/passwd')).rejects.toThrow(/Only http/);
  });

  test('rejects blocked host', async () => {
    await expect(validateUrlSafety('http://api.internal', { blocklistHosts: ['api.internal'] })).rejects.toThrow(/blocked/);
  });

  test('rejects private IP resolution when not allowed', async () => {
    // The DNS mock should return a private IP for 'private.local'
    await expect(validateUrlSafety('http://private.local', { allowPrivateNetworks: false })).rejects.toThrow(/private IP/);
  }, 10000);

  test('allows private when permitted', async () => {
    // When private networks are allowed, it should not throw even for private IPs
    const u = await validateUrlSafety('http://private.local', { allowPrivateNetworks: true });
    expect(u.href).toMatch('http://private.local/');
  }, 10000);
});
