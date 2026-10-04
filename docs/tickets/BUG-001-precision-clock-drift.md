# BUG-001: Sub-millisecond Time Precision and System Clock Jitter in TokenBucket

**Problem Summary:**
In environments with high-frequency consumption calls or sub-millisecond invocation intervals, `TokenBucket._refill()` calculates elapsed time using integer milliseconds via `Date.now()`. When multiple `tryConsume()` or `consume()` calls occur within the same millisecond (`now === this._lastRefillTime`), `elapsedMs` evaluates to `0`, resulting in zero token replenishment even when fractional time has elapsed.

Furthermore, if system time adjusts backwards (NTP clock slew or drift), `now - this._lastRefillTime` becomes negative. Currently, this causes `tokensToAdd` to become negative, erroneously decrementing accumulated tokens or leading to inconsistent token counts.

**What to build:**
1. Upgrade time measurement to high-resolution monotonic time: use `process.hrtime.bigint()` or high-precision time tracking (`performance.now()`) to prevent sub-millisecond precision loss.
2. Clamp elapsed time to `>= 0` so clock skew or NTP adjustments never drain tokens.
3. Handle floating point rounding precision when accumulating fractional tokens close to capacity.

**Blocked by:** None

**Status:** ready-for-agent

## Acceptance Criteria

- [ ] Modify `src/token-bucket.js` to calculate elapsed time with high precision (e.g. `process.hrtime.bigint()` or `performance.now()`), avoiding zero-replenishment stalls on rapid sub-millisecond calls.
- [ ] Guard against backward clock drift: elapsed time must never be negative (`Math.max(0, elapsed)`).
- [ ] Write a regression test in `tests/rate-limiter.test.js` or `tests/rate-limiter-adversarial.test.js` reproducing high-frequency sub-millisecond refills and ensuring non-negative elapsed time under simulated clock drift.
- [ ] All tests pass via `npm test`.
