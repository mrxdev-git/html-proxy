import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { BaseAdapter } from './base.js';
import { logger } from '../logger.js';

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
      const resp = await page.goto(url, { waitUntil: ['domcontentloaded', 'networkidle0'], timeout: this.timeoutMs });
      const status = resp?.status() ?? 0;
      const content = await page.content();
      await browser.close();
      return { status, headers: {}, body: content };
    } catch (e) {
      logger.debug({ err: e.message }, 'Browser fetch failed');
      await browser.close();
      throw e;
    }
  }
}
