import test from 'node:test';
import assert from 'node:assert/strict';
import { TokenBucket } from '../src/token-bucket.js';
import { SlidingWindowRateLimiter, MemoryStorageAdapter } from '../src/rate-limiter.js';
import * as index from '../src/index.js';

test('index.js exports', (t) => {
  assert.ok(index.TokenBucket);
  assert.ok(index.SlidingWindowRateLimiter);
  assert.ok(index.MemoryStorageAdapter);
  assert.ok(index.TaskQueue);
});

test('TokenBucket - constructor validation', (t) => {
  assert.throws(() => new TokenBucket({ capacity: -1, refillRatePerSec: 1 }), /capacity must be a positive number/);
  assert.throws(() => new TokenBucket({ capacity: '10', refillRatePerSec: 1 }), /capacity must be a positive number/);
  assert.throws(() => new TokenBucket({ capacity: 10, refillRatePerSec: -1 }), /refillRatePerSec must be a non-negative number/);
  assert.throws(() => new TokenBucket({ capacity: 10, refillRatePerSec: 1, initialTokens: -1 }), /initialTokens must be a non-negative number/);
});

test('TokenBucket - tryConsume and refill', (t) => {
  const bucket = new TokenBucket({ capacity: 10, refillRatePerSec: 10, initialTokens: 5 });

  // Due to high precision time, token count will likely be slightly higher than exactly 5
  // We use 5.5 to allow up to 50ms for test environment timing variances
  assert.ok(bucket.tokens >= 5 && bucket.tokens < 5.5);

  assert.equal(bucket.tryConsume(3), true);
  // Using assert.ok for floating point comparison issues might arise, but integer is fine here.
  assert.ok(bucket.tokens <= 2.1); // Allows small time elapsed

  assert.equal(bucket.tryConsume(3), false);

  assert.throws(() => bucket.tryConsume(0), /tokens must be a positive number/);
});

test('TokenBucket - consume async', async (t) => {
  const bucket = new TokenBucket({ capacity: 10, refillRatePerSec: 100, initialTokens: 0 });

  const start = Date.now();
  await bucket.consume(2); // Should take around 20ms
  const duration = Date.now() - start;

  assert.ok(duration >= 10);
  assert.ok(duration < 100);

  await assert.rejects(bucket.consume(11), /tokens exceed capacity/);
  await assert.rejects(bucket.consume(-1), /tokens must be a positive number/);
});

test('SlidingWindowRateLimiter - constructor validation', (t) => {
  assert.throws(() => new SlidingWindowRateLimiter({ windowMs: 0, maxRequests: 10 }), /windowMs must be a positive number/);
  assert.throws(() => new SlidingWindowRateLimiter({ windowMs: 1000, maxRequests: -1 }), /maxRequests must be a positive number/);
});

test('SlidingWindowRateLimiter - record and isAllowed', async (t) => {
  const limiter = new SlidingWindowRateLimiter({ windowMs: 1000, maxRequests: 2 });

  const r1 = await limiter.record('test-key');
  assert.equal(r1.allowed, true);
  assert.equal(r1.remaining, 1);
  assert.ok(r1.resetMs > 0);

  const r2 = await limiter.record('test-key');
  assert.equal(r2.allowed, true);
  assert.equal(r2.remaining, 0);

  const r3 = await limiter.record('test-key');
  assert.equal(r3.allowed, false);
  assert.equal(r3.remaining, 0);

  const allowed = await limiter.isAllowed('test-key');
  assert.equal(allowed, false);

  await assert.rejects(limiter.record('test-key', -1), /tokens must be a positive number/);
  await assert.rejects(limiter.isAllowed('test-key', -1), /tokens must be a positive number/);
});

test('SlidingWindowRateLimiter - reset', async (t) => {
  const limiter = new SlidingWindowRateLimiter({ windowMs: 1000, maxRequests: 2 });
  await limiter.record('key1', 2);
  await limiter.record('key2', 2);

  assert.equal((await limiter.isAllowed('key1')), false);

  await limiter.reset('key1');
  assert.equal((await limiter.isAllowed('key1')), true);
  assert.equal((await limiter.isAllowed('key2')), false);

  await limiter.reset();
  assert.equal((await limiter.isAllowed('key2')), true);
});

test('MemoryStorageAdapter - basic methods', async (t) => {
  const storage = new MemoryStorageAdapter();
  await storage.set('foo', [1, 2, 3]);
  const val = await storage.get('foo');
  assert.deepEqual(val, [1, 2, 3]);

  await storage.delete('foo');
  const val2 = await storage.get('foo');
  assert.deepEqual(val2, []);

  await storage.set('bar', [1]);
  await storage.clear();
  const val3 = await storage.get('bar');
  assert.deepEqual(val3, []);
});
