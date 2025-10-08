class LRUCache {
  constructor(maxItems = 500, ttlMs = 5 * 60 * 1000) {
    this.maxItems = maxItems;
    this.ttlMs = ttlMs;
    this.map = new Map();
  }

  _isExpired(entry) {
    return Date.now() - entry.ts > this.ttlMs;
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (this._isExpired(entry)) {
      this.map.delete(key);
      return null;
    }
    // refresh order
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, ts: Date.now() });
    // evict oldest if over cap
    while (this.map.size > this.maxItems) {
      const oldestKey = this.map.keys().next().value;
      this.map.delete(oldestKey);
    }
  }

  delete(key) {
    this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }
}

const { config } = require('./env');
const cache = new LRUCache(config.TRANSLATION_CACHE_MAX_ITEMS, config.TRANSLATION_CACHE_TTL_MS);

module.exports = cache;
