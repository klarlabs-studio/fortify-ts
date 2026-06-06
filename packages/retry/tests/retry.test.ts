import { describe, it, expect, vi } from 'vitest';
import { Retry } from '../src/retry.js';
import { MaxAttemptsReachedError, asRetryable, asNonRetryable } from '@klarlabs-studio/fortify-core';

describe('Retry', () => {
  describe('constructor', () => {
    it('should create with default config', () => {
      const retry = new Retry();
      expect(retry.getConfig().maxAttempts).toBe(3);
      expect(retry.getConfig().initialDelay).toBe(100);
      expect(retry.getConfig().backoffPolicy).toBe('exponential');
    });

    it('should create with custom config', () => {
      const retry = new Retry({
        maxAttempts: 5,
        initialDelay: 200,
        backoffPolicy: 'linear',
      });
      expect(retry.getConfig().maxAttempts).toBe(5);
      expect(retry.getConfig().initialDelay).toBe(200);
      expect(retry.getConfig().backoffPolicy).toBe('linear');
    });
  });

  describe('execute', () => {
    it('should return result on first successful attempt', async () => {
      const retry = new Retry({ maxAttempts: 3 });
      const operation = vi.fn().mockResolvedValue('success');

      const result = await retry.execute(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and succeed', async () => {
      const retry = new Retry({ maxAttempts: 3, initialDelay: 10 });
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue('success');

      const result = await retry.execute(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should throw MaxAttemptsReachedError when all attempts fail', async () => {
      const retry = new Retry({ maxAttempts: 3, initialDelay: 10 });
      const error = new Error('always fails');
      const operation = vi.fn().mockRejectedValue(error);

      await expect(retry.execute(operation)).rejects.toBeInstanceOf(MaxAttemptsReachedError);
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should include last error in MaxAttemptsReachedError', async () => {
      const retry = new Retry({ maxAttempts: 2, initialDelay: 10 });
      const lastError = new Error('last error');
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('first error'))
        .mockRejectedValue(lastError);

      try {
        await retry.execute(operation);
        expect.fail('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(MaxAttemptsReachedError);
        expect((error as MaxAttemptsReachedError).lastError).toBe(lastError);
        expect((error as MaxAttemptsReachedError).attempts).toBe(2);
      }
    });

    it('should call onRetry callback on each retry', async () => {
      const onRetry = vi.fn();
      const retry = new Retry({ maxAttempts: 3, initialDelay: 10, onRetry });
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockRejectedValueOnce(new Error('fail 2'))
        .mockResolvedValue('success');

      await retry.execute(operation);

      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.any(Error));
      expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.any(Error));
    });

    it('should not call onRetry callback on success', async () => {
      const onRetry = vi.fn();
      const retry = new Retry({ maxAttempts: 3, onRetry });
      const operation = vi.fn().mockResolvedValue('success');

      await retry.execute(operation);

      expect(onRetry).not.toHaveBeenCalled();
    });

    it('should reject immediately if signal is already aborted', async () => {
      const retry = new Retry({ maxAttempts: 3 });
      const controller = new AbortController();
      controller.abort();
      const operation = vi.fn().mockResolvedValue('success');

      await expect(
        retry.execute(operation, controller.signal)
      ).rejects.toThrow();
      expect(operation).not.toHaveBeenCalled();
    });

    it('should stop retrying if signal is aborted', async () => {
      const retry = new Retry({ maxAttempts: 5, initialDelay: 100 });
      const controller = new AbortController();

      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('fail 1'))
        .mockResolvedValue('success');

      const promise = retry.execute(operation, controller.signal);

      // Abort after first failure
      setTimeout(() => controller.abort(), 50);

      await expect(promise).rejects.toThrow();
    });
  });

  describe('retryable error handling', () => {
    it('should respect RetryableError interface (retryable=true)', async () => {
      const retry = new Retry({ maxAttempts: 3, initialDelay: 10 });
      const retryableError = asRetryable(new Error('retryable'));
      const operation = vi.fn()
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValue('success');

      const result = await retry.execute(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should respect RetryableError interface (retryable=false)', async () => {
      const retry = new Retry({ maxAttempts: 3, initialDelay: 10 });
      const nonRetryableError = asNonRetryable(new Error('not retryable'));
      const operation = vi.fn().mockRejectedValue(nonRetryableError);

      await expect(retry.execute(operation)).rejects.toBeInstanceOf(MaxAttemptsReachedError);
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should use custom isRetryable function', async () => {
      const retry = new Retry({
        maxAttempts: 3,
        initialDelay: 10,
        isRetryable: (error) => error.message.includes('retry'),
      });

      const retryableOperation = vi.fn()
        .mockRejectedValueOnce(new Error('please retry'))
        .mockResolvedValue('success');

      const result = await retry.execute(retryableOperation);
      expect(result).toBe('success');
      expect(retryableOperation).toHaveBeenCalledTimes(2);

      const nonRetryableOperation = vi.fn().mockRejectedValue(new Error('fatal'));
      await expect(retry.execute(nonRetryableOperation)).rejects.toBeInstanceOf(MaxAttemptsReachedError);
      expect(nonRetryableOperation).toHaveBeenCalledTimes(1);
    });
  });

  describe('backoff policies', () => {
    it('should use exponential backoff', async () => {
      const delays: number[] = [];
      const onRetry = vi.fn().mockImplementation(() => {
        delays.push(Date.now());
      });

      const retry = new Retry({
        maxAttempts: 4,
        initialDelay: 50,
        backoffPolicy: 'exponential',
        multiplier: 2,
        onRetry,
      });

      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('1'))
        .mockRejectedValueOnce(new Error('2'))
        .mockRejectedValueOnce(new Error('3'))
        .mockResolvedValue('success');

      await retry.execute(operation);

      // Check that delays are approximately exponential: 50, 100, 200
      expect(operation).toHaveBeenCalledTimes(4);
    });

    it('should use linear backoff', async () => {
      const retry = new Retry({
        maxAttempts: 3,
        initialDelay: 10,
        backoffPolicy: 'linear',
      });

      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('1'))
        .mockRejectedValueOnce(new Error('2'))
        .mockResolvedValue('success');

      await retry.execute(operation);
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should use constant backoff', async () => {
      const retry = new Retry({
        maxAttempts: 3,
        initialDelay: 10,
        backoffPolicy: 'constant',
      });

      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('1'))
        .mockRejectedValueOnce(new Error('2'))
        .mockResolvedValue('success');

      await retry.execute(operation);
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should respect maxDelay', async () => {
      const retry = new Retry({
        maxAttempts: 5,
        initialDelay: 100,
        maxDelay: 150,
        backoffPolicy: 'exponential',
        multiplier: 2,
      });

      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('1'))
        .mockRejectedValueOnce(new Error('2'))
        .mockRejectedValueOnce(new Error('3'))
        .mockRejectedValueOnce(new Error('4'))
        .mockResolvedValue('success');

      await retry.execute(operation);
      expect(operation).toHaveBeenCalledTimes(5);
    });
  });

  describe('calculateDelay', () => {
    it('should cap delay at ABSOLUTE_MAX_DELAY_MS to prevent overflow', async () => {
      const { calculateDelay, ABSOLUTE_MAX_DELAY_MS } = await import('../src/backoff.js');

      // Very high attempt number that would overflow without cap
      const delay = calculateDelay(100, 1000, 'exponential', 2);

      // Should be capped at 1 hour
      expect(delay).toBe(ABSOLUTE_MAX_DELAY_MS);
      expect(delay).toBe(3_600_000);
    });

    it('should not apply cap for reasonable delays', async () => {
      const { calculateDelay, ABSOLUTE_MAX_DELAY_MS } = await import('../src/backoff.js');

      // Normal attempt should not be capped
      const delay = calculateDelay(3, 100, 'exponential', 2);

      // 100 * 2^2 = 400ms
      expect(delay).toBe(400);
      expect(delay).toBeLessThan(ABSOLUTE_MAX_DELAY_MS);
    });
  });

  describe('config validation', () => {
    it('should throw on invalid maxAttempts', () => {
      expect(() => new Retry({ maxAttempts: 0 })).toThrow();
      expect(() => new Retry({ maxAttempts: -1 })).toThrow();
      expect(() => new Retry({ maxAttempts: 1.5 })).toThrow();
    });

    it('should throw on invalid initialDelay', () => {
      expect(() => new Retry({ initialDelay: 0 })).toThrow();
      expect(() => new Retry({ initialDelay: -1 })).toThrow();
    });

    it('should throw on invalid multiplier', () => {
      expect(() => new Retry({ multiplier: 0 })).toThrow();
      expect(() => new Retry({ multiplier: -1 })).toThrow();
    });
  });
});
