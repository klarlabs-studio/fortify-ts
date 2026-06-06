import { describe, it, expect, vi } from 'vitest';
import { Timeout } from '../src/timeout.js';
import { TimeoutError, type Pattern } from '@klarlabs-studio/fortify-core';

describe('Timeout', () => {
  describe('Pattern<T> compliance', () => {
    it('should implement Pattern<T> interface', () => {
      const timeout = new Timeout<string>({ defaultTimeout: 1000 });

      // TypeScript should allow this assignment if Pattern<T> is implemented
      const pattern: Pattern<string> = timeout;
      expect(pattern.execute).toBeDefined();
    });

    it('should work with Pattern<T> signature', async () => {
      const timeout = new Timeout<string>({ defaultTimeout: 1000 });
      const pattern: Pattern<string> = timeout;

      const result = await pattern.execute(async () => 'success');
      expect(result).toBe('success');
    });

    it('should work with Pattern<T> signature and signal', async () => {
      const timeout = new Timeout<string>({ defaultTimeout: 1000 });
      const pattern: Pattern<string> = timeout;
      const controller = new AbortController();

      const result = await pattern.execute(async () => 'success', controller.signal);
      expect(result).toBe('success');
    });
  });

  describe('constructor', () => {
    it('should create with default config', () => {
      const timeout = new Timeout();
      expect(timeout.getDefaultTimeout()).toBe(30000);
    });

    it('should create with custom timeout', () => {
      const timeout = new Timeout({ defaultTimeout: 5000 });
      expect(timeout.getDefaultTimeout()).toBe(5000);
    });
  });

  describe('execute', () => {
    it('should resolve if operation completes before timeout', async () => {
      const timeout = new Timeout({ defaultTimeout: 1000 });
      const operation = vi.fn().mockResolvedValue('success');

      const result = await timeout.execute(operation);

      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should pass AbortSignal to operation', async () => {
      const timeout = new Timeout({ defaultTimeout: 1000 });
      let receivedSignal: AbortSignal | undefined;

      await timeout.execute(async (signal) => {
        receivedSignal = signal;
        return 'success';
      });

      expect(receivedSignal).toBeInstanceOf(AbortSignal);
      expect(receivedSignal?.aborted).toBe(false);
    });

    it('should reject with TimeoutError if operation exceeds timeout', async () => {
      const timeout = new Timeout({ defaultTimeout: 50 });

      const operation = async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return 'success';
      };

      await expect(timeout.execute(operation)).rejects.toBeInstanceOf(TimeoutError);
    });

    it('should use custom timeout when provided via executeWithTimeout', async () => {
      const timeout = new Timeout({ defaultTimeout: 1000 });

      const operation = async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return 'success';
      };

      // Should timeout with 50ms override
      await expect(timeout.executeWithTimeout(operation, 50)).rejects.toBeInstanceOf(TimeoutError);
    });

    it('should reject immediately if external signal is already aborted', async () => {
      const timeout = new Timeout({ defaultTimeout: 1000 });
      const controller = new AbortController();
      controller.abort();

      const operation = vi.fn().mockResolvedValue('success');

      await expect(
        timeout.execute(operation, controller.signal)
      ).rejects.toThrow();
      expect(operation).not.toHaveBeenCalled();
    });

    it('should abort operation when external signal is aborted', async () => {
      const timeout = new Timeout({ defaultTimeout: 5000 });
      const controller = new AbortController();

      let operationAborted = false;
      const operation = async (signal: AbortSignal) => {
        return new Promise<string>((resolve, reject) => {
          const timeoutId = setTimeout(() => resolve('success'), 1000);
          signal.addEventListener('abort', () => {
            clearTimeout(timeoutId);
            operationAborted = true;
            reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
          }, { once: true });
        });
      };

      const promise = timeout.execute(operation, controller.signal);

      // Abort after a short delay
      setTimeout(() => controller.abort(), 50);

      await expect(promise).rejects.toThrow();
      expect(operationAborted).toBe(true);
    });

    it('should call onTimeout callback when timeout occurs', async () => {
      const onTimeout = vi.fn();
      const timeout = new Timeout({ defaultTimeout: 50, onTimeout });

      const operation = async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return 'success';
      };

      await expect(timeout.execute(operation)).rejects.toBeInstanceOf(TimeoutError);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it('should not call onTimeout callback when operation succeeds', async () => {
      const onTimeout = vi.fn();
      const timeout = new Timeout({ defaultTimeout: 1000, onTimeout });

      await timeout.execute(async () => 'success');

      expect(onTimeout).not.toHaveBeenCalled();
    });

    it('should catch errors from onTimeout callback', async () => {
      const onTimeout = vi.fn().mockImplementation(() => {
        throw new Error('callback error');
      });
      const timeout = new Timeout({ defaultTimeout: 50, onTimeout });

      const operation = async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return 'success';
      };

      // Should still throw TimeoutError, not callback error
      await expect(timeout.execute(operation)).rejects.toBeInstanceOf(TimeoutError);
      expect(onTimeout).toHaveBeenCalledTimes(1);
    });

    it('should propagate operation errors', async () => {
      const timeout = new Timeout({ defaultTimeout: 1000 });
      const error = new Error('operation error');

      const operation = vi.fn().mockRejectedValue(error);

      await expect(timeout.execute(operation)).rejects.toThrow('operation error');
    });
  });

  describe('config validation', () => {
    it('should throw on invalid defaultTimeout', () => {
      expect(() => new Timeout({ defaultTimeout: -1 })).toThrow();
      expect(() => new Timeout({ defaultTimeout: 0 })).toThrow();
      expect(() => new Timeout({ defaultTimeout: 1.5 })).toThrow();
    });

    it('should accept valid configuration', () => {
      expect(() => new Timeout({ defaultTimeout: 1 })).not.toThrow();
      expect(() => new Timeout({ defaultTimeout: 60000 })).not.toThrow();
    });
  });
});

describe('Timeout with logger', () => {
  it('should log debug messages', async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const timeout = new Timeout({ defaultTimeout: 1000, logger });
    await timeout.execute(async () => 'success');

    expect(logger.debug).toHaveBeenCalled();
  });

  it('should log warn on timeout', async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const timeout = new Timeout({ defaultTimeout: 50, logger });

    const operation = async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return 'success';
    };

    await expect(timeout.execute(operation)).rejects.toBeInstanceOf(TimeoutError);
    expect(logger.warn).toHaveBeenCalled();
  });
});
