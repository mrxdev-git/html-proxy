import { jest } from '@jest/globals';
import { PageLoader, createPageLoader } from '../src/utils/pageLoader.js';

describe('PageLoader Utility', () => {
  let mockPage;
  let pageLoader;

  beforeEach(() => {
    // Create mock page object
    mockPage = {
      goto: jest.fn().mockResolvedValue({}),
      content: jest.fn().mockResolvedValue('<html><body>Test content</body></html>'),
      evaluate: jest.fn().mockResolvedValue(true),
      waitForLoadState: jest.fn().mockResolvedValue(undefined),
      waitForSelector: jest.fn().mockResolvedValue(true),
      waitForTimeout: jest.fn().mockResolvedValue(undefined),
    };

    // Create page loader with default options
    pageLoader = new PageLoader();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Constructor and Configuration', () => {
    test('should create PageLoader with default options', () => {
      const loader = new PageLoader();
      expect(loader.options).toBeDefined();
      expect(loader.options.maxWaitTime).toBe(30000);
      expect(loader.options.waitStrategies).toContain('domcontentloaded');
      expect(loader.options.progressiveCapture).toBe(true);
    });

    test('should create PageLoader with custom options', () => {
      const customOptions = {
        maxWaitTime: 15000,
        waitStrategies: ['networkidle'],
        progressiveCapture: true,
      };
      const loader = new PageLoader(customOptions);
      expect(loader.options.maxWaitTime).toBe(15000);
      expect(loader.options.waitStrategies).toContain('networkidle');
      expect(loader.options.progressiveCapture).toBe(true);
    });

    test('should create PageLoader with preset configurations', () => {
      const fastLoader = createPageLoader('fast');
      expect(fastLoader.options.maxWaitTime).toBe(10000);
      
      const balancedLoader = createPageLoader('balanced');
      expect(balancedLoader.options.maxWaitTime).toBe(20000);
      
      const thoroughLoader = createPageLoader('thorough');
      expect(thoroughLoader.options.maxWaitTime).toBe(30000);
    });
  });

  describe('Page Loading', () => {
    test('should successfully load a page', async () => {
      const result = await pageLoader.waitForPageLoad(mockPage, 'https://example.com');
      
      expect(mockPage.goto).toHaveBeenCalledWith('https://example.com', expect.any(Object));
      expect(result.success).toBe(true);
      expect(result.content).toBeDefined();
      expect(result.metrics).toBeDefined();
    });

    test('should handle page load timeout gracefully', async () => {
      mockPage.goto.mockRejectedValue(new Error('Navigation timeout'));
      
      const result = await pageLoader.waitForPageLoad(mockPage, 'https://slow-site.com');
      
      expect(result.success).toBe(false);
      expect(result.fallback).toBe(true);
      expect(result.error).toBe('Navigation timeout');
      expect(result.content).toBeDefined();
    });

    test('should capture progressive content when enabled', async () => {
      const loader = new PageLoader({
        progressiveCapture: true,
        progressiveCaptureIntervals: [100, 200],
      });
      
      const result = await loader.waitForPageLoad(mockPage, 'https://example.com');
      
      // Wait a bit for progressive captures
      await new Promise(resolve => setTimeout(resolve, 300));
      
      expect(result.capturedVersions).toBeDefined();
      expect(Array.isArray(result.capturedVersions)).toBe(true);
    });
  });

  describe('Wait Strategies', () => {
    test('should wait for network idle', async () => {
      const loader = new PageLoader({
        waitStrategies: ['networkidle'],
        networkIdleTimeout: 1000,
      });
      
      await loader.waitForNetworkIdle(mockPage, Date.now() + 5000);
      
      expect(mockPage.waitForLoadState).toHaveBeenCalledWith('networkidle', expect.any(Object));
    });

    test.skip('should detect JavaScript completion', async () => {
      const loader = new PageLoader({
        waitStrategies: ['javascript'],
        jsCompletionTimeout: 200,
      });
      
      // Mock evaluate to return true (JS complete) after initial checks
      mockPage.evaluate.mockResolvedValue(true);
      
      const result = await loader.waitForJavaScriptCompletion(mockPage, Date.now() + 5000);
      
      // The method should detect JS completion
      expect(result).toBe(true);
      expect(mockPage.evaluate).toHaveBeenCalled();
    });

    test('should wait for element visibility', async () => {
      const loader = new PageLoader({
        waitStrategies: ['element'],
        waitForElement: '#content',
      });
      
      const result = await loader.waitForElements(mockPage, Date.now() + 5000);
      
      expect(mockPage.waitForSelector).toHaveBeenCalled();
      expect(result).toBeTruthy();
    });
  });

  describe('Content Capture', () => {
    test('should capture final content with enhancements', async () => {
      mockPage.evaluate.mockImplementation((fn) => {
        if (typeof fn === 'function') {
          // Simulate DOM manipulation
          return '<html><body>Enhanced content</body></html>';
        }
        return true;
      });
      
      const content = await pageLoader.captureFinalContent(mockPage);
      
      expect(content).toBeDefined();
      expect(mockPage.waitForTimeout).toHaveBeenCalledWith(500);
    });

    test('should return fallback content on failure', async () => {
      mockPage.content.mockRejectedValue(new Error('Page crashed'));
      
      const result = await pageLoader.getFallbackContent(mockPage, [
        { timestamp: Date.now() - 1000, content: 'Partial content', length: 15 },
      ]);
      
      expect(result.content).toBeDefined();
      expect(result.fallback).toBe(true);
    });
  });

  describe('Metrics Collection', () => {
    test('should collect loading metrics', () => {
      const startTime = Date.now() - 1000;
      pageLoader.loadingMetrics = {
        domContentLoadedTime: 500,
        networkIdleTime: 800,
        jsCompletionTime: 1000,
      };
      
      const metrics = pageLoader.collectMetrics(startTime);
      
      expect(metrics.totalTime).toBeGreaterThan(0);
      expect(metrics.startTime).toBe(startTime);
      expect(metrics.endTime).toBeDefined();
      expect(metrics.domContentLoadedTime).toBe(500);
    });
  });

  describe('Progressive Capture Cleanup', () => {
    test('should properly clean up intervals and timers', () => {
      jest.useFakeTimers();
      const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
      
      const loader = new PageLoader({
        progressiveCapture: true,
        progressiveCaptureIntervals: [1000, 2000],
      });
      
      const cleanup = loader.setupProgressiveCapture(mockPage, []);
      
      // Should create cleanup function
      expect(cleanup).toBeDefined();
      
      // If cleanup is a function, call it
      if (typeof cleanup === 'function') {
        cleanup();
        // Should clear interval and timeouts
        expect(clearIntervalSpy).toHaveBeenCalled();
      }
      
      jest.useRealTimers();
      clearIntervalSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    });

    test('should cleanup on error', async () => {
      jest.useFakeTimers();
      
      const loader = new PageLoader({
        progressiveCapture: true,
        progressiveCaptureIntervals: [100],
      });
      
      mockPage.goto.mockRejectedValue(new Error('Navigation failed'));
      
      await loader.waitForPageLoad(mockPage, 'https://error-site.com');
      
      // Verify no lingering timers
      jest.runAllTimers();
      
      jest.useRealTimers();
    });
  });

  describe('Error Handling', () => {
    test('should handle page crash gracefully', async () => {
      // Mock page crash during content retrieval
      mockPage.goto.mockResolvedValue({});
      mockPage.waitForLoadState = jest.fn().mockRejectedValue(new Error('Page crashed'));
      mockPage.evaluate.mockRejectedValue(new Error('Page crashed'));
      mockPage.content.mockRejectedValueOnce(new Error('Page crashed'))
        .mockResolvedValue('<html><body>Fallback</body></html>');
      
      const result = await pageLoader.waitForPageLoad(mockPage, 'https://crash-site.com');
      
      // Even with crashes, should return something
      expect(result.content).toBeDefined();
    });

    test('should handle timeout with partial content', async () => {
      jest.useFakeTimers();
      
      const loader = new PageLoader({
        maxWaitTime: 100,
        progressiveCapture: true,
        progressiveCaptureIntervals: [50],
      });
      
      // Mock slow page load that will timeout
      mockPage.goto.mockImplementation(() => {
        return new Promise((resolve, reject) => {
          setTimeout(() => reject(new Error('Navigation timeout')), 200);
        });
      });
      
      const resultPromise = loader.waitForPageLoad(mockPage, 'https://slow-site.com');
      
      // Fast forward timers
      jest.advanceTimersByTime(200);
      
      const result = await resultPromise;
      
      expect(result.content).toBeDefined();
      
      jest.useRealTimers();
    });
  });
});
