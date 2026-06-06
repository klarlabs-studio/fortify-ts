# @klarlabs-studio/fortify-core

Core types, errors, and utilities for the Fortify-TS resilience library.

## Installation

```bash
npm install @klarlabs-studio/fortify-core
# or
pnpm add @klarlabs-studio/fortify-core
```

## Features

- **Type Definitions**: `Operation<T>`, `Pattern<T>`, `Closeable`, `Resettable` interfaces
- **Error Hierarchy**: `FortifyError` and pattern-specific error classes
- **Utilities**: Signal combining, timeout helpers, jitter calculation
- **Validation**: Zod schemas for configuration validation
- **Storage**: In-memory storage with LRU eviction for rate limiting

## Usage

### Error Types

```typescript
import {
  FortifyError,
  CircuitOpenError,
  RateLimitExceededError,
  BulkheadFullError,
  TimeoutError,
  MaxAttemptsReachedError,
} from '@klarlabs-studio/fortify-core';

try {
  await pattern.execute(operation);
} catch (error) {
  if (error instanceof CircuitOpenError) {
    // Handle circuit open
  } else if (error instanceof RateLimitExceededError) {
    // Handle rate limit
  }
}
```

### Retryable Errors

```typescript
import { asRetryable, asNonRetryable, isRetryableError } from '@klarlabs-studio/fortify-core';

// Mark an error as retryable
throw asRetryable(new Error('Temporary failure'));

// Mark an error as non-retryable
throw asNonRetryable(new Error('Permanent failure'));

// Check if an error is retryable
if (isRetryableError(error)) {
  // Retry the operation
}
```

### Utilities

```typescript
import {
  sleep,
  withTimeout,
  combineSignals,
  throwIfAborted,
  NEVER_ABORTED_SIGNAL,
} from '@klarlabs-studio/fortify-core';

// Sleep with cancellation support
await sleep(1000, signal);

// Wrap a promise with timeout
const result = await withTimeout(fetchData(), 5000);

// Combine multiple abort signals
const combined = combineSignals(signal1, signal2);

// Check if signal is aborted
throwIfAborted(signal);
```

### Configuration Schemas

```typescript
import {
  retryConfigSchema,
  circuitBreakerConfigSchema,
  rateLimitConfigSchema,
  bulkheadConfigSchema,
} from '@klarlabs-studio/fortify-core';

// Validate and parse configuration
const config = retryConfigSchema.parse({
  maxAttempts: 5,
  initialDelay: 100,
});
```

## API Reference

### Types

- `Operation<T>` - Async function that accepts AbortSignal: `(signal: AbortSignal) => Promise<T>`
- `Pattern<T>` - Interface for resilience patterns with `execute()` method
- `Closeable` - Interface for patterns that need cleanup
- `Resettable` - Interface for patterns that can reset state

### Errors

| Error | Description |
|-------|-------------|
| `FortifyError` | Base class for all Fortify errors |
| `CircuitOpenError` | Circuit breaker is open |
| `RateLimitExceededError` | Rate limit exceeded |
| `BulkheadFullError` | Bulkhead at capacity |
| `BulkheadClosedError` | Bulkhead has been closed |
| `TimeoutError` | Operation timed out |
| `MaxAttemptsReachedError` | All retry attempts exhausted |

### Utilities

| Function | Description |
|----------|-------------|
| `sleep(ms, signal?)` | Async sleep with cancellation |
| `withTimeout(promise, ms, signal?)` | Add timeout to promise |
| `executeWithTimeout(operation, ms, signal?)` | Execute operation with timeout |
| `combineSignals(...signals)` | Combine multiple AbortSignals |
| `throwIfAborted(signal)` | Throw if signal is aborted |
| `isAbortError(error)` | Check if error is AbortError |

## License

MIT
