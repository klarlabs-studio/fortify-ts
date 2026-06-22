import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { RateLimiter } from '../src/rate-limiter.js';

describe('RateLimiter Property-Based Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('token bucket invariants', () => {
    it('should never allow more than burst tokens without refill', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }), // rate
          fc.integer({ min: 1, max: 50 }),  // burst
          fc.integer({ min: 10, max: 200 }), // attempts
          (rate, burst, attempts) => {
            const limiter = new RateLimiter({
              rate,
              burst,
              interval: 1000,
            });

            let allowedCount = 0;
            for (let i = 0; i < attempts; i++) {
              if (limiter.allow()) {
                allowedCount++;
              }
            }

            // Without any time passing, we should allow at most burst tokens
            expect(allowedCount).toBeLessThanOrEqual(burst);
            // And at least 1 if we made any attempts
            if (attempts > 0) {
              expect(allowedCount).toBeGreaterThanOrEqual(1);
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('should refill tokens at the correct rate', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }), // rate
          fc.integer({ min: 1, max: 10 }),  // intervals to wait
          (rate, intervalsToWait) => {
            const interval = 1000;
            const limiter = new RateLimiter({
              rate,
              burst: rate, // burst = rate for simplicity
              interval,
            });

            // Drain all tokens
            while (limiter.allow()) {
              // Drain
            }

            // Advance time
            vi.advanceTimersByTime(intervalsToWait * interval);

            // Count how many tokens we can get
            let refilled = 0;
            while (limiter.allow()) {
              refilled++;
            }

            // Should have refilled approximately rate * intervalsToWait tokens
            // but capped at burst
            const expectedMax = rate;
            expect(refilled).toBeLessThanOrEqual(expectedMax);
            expect(refilled).toBeGreaterThan(0);
          }
        ),
        { numRuns: 30 }
      );
    });
  });

  describe('multi-key isolation', () => {
    it('should maintain independent rate limits per key', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 20 }), // rate per key
          fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 2, maxLength: 5 }), // keys
          (rate, keys) => {
            // Make keys unique
            const uniqueKeys = [...new Set(keys)];
            if (uniqueKeys.length < 2) return; // Need at least 2 unique keys

            const limiter = new RateLimiter({
              rate,
              burst: rate,
              interval: 1000,
            });

            // Each key should have its own independent limit.
            // Use a Map (not a plain object) for bookkeeping: fast-check can
            // generate strings like "__proto__", "constructor", or "toString"
            // that collide with Object.prototype members when used as plain
            // object keys, which would corrupt the test's own accounting rather
            // than reveal anything about the limiter. The limiter itself stores
            // buckets in a real Map and isolates such keys correctly.
            const allowedPerKey = new Map<string, number>();

            for (const key of uniqueKeys) {
              let allowed = 0;
              // Try to use all tokens for this key
              for (let i = 0; i < rate + 10; i++) {
                if (limiter.allow(key)) {
                  allowed++;
                }
              }
              allowedPerKey.set(key, allowed);
            }

            // Each key should have been able to use up to burst tokens,
            // independent of every other key (no shared counter/state).
            for (const key of uniqueKeys) {
              expect(allowedPerKey.get(key)).toBe(rate);
            }
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('take operation', () => {
    it('should atomically consume exact token amount', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 10, max: 100 }), // burst
          fc.integer({ min: 1, max: 20 }),   // tokens to take
          fc.integer({ min: 1, max: 5 }),    // number of takes
          (burst, tokensPerTake, numTakes) => {
            const limiter = new RateLimiter({
              rate: burst,
              burst,
              interval: 1000,
            });

            let totalTaken = 0;
            let successfulTakes = 0;

            for (let i = 0; i < numTakes; i++) {
              if (limiter.take('key', tokensPerTake)) {
                totalTaken += tokensPerTake;
                successfulTakes++;
              }
            }

            // Should have taken exactly what was allowed
            expect(totalTaken).toBeLessThanOrEqual(burst);

            // Verify by trying to take remaining
            let remaining = 0;
            while (limiter.allow('key')) {
              remaining++;
            }

            // Total should equal burst
            expect(totalTaken + remaining).toBe(burst);
          }
        ),
        { numRuns: 30 }
      );
    });
  });

  describe('configuration validation', () => {
    it('should handle edge case configurations', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 10000 }), // rate
          fc.integer({ min: 1, max: 10000 }), // burst
          fc.integer({ min: 1, max: 60000 }), // interval
          (rate, burst, interval) => {
            const limiter = new RateLimiter({
              rate,
              burst,
              interval,
            });

            // Should be able to allow at least one request
            expect(limiter.allow()).toBe(true);
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
