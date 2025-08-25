import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { HttpProxyAgent } from 'http-proxy-agent';
import { BaseAdapter } from './base.js';

function buildAgent(proxyUrl) {
  if (!proxyUrl) return undefined;
  if (proxyUrl.startsWith('https://') || proxyUrl.startsWith('socks')) {
    return new HttpsProxyAgent(proxyUrl);
  }
  return new HttpProxyAgent(proxyUrl);
}

export class HttpAdapter extends BaseAdapter {
  constructor(config = {}) {
    super(config);
    this.timeoutMs = config.timeoutMs || 20000;
    this.userAgent = config.userAgent;
  }

  async fetch(url, { proxy, headers } = {}) {
    const agent = buildAgent(proxy);
    const res = await axios.get(url, {
      timeout: this.timeoutMs,
      headers: {
        'User-Agent': this.userAgent,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        ...headers,
      },
      responseType: 'text',
      decompress: true,
      validateStatus: () => true,
      httpAgent: agent,
      httpsAgent: agent,
      maxRedirects: 5,
    });
    // Trigger retries on server errors and common anti-bot responses
    if (res.status >= 500) {
      const err = new Error(`HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return { status: res.status, headers: res.headers, body: res.data };
  }
}
