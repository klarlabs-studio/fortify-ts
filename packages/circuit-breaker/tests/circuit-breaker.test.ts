import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CircuitBreaker } from '../src/circuit-breaker.js';
import { States } from '../src/state.js';
import { CircuitOpenError } from '@klarlabs-studio/fortify-core';

describe('CircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('initialization', () => {
    it('should initialize with default configuration', () => {
      const cb = new CircuitBreaker();
      expect(cb.state()).toBe(States.CLOSED);
      expect(cb.getCounts()).toEqual({
        requests: 0,
        totalSuccesses: 0,
        totalFailures: 0,
        consecutiveSuccesses: 0,
        consecutiveFailures: 0,
      });
      cb.destroy();
    });

    it('should accept custom configuration', () => {
      const cb = new CircuitBreaker({
        maxFailures: 10,
        timeout: 30000,
        halfOpenMaxRequests: 3,
      });
      expect(cb.state()).toBe(States.CLOSED);
      cb.destroy();
    });
  });

  describe('closed state', () => {
    it('should execute operations successfully', async () => {
      const cb = new CircuitBreaker<string>();
      const result = await cb.execute(async () => 'success');
      expect(result).toBe('success');
      expect(cb.getCounts().totalSuccesses).toBe(1);
      expect(cb.getCounts().consecutiveSuccesses).toBe(1);
      cb.destroy();
    });

    it('should track failures', async () => {
      const cb = new CircuitBreaker<string>();
      const error = new Error('test error');

      await expect(cb.execute(async () => {
        throw error;
      })).rejects.toThrow('test error');

      expect(cb.getCounts().totalFailures).toBe(1);
      expect(cb.getCounts().consecutiveFailures).toBe(1);
      cb.destroy();
    });

    it('should reset consecutive failures after success', async () => {
      const cb = new CircuitBreaker<string>({ maxFailures: 5 });

      // Generate some failures
      for (let i = 0; i < 3; i++) {
        await expect(cb.execute(async () => {
          throw new Error('fail');
        })).rejects.toThrow();
      }

      expect(cb.getCounts().consecutiveFailures).toBe(3);

      // Success resets consecutive failures
      await cb.execute(async () => 'success');
      expect(cb.getCounts().consecutiveFailures).toBe(0);
      expect(cb.getCounts().consecutiveSuccesses).toBe(1);
      cb.destroy();
    });
  });

  describe('state transitions', () => {
    it('should open after maxFailures consecutive failures', async () => {
      const cb = new CircuitBreaker<string>({ maxFailures: 3 });

      for (let i = 0; i < 3; i++) {
        await expect(cb.execute(async () => {
          throw new Error('fail');
        })).rejects.toThrow();
      }

      // Process microtasks for state change callback
      await vi.runAllTimersAsync();

      expect(cb.state()).toBe(States.OPEN);
      cb.destroy();
    });

    it('should reject requests when open', async () => {
      const cb = new CircuitBreaker<string>({ maxFailures: 1 });

      await expect(cb.execute(async () => {
        throw new Error('fail');
      })).rejects.toThrow();

      await vi.runAllTimersAsync();
      expect(cb.state()).toBe(States.OPEN);

      await expect(cb.execute(async () => 'success')).rejects.toThrow(CircuitOpenError);
      cb.destroy();
    });

    it('should transition to half-open after timeout', async () => {
      const cb = new CircuitBreaker<string>({ maxFailures: 1, timeout: 5000, timeoutJitter: 0 });

      await expect(cb.execute(async () => {
        throw new Error('fail');
      })).rejects.toThrow();

      await vi.runAllTimersAsync();
      expect(cb.state()).toBe(States.OPEN);

      // Advance time past timeout
      vi.advanceTimersByTime(5000);

      // Next request should transition to half-open
      await cb.execute(async () => 'success');

      // After success in half-open, should close
      await vi.runAllTimersAsync();
      expect(cb.state()).toBe(States.CLOSED);
      cb.destroy();
    });

    it('should add jitter to timeout when configured', async () => {
      // Mock Math.random to return 1.0 (max jitter)
      const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(1.0);

      const cb = new CircuitBreaker<string>({
        maxFailures: 1,
        timeout: 5000,
        timeoutJitter: 0.2, // 20% jitter, so max timeout = 5000 + 1000 = 6000
      });

      // Trip the circuit
      await expect(cb.execute(async () => {
        throw new Error('fail');
      })).rejects.toThrow();

      await vi.runAllTimersAsync();
      expect(cb.state()).toBe(States.OPEN);

      // Advance by base timeout (5000ms) - should still be open due to jitter
      vi.advanceTimersByTime(5000);
      await expect(cb.execute(async () => 'success')).rejects.toThrow(CircuitOpenError);
      expect(cb.state()).toBe(States.OPEN);

      // Advance by jitter amount (1000ms more) - now should transition
      vi.advanceTimersByTime(1000);
      await cb.execute(async () => 'success');
      await vi.runAllTimersAsync();
      expect(cb.state()).toBe(States.CLOSED);

      cb.destroy();
      randomSpy.mockRestore();
    });

    it('should close after success in half-open', async () => {
      const cb = new CircuitBreaker<string>({ maxFailures: 1, timeout: 5000, timeoutJitter: 0 });

      // Trip the circuit
      await expect(cb.execute(async () => {
        throw new Error('fail');
      })).rejects.toThrow();

      await vi.runAllTimersAsync();
      expect(cb.state()).toBe(States.OPEN);

      // Wait for timeout
      vi.advanceTimersByTime(5000);

      // Execute successful request
      await cb.execute(async () => 'success');

      await vi.runAllTimersAsync();
      expect(cb.state()).toBe(States.CLOSED);
      cb.destroy();
    });

    it('should reopen after failure in half-open', async () => {
      const cb = new CircuitBreaker<string>({ maxFailures: 1, timeout: 5000, timeoutJitter: 0 });

      // Trip the circuit
      await expect(cb.execute(async () => {
        throw new Error('fail');
      })).rejects.toThrow();

      await vi.runAllTimersAsync();
      expect(cb.state()).toBe(States.OPEN);

      // Wait for timeout
      vi.advanceTimersByTime(5000);

      // Execute failing request in half-open
      await expect(cb.execute(async () => {
        throw new Error('still failing');
      })).rejects.toThrow();

      await vi.runAllTimersAsync();
      expect(cb.state()).toBe(States.OPEN);
      cb.destroy();
    });
  });

  describe('half-open state', () => {
    it('should limit requests in half-open state', async () => {
      const cb = new CircuitBreaker<string>({
        maxFailures: 1,
        timeout: 5000,
        halfOpenMaxRequests: 2,
        timeoutJitter: 0,
      });

      // Trip the circuit
      await expect(cb.execute(async () => {
        throw new Error('fail');
      })).rejects.toThrow();

      await vi.runAllTimersAsync();

      // Wait for timeout
      vi.advanceTimersByTime(5000);

      // Start multiple concurrent requests
      const request1 = cb.execute(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return 'result1';
      });

      const request2 = cb.execute(async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return 'result2';
      });

      // Third request should be rejected
      await expect(cb.execute(async () => 'result3')).rejects.toThrow(CircuitOpenError);

      // Let the first two complete
      vi.advanceTimersByTime(100);
      await request1;
      await request2;

      cb.destroy();
    });
  });

  describe('reset', () => {
    it('should reset to closed state', async () => {
      const cb = new CircuitBreaker<string>({ maxFailures: 1 });

      // Trip the circuit
      await expect(cb.execute(async () => {
        throw new Error('fail');
      })).rejects.toThrow();

      await vi.runAllTimersAsync();
      expect(cb.state()).toBe(States.OPEN);

      cb.reset();
      expect(cb.state()).toBe(States.CLOSED);
      expect(cb.getCounts().totalFailures).toBe(0);
      cb.destroy();
    });

    it('should call onStateChange when resetting from non-closed state', async () => {
      const onStateChange = vi.fn();
      const cb = new CircuitBreaker<string>({
        maxFailures: 1,
        onStateChange,
      });

      // Trip the circuit
      await expect(cb.execute(async () => {
        throw new Error('fail');
      })).rejects.toThrow();

      await vi.runAllTimersAsync();

      onStateChange.mockClear();
      cb.reset();

      expect(onStateChange).toHaveBeenCalledWith(States.OPEN, States.CLOSED);
      cb.destroy();
    });
  });

  describe('callbacks', () => {
    it('should call onStateChange on transitions', async () => {
      const onStateChange = vi.fn();
      const cb = new CircuitBreaker<string>({
        maxFailures: 1,
        timeout: 5000,
        onStateChange,
        timeoutJitter: 0,
      });

      // Trip the circuit
      await expect(cb.execute(async () => {
        throw new Error('fail');
      })).rejects.toThrow();

      await vi.runAllTimersAsync();

      expect(onStateChange).toHaveBeenCalledWith(States.CLOSED, States.OPEN);

      // Wait for timeout and trigger half-open
      vi.advanceTimersByTime(5000);
      await cb.execute(async () => 'success');
      await vi.runAllTimersAsync();

      expect(onStateChange).toHaveBeenCalledWith(States.OPEN, States.HALF_OPEN);
      expect(onStateChange).toHaveBeenCalledWith(States.HALF_OPEN, States.CLOSED);
      cb.destroy();
    });

    it('should handle errors in onStateChange gracefully', async () => {
      const onStateChange = vi.fn().mockImplementation(() => {
        throw new Error('callback error');
      });
      const cb = new CircuitBreaker<string>({
        maxFailures: 1,
        onStateChange,
      });

      // Should not throw even though callback throws
      await expect(cb.execute(async () => {
        throw new Error('fail');
      })).rejects.toThrow('fail');

      await vi.runAllTimersAsync();
      expect(cb.state()).toBe(States.OPEN);
      cb.destroy();
    });
  });

  describe('custom trip logic', () => {
    it('should use custom readyToTrip function', async () => {
      const cb = new CircuitBreaker<string>({
        readyToTrip: (counts) => counts.totalFailures >= 2,
      });

      // First failure - not tripped yet
      await expect(cb.execute(async () => {
        throw new Error('fail');
      })).rejects.toThrow();

      await vi.runAllTimersAsync();
      expect(cb.state()).toBe(States.CLOSED);

      // Success in between - still counts total
      await cb.execute(async () => 'success');

      // Second total failure - should trip
      await expect(cb.execute(async () => {
        throw new Error('fail');
      })).rejects.toThrow();

      await vi.runAllTimersAsync();
      expect(cb.state()).toBe(States.OPEN);
      cb.destroy();
    });

    it('should use custom isSuccessful function', async () => {
      const cb = new CircuitBreaker<string>({
        maxFailures: 2,
        isSuccessful: (error) => {
          // Treat specific errors as success
          if (error?.message === 'expected error') return true;
          return error === null;
        },
      });

      // This error should be treated as success
      await expect(cb.execute(async () => {
        throw new Error('expected error');
      })).rejects.toThrow();

      expect(cb.getCounts().totalSuccesses).toBe(1);
      expect(cb.getCounts().totalFailures).toBe(0);
      cb.destroy();
    });
  });

  describe('abort signal', () => {
    it('should throw when signal is already aborted', async () => {
      const cb = new CircuitBreaker<string>();
      const controller = new AbortController();
      controller.abort();

      await expect(
        cb.execute(async () => 'success', controller.signal)
      ).rejects.toThrow();

      // Should not count as failure
      expect(cb.getCounts().totalFailures).toBe(0);
      cb.destroy();
    });

    it('should throw when signal is aborted during execution', async () => {
      const cb = new CircuitBreaker<string>();
      const controller = new AbortController();

      const promise = cb.execute(async (signal) => {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(resolve, 1000);
          signal.addEventListener('abort', () => {
            clearTimeout(timeout);
            reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
          });
        });
        return 'success';
      }, controller.signal);

      // Abort after a short time
      vi.advanceTimersByTime(100);
      controller.abort();

      await expect(promise).rejects.toThrow();
      cb.destroy();
    });
  });

  describe('interval', () => {
    it('should clear counts on interval when closed', async () => {
      const cb = new CircuitBreaker<string>({
        maxFailures: 10,
        interval: 5000,
      });

      // Generate some failures (not enough to trip)
      for (let i = 0; i < 3; i++) {
        await expect(cb.execute(async () => {
          throw new Error('fail');
        })).rejects.toThrow();
      }

      expect(cb.getCounts().totalFailures).toBe(3);

      // Advance past interval
      vi.advanceTimersByTime(5000);

      expect(cb.getCounts().totalFailures).toBe(0);
      cb.destroy();
    });

    it('should not clear counts when not in closed state', async () => {
      const cb = new CircuitBreaker<string>({
        maxFailures: 1,
        interval: 5000,
        timeout: 10000,
      });

      // Trip the circuit
      await expect(cb.execute(async () => {
        throw new Error('fail');
      })).rejects.toThrow();

      // Process only the immediate microtasks, not all timers
      await Promise.resolve();
      await Promise.resolve();
      expect(cb.state()).toBe(States.OPEN);

      const counts = cb.getCounts();

      // Advance past interval - counts should not clear in open state
      vi.advanceTimersByTime(5000);

      expect(cb.getCounts()).toEqual(counts);
      cb.destroy();
    });
  });

  describe('destroy', () => {
    it('should clean up interval timer', () => {
      const cb = new CircuitBreaker<string>({ interval: 1000 });
      cb.destroy();
      // No way to directly test, but should not throw
    });

    it('should be safe to call multiple times', () => {
      const cb = new CircuitBreaker<string>();
      cb.destroy();
      cb.destroy();
      // Should not throw
    });
  });

  describe('non-Error throws', () => {
    it('should wrap non-Error throws in Error and count as failure', async () => {
      const cb = new CircuitBreaker<string>();

      await expect(cb.execute(async () => {
        throw 'string error';
      })).rejects.toThrow('string error');

      // Non-Error throws are now wrapped and counted as failures for consistent handling
      expect(cb.getCounts().totalFailures).toBe(1);
      cb.destroy();
    });

    it('should wrap number throws in Error', async () => {
      const cb = new CircuitBreaker<string>();

      await expect(cb.execute(async () => {
        throw 123;
      })).rejects.toThrow('123');

      expect(cb.getCounts().totalFailures).toBe(1);
      cb.destroy();
    });

    it('should wrap object throws in Error with JSON', async () => {
      const cb = new CircuitBreaker<string>();

      await expect(cb.execute(async () => {
        throw { code: 'ERR_TEST' };
      })).rejects.toThrow('ERR_TEST');

      expect(cb.getCounts().totalFailures).toBe(1);
      cb.destroy();
    });
  });
});
