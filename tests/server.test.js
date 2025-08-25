import { jest } from '@jest/globals';
import nock from 'nock';

jest.unstable_mockModule('dns/promises', () => ({
  default: { lookup: jest.fn(async () => [{ address: '93.184.216.34', family: 4 }]) },
  lookup: jest.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));

import request from 'supertest';
import { buildApp } from '../src/server.js';
import { destroyCacheService } from '../src/services/cacheService.js';
import { destroyMonitoringService } from '../src/services/monitoringService.js';

const HTML = '<!doctype html><html><body>OK</body></html>';

describe('Server test', () => {
  let app;
  let config;
  let fetcherService;

  beforeAll(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
  });

  afterAll(async () => {
    nock.enableNetConnect();
    
    // Clean up fetcher service and its adapters
    if (fetcherService) {
      if (fetcherService.adapters['crawlee-browser']) {
        await fetcherService.adapters['crawlee-browser'].destroy();
      }
      if (fetcherService.close) {
        await fetcherService.close();
      }
    }
    
    // Clean up singleton services
    destroyCacheService();
    destroyMonitoringService();
  });

  beforeEach(() => {
    nock.cleanAll();
    config = {
      defaultMode: 'http',
      timeoutMs: 10000,
      userAgent: 'UA',
      headless: true,
      proxies: [],
      maxRetries: 0,
      allowPrivateNetworks: false,
      blocklistHosts: [],
    };
    app = buildApp(config);
    // Store fetcher service reference for cleanup
    fetcherService = app._fetcherService;
  });

  test('fetches content successfully', async () => {
    nock('http://example.org').get('/').reply(200, HTML, { 'Content-Type': 'text/html' });
    const res = await request(app).get('/fetch').query({ url: 'http://example.org' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('OK');
  });

  test('validates input', async () => {
    const res = await request(app).get('/fetch');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Missing url');
  });

  test('health check endpoint works', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBeDefined();
    expect(res.body.uptime).toBeDefined();
  });

  test('metrics endpoint works', async () => {
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.body.requests).toBeDefined();
    expect(res.body.system).toBeDefined();
  });

  test('cache stats endpoint works', async () => {
    const res = await request(app).get('/stats/cache');
    expect(res.status).toBe(200);
    expect(res.body.hits).toBeDefined();
    expect(res.body.misses).toBeDefined();
  });
});
