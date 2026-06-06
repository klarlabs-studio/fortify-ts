import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { Timeout } from '../src/timeout.js';
import { TimeoutError } from '@klarlabs-studio/fortify-core';

describe('Timeout Property-Based Tests', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('timeout configuration', () => {
    it('getDefaultTimeout should return configured value', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 300000 }), // defaultTimeout
          (defaultTimeout) => {
            const timeout = new Timeout({ defaultTimeout });
            expect(timeout.getDefaultTimeout()).toBe(defaultTimeout);
          }
        ),
        { numRuns: 30 }
      );
    });
  });

  describe('fast operations', () => {
    it('should complete immediately resolving operations', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 100, max: 5000 }), // timeout duration
          fc.anything(), // return value
          async (timeoutDuration, returnValue) => {
            const timeout = new Timeout({ defaultTimeout: timeoutDuration });

            // Sync operation that returns immediately
            const result = await timeout.execute(async () => returnValue);

            expect(result).toEqual(returnValue);
          }
        ),
        { numRuns: 20 }
      );
    });
  });

  describe('callback behavior', () => {
    it('onTimeout should not be called on success', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 100, max: 1000 }), // timeout duration
          async (timeoutDuration) => {
            let onTimeoutCalls = 0;

            const timeout = new Timeout({
              defaultTimeout: timeoutDuration,
              onTimeout: () => {
                onTimeoutCalls++;
              },
            });

            // Immediate operation
            await timeout.execute(async () => 'success');

            expect(onTimeoutCalls).toBe(0);
          }
        ),
        { numRuns: 15 }
      );
    });
  });

  describe('abort signal handling', () => {
    it('should reject immediately with already aborted signal', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 100, max: 5000 }), // timeout duration
          async (timeoutDuration) => {
            const timeout = new Timeout({ defaultTimeout: timeoutDuration });
            const controller = new AbortController();
            controller.abort();

            const operation = vi.fn(async () => 'success');

            await expect(
              timeout.execute(operation, controller.signal)
            ).rejects.toThrow();

            expect(operation).not.toHaveBeenCalled();
          }
        ),
        { numRuns: 15 }
      );
    });
  });

  describe('signal propagation', () => {
    it('should pass signal to operation', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 100, max: 1000 }), // timeout duration
          async (timeoutDuration) => {
            const timeout = new Timeout({ defaultTimeout: timeoutDuration });
            let receivedSignal: AbortSignal | null = null;

            await timeout.execute(async (signal) => {
              receivedSignal = signal;
              return 'success';
            });

            expect(receivedSignal).not.toBeNull();
            expect(receivedSignal!.aborted).toBe(false);
          }
        ),
        { numRuns: 15 }
      );
    });
  });

  describe('TimeoutError properties', () => {
    it('should have correct properties on TimeoutError', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100000 }), // timeout value
          fc.string({ minLength: 1 }), // message
          (timeoutMs, message) => {
            const error = new TimeoutError(message, timeoutMs);

            expect(error.timeoutMs).toBe(timeoutMs);
            expect(error.duration).toBe(timeoutMs);
            expect(error.message).toBe(message);
            expect(error.name).toBe('TimeoutError');
          }
        ),
        { numRuns: 30 }
      );
    });
  });
});
