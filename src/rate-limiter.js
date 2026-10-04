export class MemoryStorageAdapter {
  constructor() {
    this._data = new Map();
  }

  async get(key) {
    return this._data.get(key) || [];
  }

  async set(key, timestamps) {
    this._data.set(key, timestamps);
  }

  async delete(key) {
    this._data.delete(key);
  }

  async clear() {
    this._data.clear();
  }
}

export class SlidingWindowRateLimiter {
  constructor({ windowMs, maxRequests, storageAdapter = new MemoryStorageAdapter() }) {
    if (typeof windowMs !== 'number' || windowMs <= 0) {
      throw new Error('windowMs must be a positive number');
    }
    if (typeof maxRequests !== 'number' || maxRequests <= 0) {
      throw new Error('maxRequests must be a positive number');
    }

    this._windowMs = windowMs;
    this._maxRequests = maxRequests;
    this._storage = storageAdapter;
  }

  async isAllowed(key, tokens = 1) {
    if (typeof tokens !== 'number' || tokens <= 0) {
      throw new Error('tokens must be a positive number');
    }

    const now = Date.now();
    const windowStart = now - this._windowMs;
    const timestamps = await this._storage.get(key);

    // Purge timestamps older than window
    const validTimestamps = timestamps.filter(ts => ts > windowStart);

    return (validTimestamps.length + tokens) <= this._maxRequests;
  }

  async record(key, tokens = 1) {
    if (typeof tokens !== 'number' || tokens <= 0) {
      throw new Error('tokens must be a positive number');
    }

    const now = Date.now();
    const windowStart = now - this._windowMs;
    const timestamps = await this._storage.get(key);

    const validTimestamps = timestamps.filter(ts => ts > windowStart);

    const allowed = (validTimestamps.length + tokens) <= this._maxRequests;

    if (allowed) {
      for (let i = 0; i < tokens; i++) {
        validTimestamps.push(now);
      }
      await this._storage.set(key, validTimestamps);
    } else {
      // still save the purged ones to clean up space
      await this._storage.set(key, validTimestamps);
    }

    const remaining = Math.max(0, this._maxRequests - validTimestamps.length);
    let resetMs = 0;

    if (validTimestamps.length > 0) {
      const oldestValid = validTimestamps[0];
      resetMs = Math.max(0, oldestValid + this._windowMs - now);
    }

    return {
      allowed,
      remaining,
      resetMs
    };
  }

  async reset(key) {
    if (key === undefined) {
      if (typeof this._storage.clear === 'function') {
        await this._storage.clear();
      }
    } else {
      await this._storage.delete(key);
    }
  }
}
