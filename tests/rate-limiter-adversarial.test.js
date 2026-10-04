import test from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucket } from '../src/token-bucket.js';
import { SlidingWindowRateLimiter, MemoryStorageAdapter } from '../src/rate-limiter.js';

test('TokenBucket - Extreme concurrency bursts (tryConsume)', () => {
  const bucket = new TokenBucket({ capacity: 50, refillRatePerSec: 0, initialTokens: 50 });
  let successes = 0;
  let failures = 0;

  // Simulate concurrent execution (in JS event loop, this is synchronous, but let's test synchronous bursts)
  for (let i = 0; i < 100; i++) {
    if (bucket.tryConsume(1)) {
      successes++;
    } else {
      failures++;
    }
  }
  assert.equal(successes, 50);
  assert.equal(failures, 50);
});

test('TokenBucket - Extreme concurrency bursts (consume async)', async () => {
  const bucket = new TokenBucket({ capacity: 5, refillRatePerSec: 50, initialTokens: 5 });
  const start = Date.now();

  const promises = [];
  for (let i = 0; i < 15; i++) {
    promises.push(bucket.consume(1));
  }

  await Promise.all(promises);
  const duration = Date.now() - start;

  // 5 initial tokens, need 10 more. At 50 tokens/sec, 10 tokens takes ~200ms.
  assert.ok(duration >= 190, `Duration was ${duration}ms, expected >= 190ms`);
});

test('SlidingWindowRateLimiter - Extreme concurrency bursts', async () => {
  const limiter = new SlidingWindowRateLimiter({ windowMs: 1000, maxRequests: 10 });
  const promises = [];

  for (let i = 0; i < 25; i++) {
    promises.push(limiter.record('burst-key', 1));
  }

  const results = await Promise.all(promises);
  const allowed = results.filter(r => r.allowed).length;
  const denied = results.filter(r => !r.allowed).length;

  assert.equal(allowed, 10);
  assert.equal(denied, 15);
});

test('TokenBucket - floating-point precision directly', async () => {
  const bucket = new TokenBucket({ capacity: 10.5, refillRatePerSec: 0.1, initialTokens: 0 });
  assert.equal(bucket.tryConsume(1), false);

  const bucket2 = new TokenBucket({ capacity: 10, refillRatePerSec: 100, initialTokens: 0.1 });
  assert.equal(bucket2.tryConsume(1), false);

  // Very slow refill rate to see if tiny token addition accumulates without NaN/Infinity
  const bucket3 = new TokenBucket({ capacity: 10, refillRatePerSec: 0.0000000001, initialTokens: 0 });
  await new Promise(resolve => setTimeout(resolve, 10)); // tiny wait
  assert.ok(bucket3.tokens > 0);
  assert.ok(bucket3.tokens < 0.0001);

  // Consume fraction? The class allows fractional tokens if requested
  const bucket4 = new TokenBucket({ capacity: 1, refillRatePerSec: 1, initialTokens: 1 });
  assert.equal(bucket4.tryConsume(0.5), true);
  assert.equal(bucket4.tryConsume(0.51), false);
});

test('TokenBucket - Boundary transitions', () => {
  const bucket = new TokenBucket({ capacity: 1, refillRatePerSec: 0, initialTokens: 1 });
  assert.equal(bucket.tryConsume(1), true);
  assert.equal(bucket.tryConsume(0.000001), false); // Boundary at 0
});

test('TokenBucket - Sub-millisecond precision and clock drift', () => {
  const originalPerformanceNow = globalThis.performance.now;
  let mockTime = 1000.0; // Start at arbitrary time

  globalThis.performance.now = () => mockTime;

  try {
    const bucket = new TokenBucket({ capacity: 10, refillRatePerSec: 1000, initialTokens: 0 }); // 1 token per ms

    // Simulate high frequency sub-millisecond calls
    mockTime += 0.4;
    assert.equal(bucket.tryConsume(1), false); // Not enough for 1 token yet, but bucket should have 0.4 tokens

    mockTime += 0.4;
    assert.equal(bucket.tryConsume(1), false); // 0.8 tokens

    mockTime += 0.2;
    assert.equal(bucket.tryConsume(1), true); // 1.0 tokens, should consume successfully

    assert.equal(bucket.tokens, 0);

    // Simulate backward clock drift
    mockTime -= 5.0; // Time travels backward 5ms
    bucket._refill(); // Trigger a refill

    // Tokens should remain at 0, not go negative
    assert.equal(bucket.tokens, 0);
  } finally {
    globalThis.performance.now = originalPerformanceNow;
  }
});

test('TokenBucket - Invalid inputs and edge cases', async () => {
  assert.throws(() => new TokenBucket({ capacity: NaN, refillRatePerSec: 10 }), /capacity must be a positive number/);
  assert.throws(() => new TokenBucket({ capacity: 10, refillRatePerSec: -Infinity }), /refillRatePerSec must be a non-negative number/);

  const bucket = new TokenBucket({ capacity: 10, refillRatePerSec: 10 });
  assert.throws(() => bucket.tryConsume(NaN), /tokens must be a positive number/);
  assert.throws(() => bucket.tryConsume(Infinity), /tokens must be a positive number/);
});

test('SlidingWindowRateLimiter - Sub-millisecond and edge cases', async () => {
  const limiter = new SlidingWindowRateLimiter({ windowMs: 1000, maxRequests: 5 });

  // Test invalid record arguments
  await assert.rejects(limiter.record('k', NaN), /tokens must be a positive number/);

  // Sub-millisecond timing behavior
  const p1 = limiter.record('ms-key');
  const p2 = limiter.record('ms-key');

  const r1 = await p1;
  const r2 = await p2;

  assert.equal(r1.allowed, true);
  assert.equal(r2.allowed, true);
});
