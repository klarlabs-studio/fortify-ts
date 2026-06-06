import { FortifyError } from '@klarlabs-studio/fortify-core';

/**
 * Base error class for rate limiter errors.
 */
export class RateLimiterError extends FortifyError {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimiterError';
  }
}

/**
 * Error thrown when storage is unavailable or unreachable.
 * This typically indicates a connection or infrastructure issue.
 */
export class StorageUnavailableError extends RateLimiterError {
  public override readonly cause: Error | undefined;

  constructor(message = 'Storage is unavailable', cause?: Error) {
    super(message);
    this.name = 'StorageUnavailableError';
    this.cause = cause;
  }
}

/** Maximum length for key preview in error messages (to prevent PII exposure) */
const KEY_PREVIEW_LENGTH = 20;

/**
 * Error thrown when a storage key exceeds the maximum allowed length.
 * The key is truncated in the error to prevent potential PII exposure in logs.
 */
export class KeyTooLongError extends RateLimiterError {
  /** Truncated key preview (first 20 chars + '...' if longer) */
  public readonly keyPreview: string;
  public readonly keyLength: number;
  public readonly maxLength: number;

  constructor(key: string, maxLength: number) {
    const keyPreview =
      key.length > KEY_PREVIEW_LENGTH
        ? `${key.slice(0, KEY_PREVIEW_LENGTH)}...`
        : key;
    super(
      `Key length ${String(key.length)} exceeds maximum ${String(maxLength)} (key: "${keyPreview}")`
    );
    this.name = 'KeyTooLongError';
    this.keyPreview = keyPreview;
    this.keyLength = key.length;
    this.maxLength = maxLength;
  }
}

/**
 * Error thrown when a storage operation times out.
 */
export class StorageTimeoutError extends RateLimiterError {
  public readonly operationName: string;
  public readonly timeoutMs: number;

  constructor(operationName: string, timeoutMs: number) {
    super(`Storage operation '${operationName}' timed out after ${String(timeoutMs)}ms`);
    this.name = 'StorageTimeoutError';
    this.operationName = operationName;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Error thrown when bucket state from storage is invalid or corrupted.
 */
export class InvalidBucketStateError extends RateLimiterError {
  public readonly key: string;

  constructor(key: string, message = 'Invalid bucket state from storage') {
    super(message);
    this.name = 'InvalidBucketStateError';
    this.key = key;
  }
}

/**
 * Error thrown when the requested tokens exceed the maximum allowed per request.
 */
export class TokensExceededError extends RateLimiterError {
  public readonly requested: number;
  public readonly maximum: number;

  constructor(requested: number, maximum: number) {
    super(`Requested tokens ${String(requested)} exceeds maximum ${String(maximum)}`);
    this.name = 'TokensExceededError';
    this.requested = requested;
    this.maximum = maximum;
  }
}

/**
 * Error thrown when a health check fails.
 */
export class HealthCheckError extends RateLimiterError {
  public override readonly cause: Error | undefined;

  constructor(message = 'Health check failed', cause?: Error) {
    super(message);
    this.name = 'HealthCheckError';
    this.cause = cause;
  }
}
