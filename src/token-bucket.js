export class TokenBucket {
  constructor({ capacity, refillRatePerSec, initialTokens }) {
    if (typeof capacity !== 'number' || capacity <= 0) {
      throw new Error('capacity must be a positive number');
    }
    if (typeof refillRatePerSec !== 'number' || refillRatePerSec < 0) {
      throw new Error('refillRatePerSec must be a non-negative number');
    }

    this._capacity = capacity;
    this._refillRatePerSec = refillRatePerSec;

    if (initialTokens !== undefined) {
      if (typeof initialTokens !== 'number' || initialTokens < 0) {
        throw new Error('initialTokens must be a non-negative number');
      }
      this._tokens = Math.min(initialTokens, capacity);
    } else {
      this._tokens = capacity;
    }

    this._lastRefillTime = Date.now();
  }

  _refill() {
    const now = Date.now();
    if (this._tokens < this._capacity && this._refillRatePerSec > 0) {
      const elapsedMs = now - this._lastRefillTime;
      const tokensToAdd = (elapsedMs / 1000) * this._refillRatePerSec;
      this._tokens = Math.min(this._capacity, this._tokens + tokensToAdd);
    }
    this._lastRefillTime = now;
  }

  get tokens() {
    this._refill();
    return this._tokens;
  }

  tryConsume(tokens = 1) {
    if (typeof tokens !== 'number' || tokens <= 0) {
      throw new Error('tokens must be a positive number');
    }

    this._refill();

    if (this._tokens >= tokens) {
      this._tokens -= tokens;
      return true;
    }

    return false;
  }

  async consume(tokens = 1) {
    if (typeof tokens !== 'number' || tokens <= 0) {
      throw new Error('tokens must be a positive number');
    }

    if (tokens > this._capacity) {
      throw new Error('tokens exceed capacity');
    }

    while (true) {
      if (this.tryConsume(tokens)) {
        return true;
      }

      if (this._refillRatePerSec === 0) {
        throw new Error('Cannot replenish tokens with zero refill rate');
      }

      const tokensNeeded = tokens - this._tokens;
      const msNeeded = Math.max(1, Math.ceil((tokensNeeded / this._refillRatePerSec) * 1000));
      await new Promise(resolve => setTimeout(resolve, msNeeded));
    }
  }
}
