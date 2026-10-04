# TICKET-001: TokenBucket Core Logic and Refill Math

**What to build:**
Implement the TokenBucket engine with capacity, refillRatePerSec, burst allowance, fractional token support, and both synchronous (`tryConsume`) and asynchronous (`consume`) consumption methods. Provide strict input validation and zero external dependencies.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

## Acceptance Criteria

- [ ] Export `TokenBucket` class from `src/token-bucket.js`.
- [ ] Constructor accepts `{ capacity, refillRatePerSec, initialTokens }` with sensible defaults (`initialTokens = capacity`).
- [ ] Validates constructor inputs: `capacity` must be positive number, `refillRatePerSec` must be non-negative number.
- [ ] `tryConsume(tokens = 1)` replenishes tokens based on elapsed time up to capacity, then consumes if sufficient tokens exist; returns boolean.
- [ ] `consume(tokens = 1)` returns a Promise that resolves when tokens become available, waiting if necessary based on refill rate.
- [ ] Validates consumed tokens: rejects non-positive or invalid token values.
- [ ] Provides accessor `tokens` returning current available tokens.
- [ ] Automated unit tests in `tests/rate-limiter.test.js` verify refill math, capacity capping, `tryConsume`, and asynchronous `consume`.
- [ ] Node.js built-in test runner command passes: `npm test`.
