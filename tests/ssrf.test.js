import { jest, describe, test, expect, afterAll, beforeAll } from '@jest/globals';
import { validateUrlSafety, hostnameMatchesBlocklist, setDnsModule } from '../src/utils/ssrf.js';
import { FetcherService } from '../src/services/fetcherService.js';
import { destroyCacheService } from '../src/services/cacheService.js';

describe('SSRF protection', () => {
  let mockDns;
  
  beforeAll(() => {
    // Create mock DNS module
    mockDns = {
      lookup: jest.fn(async (host, options) => {
        if (host === 'private.local') return [{ address: '192.168.1.10', family: 4 }];
        if (host === 'loop.local') return [{ address: '127.0.0.1', family: 4 }];
        if (host === 'api.internal') return [{ address: '93.184.216.34', family: 4 }];
        if (host === 'example.org') return [{ address: '93.184.216.34', family: 4 }];
        return [{ address: '93.184.216.34', family: 4 }]; // default
      })
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
    expect(mockDns.lookup).toHaveBeenCalledWith('private.local', expect.any(Object));
  }, 10000);

  test('allows private when permitted', async () => {
    // When private networks are allowed, it should not throw even for private IPs
    const u = await validateUrlSafety('http://private.local', { allowPrivateNetworks: true });
    expect(u.href).toMatch('http://private.local/');
    expect(mockDns.lookup).toHaveBeenCalledWith('private.local', expect.any(Object));
  }, 10000);
});
