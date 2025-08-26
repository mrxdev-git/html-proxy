import express from 'express';
import { FetcherService } from './services/fetcherService.js';
import { logger, verbose } from './logger.js';
import { getMonitoringService } from './services/monitoringService.js';
import { getArchitectureIntegration } from './services/ArchitectureIntegration.js';
import EnhancedFetcherService from './services/EnhancedFetcherService.js';

export function buildApp(config) {
  const app = express();
  
  // Determine architecture mode
  const architectureMode = process.env.ARCHITECTURE_MODE || 'legacy';
  let fetcherService;
  let architecture = null;
  
  if (architectureMode === 'enhanced') {
    // Initialize enhanced architecture
    logger.info('Using enhanced architecture');
    architecture = getArchitectureIntegration(config);
    
    // Initialize architecture synchronously for now
    // In production, this should be done asynchronously before starting server
    architecture.initialize().catch(err => {
      logger.error('Failed to initialize enhanced architecture', err);
    });
    
    // Use enhanced fetcher if available, otherwise fallback to legacy
    fetcherService = architecture.enhancedFetcher || new FetcherService(config);
  } else {
    // Use legacy architecture
    logger.info('Using legacy architecture');
    fetcherService = new FetcherService(config);
  }
  
  // Store references for cleanup in tests
  app._fetcherService = fetcherService;
  app._architecture = architecture;
  const monitoring = getMonitoringService();

  app.set('trust proxy', true);
  
  // Parse JSON bodies
  app.use(express.json());

  // Basic health check
  app.get('/healthz', async (_req, res) => {
    try {
      let health;
      if (architecture && architecture.healthCheck) {
        health = await architecture.healthCheck();
      } else {
        health = monitoring.getHealth();
      }
      const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
      res.status(statusCode).json(health);
    } catch (error) {
      res.status(503).json({ status: 'error', error: error.message });
    }
  });
  
  // Detailed metrics endpoint
  app.get('/metrics', (_req, res) => {
    try {
      let metrics;
      if (architecture && architecture.metricsCollector) {
        metrics = architecture.metricsCollector.exportMetrics();
      } else {
        metrics = monitoring.getMetrics();
      }
      res.json(metrics);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Adapter statistics
  app.get('/stats/adapters', (_req, res) => {
    try {
      let stats;
      if (architecture && architecture.getStatistics) {
        stats = architecture.getStatistics();
      } else {
        stats = monitoring.getAdapterStats();
      }
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
  
  // Cache statistics
  app.get('/stats/cache', (_req, res) => {
    const cacheStats = fetcherService.cache.getStats();
    res.json(cacheStats);
  });
  
  // Main fetch endpoint
  app.post('/fetch', async (req, res) => {
    const startTime = Date.now();
    const { url, mode, headers, timeout, retries } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }
    
    const requestedMode = mode || config.defaultMode || 'adaptive';
    
    if (verbose) {
      logger.info({ url, mode: requestedMode }, 'Fetch request received');
    }
    
    try {
      const result = await fetcherService.fetch(url, {
        mode: requestedMode,
        headers,
        timeout,
        retries
      });
      
      const responseTime = Date.now() - startTime;
      monitoring.recordRequest(url, requestedMode, true, responseTime);
      
      res.json({
        success: true,
        data: {
          ...result,
          responseTime
        }
      });
    } catch (e) {
      const responseTime = Date.now() - startTime;
      monitoring.recordRequest(url, requestedMode, false, responseTime);
      monitoring.recordError(e, { url, mode: requestedMode });
      
      logger.error({ err: e.message }, 'Fetch failed');
      const status = /SSRF|blocked|Invalid URL|protocol/.test(String(e.message)) ? 400 : 502;
      return res.status(status).json({ error: e.message });
    }
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


  // Enhanced architecture monitoring endpoints
  if (architecture) {
    // Configuration endpoint
    app.get('/config', (req, res) => {
      const config = {
        architectureMode,
        features: architecture.config.features || {},
        pools: architecture.config.pools || {}
      };
      res.json(config);
    });
    
    // Active requests endpoint
    app.get('/requests/active', (req, res) => {
      try {
        const activeRequests = architecture.enhancedFetcher
          ? architecture.enhancedFetcher.getActiveRequests ? architecture.enhancedFetcher.getActiveRequests() : []
          : [];
        
        res.json({
          count: activeRequests.length,
          requests: activeRequests
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });
  }
  
  // Graceful shutdown handler
  app.shutdown = async () => {
    logger.info('Shutting down server');
    
    // Shutdown architecture if using enhanced mode
    if (architecture && architecture.shutdown) {
      await architecture.shutdown();
    }
    
    // Close legacy fetcher service
    if (fetcherService && fetcherService.close) {
      await fetcherService.close();
    }
    
    logger.info('Server shutdown complete');
  };
  
  return app;
}
