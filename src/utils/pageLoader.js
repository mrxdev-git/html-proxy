import { logger } from '../logger.js';

/**
 * Advanced page loading utility with multiple strategies for detecting page readiness
 * Provides progressive content capture and fallback mechanisms
 */

export class PageLoader {
  constructor(options = {}) {
    this.options = {
      maxWaitTime: options.maxWaitTime || 30000, // Maximum total wait time
      progressiveCapture: options.progressiveCapture !== false, // Capture content progressively
      waitStrategies: options.waitStrategies || ['domcontentloaded', 'networkidle', 'custom'],
      customWaitConditions: options.customWaitConditions || [],
      jsCompletionTimeout: options.jsCompletionTimeout || 5000,
      networkIdleTimeout: options.networkIdleTimeout || 2000,
      captureIntervals: options.captureIntervals || [1000, 3000, 5000, 10000], // Capture content at these intervals
    };
    
    this.capturedContent = [];
    this.loadingMetrics = {
      startTime: null,
      domContentLoadedTime: null,
      networkIdleTime: null,
      jsCompletionTime: null,
      finalCaptureTime: null,
      strategy: null,
    };
  }

  /**
   * Main method to wait for page load with multiple strategies
   */
  async waitForPageLoad(page, url) {
    const startTime = Date.now();
    const capturedVersions = [];
    let progressiveCleanup = null;
    
    try {
      // Navigate to URL
      await page.goto(url, {
        waitUntil: this.options.waitUntil,
        timeout: this.options.maxWaitTime,
      });
      
      // Set up progressive capture if enabled
      if (this.options.progressiveCapture) {
        progressiveCleanup = this.setupProgressiveCapture(page, capturedVersions);
      }
      
      // Set up parallel wait strategies
      const strategyPromises = this.setupWaitStrategies(page, Date.now() + this.options.maxWaitTime);
      
      // Wait for at least one strategy to complete
      const results = await Promise.race([
        Promise.race(strategyPromises),
        this.waitForTimeout(this.options.maxWaitTime), // Absolute timeout fallback
      ]);
      
      // Capture final content
      const finalContent = await this.captureFinalContent(page);
      
      // Clear interval if still running
      if (progressiveCleanup) {
        progressiveCleanup();
      }
      
      return {
        content: finalContent,
        metrics: this.collectMetrics(startTime),
        capturedVersions,
        success: true,
      };
      
    } catch (error) {
      logger.warn({ url, error: error.message }, 'Page load failed');
      
      // Return best available content
      const fallbackContent = await this.getFallbackContent(page, capturedVersions);
      return {
        success: false,
        content: fallbackContent,
        error: error.message,
        metrics: this.collectMetrics(startTime),
        fallback: true,
        capturedVersions,
      };
    } finally {
      // Clean up progressive capture
      if (progressiveCleanup) {
        progressiveCleanup();
      }
    }
  }

  /**
   * Navigate to page with initial strategy
   */
  async navigateWithStrategy(page, url) {
    try {
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded', // Start with fastest condition
        timeout: Math.min(10000, this.options.maxWaitTime),
      });
      
      this.loadingMetrics.domContentLoadedTime = Date.now() - this.loadingMetrics.startTime;
      logger.debug({ url, time: this.loadingMetrics.domContentLoadedTime }, 'DOM content loaded');
      
