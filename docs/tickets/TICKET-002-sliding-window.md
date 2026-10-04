# TICKET-002: SlidingWindowRateLimiter and Module Integration

**What to build:**
Implement the SlidingWindowRateLimiter engine with sliding log window tracking, pluggable storage adapters (`MemoryStorageAdapter` default), and re-export `TokenBucket`, `SlidingWindowRateLimiter`, and `MemoryStorageAdapter` alongside `TaskQueue` from `src/index.js`.

**Blocked by:** TICKET-001: TokenBucket Core Logic and Refill Math

**Status:** ready-for-agent

## Acceptance Criteria

- [ ] Export `SlidingWindowRateLimiter` and `MemoryStorageAdapter` from `src/rate-limiter.js`.
- [ ] `MemoryStorageAdapter` implements async methods: `get(key)`, `set(key, timestamps)`, `delete(key)`, `clear()`.
- [ ] `SlidingWindowRateLimiter` constructor accepts `{ windowMs, maxRequests, storageAdapter }`.
- [ ] Constructor validates `windowMs` and `maxRequests` are positive numbers.
- [ ] `isAllowed(key, tokens = 1)` evaluates whether the key has capacity within current sliding window without recording.
- [ ] `record(key, tokens = 1)` purges timestamps older than `now - windowMs`, checks capacity, records timestamp if allowed, and returns `{ allowed: boolean, remaining: number, resetMs: number }`.
- [ ] `reset(key)` clears timestamps for specified key, or all keys if key is omitted.
- [ ] `src/index.js` re-exports `TaskQueue`, `TokenBucket`, `SlidingWindowRateLimiter`, and `MemoryStorageAdapter`.
- [ ] Automated tests in `tests/rate-limiter.test.js` cover sliding window boundaries, storage adapter contracts, and public index re-exports.
- [ ] Node.js built-in test runner command passes: `npm test`.
