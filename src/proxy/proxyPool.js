import { randomUUID } from 'crypto';
import { logger } from '../logger.js';

export class ProxyPool {
  constructor(list = []) {
    this.items = list.map((p) => ({ id: randomUUID(), url: p, score: 1, failures: 0 }));
    this.index = 0;
  }

  size() { return this.items.length; }

  add(url) {
    if (!url) return;
    if (!this.items.find(i => i.url === url)) {
      this.items.push({ id: randomUUID(), url, score: 1, failures: 0 });
    }
  }

  // simple round-robin preferring higher score
  next() {
    if (this.items.length === 0) return null;
    // sort occasionally by score to push bad proxies down
    this.items.sort((a, b) => b.score - a.score);
    const item = this.items[this.index % this.items.length];
    this.index = (this.index + 1) % this.items.length;
    return item?.url || null;
  }

  reportSuccess(url) {
    const it = this.items.find(i => i.url === url);
    if (it) {
      it.score = Math.min(it.score + 0.1, 5);
      it.failures = 0;
    }
  }

  reportFailure(url) {
    const it = this.items.find(i => i.url === url);
    if (it) {
      it.failures += 1;
      it.score = Math.max(it.score - 0.5, -5);
      if (it.failures >= 5) {
        logger.warn({ proxy: url }, 'Disabling unhealthy proxy');
        // temporary disable by pushing score very low
        it.score = -5;
      }
    }
  }
}