      return response;
    } catch (error) {
      logger.debug({ url, error: error.message }, 'Initial navigation failed');
      throw error;
    }
  }

  /**
   * Set up multiple wait strategies that run in parallel
   */
  setupWaitStrategies(page, deadline) {
    const strategies = [];
    
    // Network idle strategy
    if (this.options.waitStrategies.includes('networkidle')) {
      strategies.push(this.waitForNetworkIdle(page, deadline));
    }
    
    // JavaScript completion strategy
    if (this.options.waitStrategies.includes('javascript')) {
      strategies.push(this.waitForJavaScriptCompletion(page, deadline));
    }
    
    // Custom wait conditions
    if (this.options.waitStrategies.includes('custom') && this.options.customWaitConditions.length > 0) {
      strategies.push(this.waitForCustomConditions(page, deadline));
    }
    
    // Specific element visibility
    if (this.options.waitStrategies.includes('element')) {
      strategies.push(this.waitForElements(page, deadline));
    }
    
    return strategies;
  }

  /**
   * Wait for network to be idle
   */
  async waitForNetworkIdle(page, deadline) {
    const timeout = Math.min(this.options.networkIdleTimeout, deadline - Date.now());
    
    if (timeout <= 0) return null;
    
    try {
      await page.waitForLoadState('networkidle', { timeout });
      this.loadingMetrics.networkIdleTime = Date.now() - this.loadingMetrics.startTime;
      this.loadingMetrics.strategy = 'networkidle';
      logger.debug({ time: this.loadingMetrics.networkIdleTime }, 'Network idle detected');
      return true;
    } catch (error) {
      logger.debug('Network idle timeout');
      return null;
    }
  }

  /**
   * Wait for JavaScript execution to complete
   */
  async waitForJavaScriptCompletion(page, deadline) {
    const timeout = Math.min(this.options.jsCompletionTimeout, deadline - Date.now());
    
    if (timeout <= 0) return null;
    
    try {
      // Check for common JS frameworks completion
      await page.waitForFunction(
        () => {
          // Check if common frameworks are done loading
          if (typeof window !== 'undefined') {
            // React
            if (window.React && window.React.version) {
              const reactRoot = document.querySelector('#root, #app, [data-reactroot]');
              if (reactRoot && reactRoot.children.length > 0) return true;
            }
            
            // Vue
            if (window.Vue || window.app?.__vue__) {
              return true;
            }
            
            // Angular
            if (window.ng || document.querySelector('[ng-version]')) {
              return !document.querySelector('.ng-loading, .ng-pending');
            }
            
            // jQuery
            if (window.jQuery) {
              return window.jQuery.active === 0;
            }
            
            // Check for common loading indicators
            const loadingIndicators = document.querySelectorAll(
              '.loading, .spinner, .loader, [data-loading="true"], .skeleton'
            );
            
            if (loadingIndicators.length === 0) {
              // Check if body has substantial content
              const bodyText = document.body?.innerText || '';
              return bodyText.length > 100;
            }
          }
          return false;
        },
        { timeout }
      );
      
      this.loadingMetrics.jsCompletionTime = Date.now() - this.loadingMetrics.startTime;
      this.loadingMetrics.strategy = 'javascript';
      logger.debug({ time: this.loadingMetrics.jsCompletionTime }, 'JavaScript execution completed');
      return true;
    } catch (error) {
      logger.debug('JavaScript completion timeout');
      return null;
    }
  }

  /**
   * Wait for custom conditions
   */
  async waitForCustomConditions(page, deadline) {
    const timeout = Math.min(10000, deadline - Date.now());
    
    if (timeout <= 0 || this.options.customWaitConditions.length === 0) return null;
    
    try {
      for (const condition of this.options.customWaitConditions) {
        if (typeof condition === 'string') {
          // Wait for selector
          await page.waitForSelector(condition, { timeout: timeout / this.options.customWaitConditions.length });
        } else if (typeof condition === 'function') {
          // Wait for function
          await page.waitForFunction(condition, { timeout: timeout / this.options.customWaitConditions.length });
        }
      }
      
      this.loadingMetrics.strategy = 'custom';
      logger.debug('Custom conditions met');
      return true;
    } catch (error) {
      logger.debug('Custom conditions timeout');
      return null;
    }
  }

  /**
   * Wait for important elements to be visible
   */
  async waitForElements(page, deadline) {
    const timeout = Math.min(5000, deadline - Date.now());
    
    if (timeout <= 0) return null;
    
    const importantSelectors = [
      'main', 'article', '[role="main"]', '#content', '.content',
      'body > div', 'body > section'
    ];
    
    try {
      await page.waitForSelector(importantSelectors.join(', '), { 
        timeout,
        state: 'visible' 
      });
      
      this.loadingMetrics.strategy = 'element';
      logger.debug('Important elements visible');
      return true;
    } catch (error) {
      logger.debug('Element visibility timeout');
      return null;
    }
  }

  /**
   * Set up progressive content capture
   */
  setupProgressiveCapture(page, capturedVersions) {
    const intervals = this.options.progressiveCaptureIntervals;
    if (!intervals || intervals.length === 0) return null;
    
    const timers = [];
    
    const captureContent = async () => {
      try {
        const content = await page.content();
        capturedVersions.push({
          timestamp: Date.now(),
          content,
          length: content.length,
        });
        logger.debug(`Progressive capture: ${content.length} bytes`);
      } catch (error) {
        logger.debug('Progressive capture failed:', error.message);
      }
    };
    
    // Schedule captures at specified intervals
    intervals.forEach(interval => {
      const timer = setTimeout(() => captureContent(), interval);
      timers.push(timer);
    });
    
    // Also set up interval for continuous capture
    const intervalId = setInterval(captureContent, 5000);
    
    // Return cleanup function
    return () => {
      clearInterval(intervalId);
      timers.forEach(timer => clearTimeout(timer));
    };
  }

  /**
   * Capture final content with enhanced extraction
   */
  async captureFinalContent(page) {
    try {
      // Wait a bit for any final renders
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Get full HTML content
      const htmlContent = await page.content();
      
      // Try to get rendered text content for comparison
      const textContent = await page.evaluate(() => document.body?.innerText || '');
      
      // Get page metadata
      const metadata = await page.evaluate(() => ({
        title: document.title,
        description: document.querySelector('meta[name="description"]')?.content,
        canonical: document.querySelector('link[rel="canonical"]')?.href,
        contentLength: document.body?.innerHTML?.length || 0,
        hasImages: document.querySelectorAll('img').length,
        hasScripts: document.querySelectorAll('script').length,
        hasStyles: document.querySelectorAll('style, link[rel="stylesheet"]').length,
      }));
      
      this.loadingMetrics.finalCaptureTime = Date.now() - this.loadingMetrics.startTime;
      
      logger.info({ 
        finalCaptureTime: this.loadingMetrics.finalCaptureTime,
        contentLength: htmlContent.length,
        metadata 
      }, 'Final content captured');
      
      return htmlContent;
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to capture final content');
      // Return whatever we can get
      return await page.content().catch(() => '<html><body>Failed to capture content</body></html>');
    }
  }

  /**
   * Get fallback content when strategies fail
   */
  async getFallbackContent(page) {
    logger.info('Using fallback content strategy');
    
    // Try to get current page content
    let currentContent = null;
    try {
      currentContent = await page.content();
    } catch (error) {
      logger.debug('Failed to get current page content');
    }
    
    // Find the best captured content (usually the latest with substantial content)
    const bestCapture = this.capturedContent
      .filter(c => c.contentLength > 1000) // At least 1KB of content
      .sort((a, b) => b.contentLength - a.contentLength)[0]; // Largest content
    
    const fallbackContent = currentContent || bestCapture?.content || '<html><body>Page load timeout</body></html>';
    
    return {
      content: fallbackContent,
      metrics: this.loadingMetrics,
      capturedVersions: this.capturedContent,
      success: false,
      fallback: true,
    };
  }

  /**
   * Collect loading metrics
   */
  collectMetrics(startTime) {
    const endTime = Date.now();
    return {
      ...this.loadingMetrics,
      totalTime: endTime - startTime,
      startTime,
      endTime,
      strategy: this.options.loadingStrategy || 'custom',
    };
  }

  /**
   * Simple timeout helper
   */
  async waitForTimeout(ms) {
    return new Promise(resolve => setTimeout(() => resolve({ timeout: true }), ms));
  }
}

/**
 * Factory function for creating page loader with presets
 */
export function createPageLoader(preset = 'balanced') {
  const presets = {
    fast: {
      maxWaitTime: 10000,
      waitStrategies: ['domcontentloaded'],
      progressiveCapture: false,
    },
    balanced: {
      maxWaitTime: 20000,
      waitStrategies: ['domcontentloaded', 'networkidle'],
      progressiveCapture: true,
      captureIntervals: [2000, 5000, 10000],
    },
    thorough: {
      maxWaitTime: 30000,
      waitStrategies: ['domcontentloaded', 'networkidle', 'javascript', 'element'],
      progressiveCapture: true,
      captureIntervals: [1000, 3000, 5000, 10000, 15000],
      jsCompletionTimeout: 10000,
    },
    custom: {}, // Use all defaults
  };
  
  return new PageLoader(presets[preset] || presets.balanced);
}
