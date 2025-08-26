import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { BaseAdapter } from './base.js';
import { logger } from '../logger.js';
import { createPageLoader } from '../utils/pageLoader.js';

puppeteer.use(StealthPlugin());

function parseProxyAuth(proxyUrl) {
  try {
    const u = new URL(proxyUrl);
    if (u.username || u.password) {
      return { username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
    }
  } catch { /* ignore */ }
  return null;
}

export class BrowserAdapter extends BaseAdapter {
  constructor(config = {}) {
    super(config);
    this.timeoutMs = config.timeoutMs || 20000;
    this.userAgent = config.userAgent;
    this.headless = config.headless !== false;
    this.loadingStrategy = config.loadingStrategy || 'balanced';
    this.customWaitConditions = config.customWaitConditions || [];
  }

  async fetch(url, { proxy, headers } = {}) {
    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-features=IsolateOrigins,site-per-process',
    ];
    if (proxy) launchArgs.push(`--proxy-server=${proxy}`);

    const browser = await puppeteer.launch({ headless: this.headless, args: launchArgs });
    const page = await browser.newPage();

    // apply user agent and common headers
    if (this.userAgent) await page.setUserAgent(this.userAgent);
    await page.setExtraHTTPHeaders({
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      ...headers,
    });
    await page.setViewport({ width: 1366, height: 768 });

    // proxy auth if present
    const auth = proxy ? parseProxyAuth(proxy) : null;
    if (auth) {
      await page.authenticate(auth);
    }

    try {
      // Create page loader with configuration
      const pageLoader = createPageLoader(this.loadingStrategy);
      pageLoader.options.maxWaitTime = this.timeoutMs;
      pageLoader.options.customWaitConditions = this.customWaitConditions;
      
      // Use advanced page loading detection
      const loadResult = await pageLoader.waitForPageLoad(page, url);
      
      // Get response status if available
      let status = 200;
      try {
        const response = await page.evaluate(() => {
          const perf = performance.getEntriesByType('navigation')[0];
          return perf ? perf.responseStatus : null;
        });
        status = response || 200;
      } catch (e) {
        // Fallback to 200 if we got content
        status = loadResult.content && loadResult.content.length > 0 ? 200 : 0;
      }
      
      await browser.close();
      
      // Log loading metrics
      logger.info({ 
        url,
        loadingMetrics: loadResult.metrics,
        success: loadResult.success,
        fallback: loadResult.fallback,
        contentLength: loadResult.content.length
      }, 'Browser fetch completed');
      
      return { 
        status, 
        headers: {}, 
        body: loadResult.content,
        metrics: loadResult.metrics,
        fallback: loadResult.fallback
      };
    } catch (e) {
      logger.debug({ err: e.message }, 'Browser fetch failed');
      
      // Try to get any available content before closing
      let fallbackContent = null;
      try {
        fallbackContent = await page.content();
      } catch (contentError) {
        logger.debug('Could not retrieve fallback content');
      }
      
      await browser.close();
      
      if (fallbackContent && fallbackContent.length > 100) {
        logger.info({ url, contentLength: fallbackContent.length }, 'Returning partial content after error');
        return {
          status: 0,
          headers: {},
          body: fallbackContent,
          error: e.message,
          partial: true
        };
      }
      
      throw e;
    }
  }
}
