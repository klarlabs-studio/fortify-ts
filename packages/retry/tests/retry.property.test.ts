import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import { Retry } from '../src/retry.js';
import { MaxAttemptsReachedError, asNonRetryable } from '@klarlabs-studio/fortify-core';

describe('Retry Property-Based Tests', () => {
  describe('successful operations', () => {
    it('should make exactly 1 attempt on immediate success', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 10 }), // maxAttempts
          fc.anything(), // return value
          async (maxAttempts, returnValue) => {
            let attemptCount = 0;

            const retry = new Retry({
              maxAttempts,
              initialDelay: 10,
            });

            const operation = vi.fn(async () => {
              attemptCount++;
              return returnValue;
            });

            const result = await retry.execute(operation);

            expect(result).toEqual(returnValue);
            expect(attemptCount).toBe(1);
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('non-retryable error handling', () => {
    it('should stop immediately on non-retryable errors', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 5 }), // maxAttempts (at least 2)
          async (maxAttempts) => {
            let attemptCount = 0;

            const retry = new Retry({
              maxAttempts,
              initialDelay: 10,
            });

            const nonRetryableError = asNonRetryable(new Error('Non-retryable'));

            const operation = vi.fn(async () => {
              attemptCount++;
              throw nonRetryableError;
            });

            await expect(retry.execute(operation)).rejects.toThrow(MaxAttemptsReachedError);

            // Should have only made 1 attempt
            expect(attemptCount).toBe(1);
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('configuration validation', () => {
    it('should accept valid configuration combinations', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }), // maxAttempts
          fc.integer({ min: 1, max: 10000 }), // initialDelay
          fc.constantFrom('exponential', 'linear', 'constant'), // backoffPolicy
          fc.double({ min: 1.1, max: 10, noNaN: true }), // multiplier
          fc.boolean(), // jitter
          (maxAttempts, initialDelay, backoffPolicy, multiplier, jitter) => {
            // Should not throw
            const retry = new Retry({
              maxAttempts,
              initialDelay,
              backoffPolicy: backoffPolicy as 'exponential' | 'linear' | 'constant',
              multiplier,
              jitter,
            });

            expect(retry.getConfig().maxAttempts).toBe(maxAttempts);
            expect(retry.getConfig().initialDelay).toBe(initialDelay);
          }
        ),
        { numRuns: 30 }
      );
    });
  });

  describe('MaxAttemptsReachedError properties', () => {
    it('should have correct properties on MaxAttemptsReachedError', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100 }), // attempts
          fc.string({ minLength: 1 }), // message
          (attempts, message) => {
            const lastError = new Error('Some error');
            const error = new MaxAttemptsReachedError(message, attempts, lastError);

            expect(error.attempts).toBe(attempts);
            expect(error.lastError).toBe(lastError);
            expect(error.message).toBe(message);
            expect(error.name).toBe('MaxAttemptsReachedError');
          }
        ),
        { numRuns: 30 }
      );
    });
  });

  describe('backoff policy selection', () => {
    it('should use configured backoff policy', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('exponential', 'linear', 'constant'),
          (policy) => {
            const retry = new Retry({
              maxAttempts: 3,
              initialDelay: 100,
              backoffPolicy: policy as 'exponential' | 'linear' | 'constant',
            });

            expect(retry.getConfig().backoffPolicy).toBe(policy);
          }
        ),
        { numRuns: 10 }
      );
    });
  });

  describe('jitter configuration', () => {
    it('should respect jitter setting', () => {
      fc.assert(
        fc.property(
          fc.boolean(),
          (jitter) => {
            const retry = new Retry({
              maxAttempts: 3,
              initialDelay: 100,
              jitter,
            });

            expect(retry.getConfig().jitter).toBe(jitter);
          }
        ),
        { numRuns: 10 }
      );
    });
  });

  describe('custom isRetryable function', () => {
    it('should respect custom isRetryable returning false', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 5 }), // maxAttempts
          async (maxAttempts) => {
            let attemptCount = 0;

            const retry = new Retry({
              maxAttempts,
              initialDelay: 10,
              isRetryable: () => false, // Never retry
            });

            const operation = vi.fn(async () => {
              attemptCount++;
              throw new Error('Some error');
            });

            await expect(retry.execute(operation)).rejects.toThrow(MaxAttemptsReachedError);

            // Should have only made 1 attempt since isRetryable returns false
            expect(attemptCount).toBe(1);
          }
        ),
        { numRuns: 15 }
      );
    });
  });
});
