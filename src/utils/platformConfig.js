import os from 'os';
import { logger } from '../logger.js';

/**
 * Platform-specific configuration for browser launch options
 */
class PlatformConfig {
  constructor() {
    this.platform = os.platform();
    this.isUbuntu = this.detectUbuntu();
    this.isDocker = this.detectDocker();
    this.isLowMemory = this.detectLowMemory();
    
    logger.info({
      platform: this.platform,
      isUbuntu: this.isUbuntu,
      isDocker: this.isDocker,
      isLowMemory: this.isLowMemory,
      totalMemory: Math.round(os.totalmem() / 1024 / 1024 / 1024) + 'GB',
      freeMemory: Math.round(os.freemem() / 1024 / 1024 / 1024) + 'GB',
    }, 'Platform configuration detected');
  }

  detectUbuntu() {
    if (this.platform !== 'linux') return false;
    
    try {
      const fs = require('fs');
      const osRelease = fs.readFileSync('/etc/os-release', 'utf8');
      return osRelease.toLowerCase().includes('ubuntu');
    } catch (error) {
      return false;
    }
  }

  detectDocker() {
    try {
      const fs = require('fs');
      return fs.existsSync('/.dockerenv') || fs.existsSync('/run/.containerenv');
    } catch (error) {
      return false;
    }
  }

  detectLowMemory() {
    const totalMemory = os.totalmem();
    // Consider low memory if less than 4GB
    return totalMemory < 4 * 1024 * 1024 * 1024;
  }

  /**
   * Get browser launch options based on platform
   */
  getBrowserLaunchOptions() {
    const baseOptions = {
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
        '--disable-web-security',
        '--disable-features=BlockInsecurePrivateNetworkRequests',
      ],
    };

    // Add platform-specific options
    if (this.platform === 'linux' || this.isUbuntu || this.isDocker) {
      baseOptions.args.push(
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-http2',  // Disable HTTP/2 to avoid protocol errors
        '--disable-quic',   // Disable QUIC protocol
        '--single-process', // Run in single process mode
        '--no-zygote',      // Disable zygote process
        '--disable-accelerated-2d-canvas',
        '--disable-gpu-sandbox',
        '--disable-software-rasterizer'
      );
    }

    // Add memory optimization options for low memory systems
    if (this.isLowMemory) {
      baseOptions.args.push(
        '--memory-pressure-off',
        '--js-flags=--max-old-space-size=2048',  // Limit V8 memory
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--aggressive-cache-discard',
        '--aggressive-tab-discard'
      );
    }

    // Docker-specific options
    if (this.isDocker) {
      baseOptions.args.push(
        '--disable-features=VizDisplayCompositor',
        '--disable-breakpad',
        '--disable-canvas-aa',
        '--disable-2d-canvas-clip-aa',
        '--disable-gl-drawing-for-tests'
      );
    }

    return baseOptions;
  }

  /**
   * Get crawler configuration based on platform
   */
  getCrawlerConfig() {
    const config = {
      maxRequestRetries: 2,
      requestHandlerTimeoutSecs: 30,
      navigationTimeoutSecs: 60,
      browserPoolOptions: {
        useFingerprints: false,
        maxOpenPagesPerBrowser: 1,
        retireBrowserAfterPageCount: 10,
      },
    };

    // Adjust for low memory systems
    if (this.isLowMemory) {
      config.browserPoolOptions.retireBrowserAfterPageCount = 5;
      config.maxConcurrency = 1;
      config.autoscaledPoolOptions = {
        maxConcurrency: 1,
        desiredConcurrency: 1,
      };
    }

    // Add launch context with platform-specific options
    config.launchContext = {
      launchOptions: this.getBrowserLaunchOptions(),
    };

    return config;
  }

  /**
   * Get HTTP client options to handle protocol issues
   */
  getHttpOptions() {
    return {
      // Force HTTP/1.1 for problematic sites
      httpVersion: '1.1',
      // Increase timeouts
      timeout: 60000,
      // Retry configuration
      retry: {
        limit: 3,
        methods: ['GET', 'POST'],
        statusCodes: [408, 413, 429, 500, 502, 503, 504, 521, 522, 524],
        errorCodes: ['ECONNRESET', 'ENOTFOUND', 'ESOCKETTIMEDOUT', 'ETIMEDOUT', 'ECONNREFUSED', 'EHOSTUNREACH', 'EPIPE', 'EAI_AGAIN'],
      },
    };
  }
}

// Export singleton instance
export const platformConfig = new PlatformConfig();
