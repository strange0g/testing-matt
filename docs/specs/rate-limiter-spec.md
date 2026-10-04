# Distributed Rate Limiter and Token Bucket Engine Specification

## Problem Statement

Distributed task processing systems and API services require granular traffic control and burst regulation to prevent resource exhaustion, avoid downstream rate limits, and maintain predictable system throughput. Without resilient rate limiting and burst management, spikes in workload can overwhelm worker pools and saturate backend services.

## Solution

Provide a modular, robust rate limiting and token bucket engine with zero external dependencies. The engine comprises:
1. `TokenBucket`: A precision token bucket algorithm supporting burst allowance, steady refill rates, fractional token consumption, and both blocking and non-blocking consumption.
2. `SlidingWindowRateLimiter`: A sliding log rate limiter tracking request timestamps within a moving time window to eliminate boundary reset bursts.
3. Pluggable Storage Adapters: An in-memory default storage adapter with a pluggable asynchronous interface for distributed backends (such as Redis or Key-Value stores).
4. Clean ESM exports exposed via `src/token-bucket.js`, `src/rate-limiter.js`, and re-exported in `src/index.js`.

## User Stories

1. As a task dispatcher, I want to initialize a TokenBucket with a maximum capacity and a refill rate per second, so that task dispatch adheres to downstream quotas.
2. As a worker process, I want to call `tryConsume(tokens)` on a TokenBucket to immediately check and consume tokens without blocking if sufficient tokens are available.
3. As a worker process, I want to call `consume(tokens)` on a TokenBucket which asynchronously waits until enough tokens are replenished before proceeding.
4. As a system engineer, I want TokenBucket to reject invalid configuration inputs (such as non-positive capacity, negative refill rates, or non-positive token requests) with explicit Errors.
5. As an API gateway handler, I want to initialize a SlidingWindowRateLimiter with a window duration in milliseconds and a maximum request allowance, so that traffic spikes across window boundaries are smoothly mitigated.
6. As an API gateway handler, I want to call `record(key)` on SlidingWindowRateLimiter to log an event and inspect whether the key exceeds its quota.
7. As an API gateway handler, I want to call `isAllowed(key)` to inspect remaining allowance without modifying the recorded history.
8. As a test suite or administrative endpoint, I want to call `reset(key)` on SlidingWindowRateLimiter to clear history for a specific key or all keys.
9. As a systems architect, I want SlidingWindowRateLimiter to accept a pluggable storage adapter adhering to get/set/clear primitives, defaulting to an efficient in-memory implementation.
10. As a package consumer, I want all public classes and helper functions to be strictly exported as ECMAScript Modules from `src/index.js`.

## Implementation Decisions

1. `TokenBucket` Core Architecture:
   - Maintains current token state, capacity, refill rate per second, and high-precision timestamps.
   - Refill calculations use elapsed time calculations to accurately replenish tokens up to capacity.
   - Fractional token amounts are supported with robust floating point handling.
   - `tryConsume(tokens = 1)` returns boolean `true` if consumed, `false` otherwise.
   - `consume(tokens = 1)` returns a Promise resolving to `true` when tokens become available, calculating delay dynamically.

2. `SlidingWindowRateLimiter` Core Architecture:
   - Tracks timestamped events per key within the configured `windowMs`.
   - Purges timestamps older than `(now - windowMs)` during evaluation.
   - `isAllowed(key, tokens = 1)` evaluates if current window count plus requested tokens is within `maxRequests`.
   - `record(key, tokens = 1)` appends timestamped events if allowed and returns status object with `{ allowed: boolean, remaining: number, resetMs: number }`.
   - `reset(key)` purges history for the specified key or all keys if no key is provided.

3. Storage Adapter Contract:
   - Default `MemoryStorageAdapter` stores timestamp arrays in memory.
   - Interface specifies asynchronous methods: `get(key)`, `set(key, value)`, `delete(key)`, `clear()`.

4. Module Seams and ESM Packaging:
   - `src/token-bucket.js`: exports `TokenBucket`.
   - `src/rate-limiter.js`: exports `SlidingWindowRateLimiter` and `MemoryStorageAdapter`.
   - `src/index.js`: re-exports `TaskQueue` (existing), `TokenBucket`, `SlidingWindowRateLimiter`, and `MemoryStorageAdapter`.
   - Zero external dependencies: rely strictly on Node.js built-ins.

## Testing Decisions

- Test runner: Node.js built-in runner executed via `export PATH="$PWD/.bin:$PATH" && npm test` (`node --test tests/*.test.js`).
- Public seams tested:
  - `TokenBucket`: capacity bounds, refill rates over time, blocking `consume()`, non-blocking `tryConsume()`, input validations.
  - `SlidingWindowRateLimiter`: sliding window boundary accuracy, `isAllowed()`, `record()`, `reset()`, custom storage adapters.
  - `src/index.js`: verify complete public exports.
- Boundary conditions for Jules Tester Agent:
  - Zero and fractional token requests.
  - Concurrency stress tests with simultaneous asynchronous `consume()` callers.
  - Timestamp boundary tests exactly at window cutoff.
  - Memory cleanup and stale key purging.

## Out of Scope

- External Redis or Memcached network drivers (adapter interface provided; specific network drivers live in external packages).
- HTTP middleware wrappers (pure algorithmic and storage layer).

## Further Notes

- Em-dash prohibition: zero em-dashes throughout all docs, code comments, and messages.
- Red-green TDD discipline enforced during Jules implementation.
