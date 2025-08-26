import express from 'express';
import { FetcherService } from './services/fetcherService.js';
import { logger, verbose } from './logger.js';
import { getMonitoringService } from './services/monitoringService.js';

export function buildApp(config) {
  const app = express();
  const fetcherService = new FetcherService(config);
  
  // Store fetcher service reference for cleanup in tests
  app._fetcherService = fetcherService;
  const monitoring = getMonitoringService();

  app.set('trust proxy', true);

  // Basic health check
  app.get('/healthz', (_req, res) => {
    const health = monitoring.getHealth();
    const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
    res.status(statusCode).json(health);
  });
  
  // Detailed metrics endpoint
  app.get('/metrics', (_req, res) => {
    const metrics = monitoring.getMetrics();
    res.json(metrics);
  });
  
  // Adapter statistics
  app.get('/stats/adapters', (_req, res) => {
    const stats = monitoring.getAdapterStats();
    res.json(stats);
  });
  
  // Cache statistics
  app.get('/stats/cache', (_req, res) => {
    const cacheStats = fetcherService.cache.getStats();
    res.json(cacheStats);
  });
  
  // Crawler pool statistics (if using crawlee-browser mode)
  app.get('/stats/pool', (_req, res) => {
    if (fetcherService.adapters['crawlee-browser'] && fetcherService.adapters['crawlee-browser'].getStats) {
      const poolStats = fetcherService.adapters['crawlee-browser'].getStats();
      res.json(poolStats);
    } else {
      res.json({ message: 'Pool statistics not available' });
    }
  });

  app.get('/fetch', async (req, res) => {
    const { url, mode } = req.query;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'Missing url query parameter' });
    }

    const startTime = Date.now();
    const requestedMode = mode && typeof mode === 'string' ? mode : config.defaultMode;
    
    try {
      const result = await fetcherService.fetch(url, {
        mode: requestedMode,
      });
      
      // Record successful request
      const responseTime = Date.now() - startTime;
      monitoring.recordRequest(url, requestedMode, true, responseTime, result.cached || false);
      
      // Always return as text/html to the caller
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (result.status) res.setHeader('X-Source-Status', String(result.status));
      if (result.cached) res.setHeader('X-Cache-Hit', 'true');
      res.setHeader('X-Response-Time', String(responseTime));
      
      return res.status(200).send(result.body || '');
    } catch (e) {
      // Record failed request
      const responseTime = Date.now() - startTime;
      monitoring.recordRequest(url, requestedMode, false, responseTime);
      monitoring.recordError(e, { url, mode: requestedMode });
      
      logger.error({ err: e.message }, 'Fetch failed');
      const status = /SSRF|blocked|Invalid URL|protocol/.test(String(e.message)) ? 400 : 502;
      return res.status(status).json({ error: e.message });
    }
  });

  return app;
}
