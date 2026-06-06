import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fc from 'fast-check';
import { CircuitBreaker } from '../src/circuit-breaker.js';
import { States } from '../src/state.js';
import { CircuitOpenError } from '@klarlabs-studio/fortify-core';

describe('CircuitBreaker Property-Based Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('state transitions', () => {
    it('should never exceed maxFailures before opening', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 20 }), // maxFailures
          async (maxFailures) => {
            const cb = new CircuitBreaker<string>({
              maxFailures,
              timeout: 1000,
            });

            let failureCount = 0;
            while (cb.state() === States.CLOSED && failureCount < maxFailures + 10) {
              try {
                await cb.execute(async () => {
                  throw new Error('fail');
                });
              } catch {
                failureCount++;
              }
              await vi.runAllTimersAsync();
            }

            // Circuit should be OPEN after exactly maxFailures consecutive failures
            expect(failureCount).toBe(maxFailures);
            expect(cb.state()).toBe(States.OPEN);
            cb.destroy();
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should reset consecutive failures after a success', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 10 }), // maxFailures
          fc.integer({ min: 1, max: 5 }),  // failures before success
          async (maxFailures, failuresBeforeSuccess) => {
            // Ensure we don't trip the circuit
            const actualFailures = Math.min(failuresBeforeSuccess, maxFailures - 1);

            const cb = new CircuitBreaker<string>({
              maxFailures,
              timeout: 1000,
            });

            // Add some failures
            for (let i = 0; i < actualFailures; i++) {
              try {
                await cb.execute(async () => {
                  throw new Error('fail');
                });
              } catch {
                // Expected
              }
            }

            expect(cb.state()).toBe(States.CLOSED);
            expect(cb.getCounts().consecutiveFailures).toBe(actualFailures);

            // Success should reset consecutive failures
            await cb.execute(async () => 'success');
            expect(cb.getCounts().consecutiveFailures).toBe(0);
            expect(cb.state()).toBe(States.CLOSED);
            cb.destroy();
          }
        ),
        { numRuns: 20 }
      );
    });

    it('should transition OPEN -> HALF_OPEN -> CLOSED on success', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 5 }),    // maxFailures
          fc.integer({ min: 100, max: 1000 }), // timeout
          async (maxFailures, timeout) => {
            const cb = new CircuitBreaker<string>({
              maxFailures,
              timeout,
              timeoutJitter: 0, // Disable jitter for deterministic tests
            });

            // Trip the circuit
            for (let i = 0; i < maxFailures; i++) {
              try {
                await cb.execute(async () => {
                  throw new Error('fail');
                });
              } catch {
                // Expected
              }
            }
            await vi.runAllTimersAsync();
            expect(cb.state()).toBe(States.OPEN);

            // Wait for timeout
            vi.advanceTimersByTime(timeout);

            // Execute success - should transition to HALF_OPEN then CLOSED
            const result = await cb.execute(async () => 'success');
            expect(result).toBe('success');
            await vi.runAllTimersAsync();
            expect(cb.state()).toBe(States.CLOSED);
            cb.destroy();
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('configuration validation', () => {
    it('should accept valid configurations', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }),  // maxFailures
          fc.integer({ min: 1, max: 100000 }), // timeout
          fc.integer({ min: 1, max: 50 }),   // halfOpenMaxRequests
          (maxFailures, timeout, halfOpenMaxRequests) => {
            const cb = new CircuitBreaker<string>({
              maxFailures,
              timeout,
              halfOpenMaxRequests,
            });

            expect(cb.state()).toBe(States.CLOSED);
            cb.destroy();
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('counts invariants', () => {
    it('should maintain consistent counts', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.boolean(), { minLength: 1, maxLength: 50 }), // success/failure sequence
          async (outcomes) => {
            const cb = new CircuitBreaker<string>({
              maxFailures: 100, // High to avoid tripping
              timeout: 10000,
            });

            let expectedSuccesses = 0;
            let expectedFailures = 0;

            for (const shouldSucceed of outcomes) {
              try {
                await cb.execute(async () => {
                  if (shouldSucceed) return 'success';
                  throw new Error('fail');
                });
                expectedSuccesses++;
              } catch (error) {
                if (!(error instanceof CircuitOpenError)) {
                  expectedFailures++;
                }
              }
            }

            const counts = cb.getCounts();
            expect(counts.totalSuccesses).toBe(expectedSuccesses);
            expect(counts.totalFailures).toBe(expectedFailures);
            expect(counts.requests).toBe(expectedSuccesses + expectedFailures);
            cb.destroy();
          }
        ),
        { numRuns: 30 }
      );
    });
  });
});
