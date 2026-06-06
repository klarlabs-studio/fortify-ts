# @klarlabs-studio/fortify-retry

Retry pattern with configurable backoff strategies for the Fortify-TS resilience library.

## Installation

```bash
npm install @klarlabs-studio/fortify-retry
# or
pnpm add @klarlabs-studio/fortify-retry
```

## Features

- **Backoff Policies**: Exponential, linear, and constant
- **Configurable Delays**: Initial delay, max delay, multiplier
- **Jitter Support**: Prevent thundering herd
- **Custom Predicates**: `isRetryable` callback
- **Retry Notifications**: `onRetry` callback

## Usage

### Basic Usage

```typescript
import { Retry } from '@klarlabs-studio/fortify-retry';

const retry = new Retry<Response>({
  maxAttempts: 3,
  initialDelay: 100,
});

const result = await retry.execute(async (signal) => {
  return fetch('/api/data', { signal });
});
```

### Configuration Options

```typescript
const retry = new Retry<Response>({
  // Maximum attempts (including initial)
  maxAttempts: 5,

  // Initial delay between retries (ms)
  initialDelay: 100,

  // Maximum delay between retries (ms)
  maxDelay: 10000,

  // Backoff policy
  backoffPolicy: 'exponential', // 'exponential' | 'linear' | 'constant'

  // Delay multiplier for exponential/linear
  multiplier: 2.0,

  // Add random jitter to delays
  jitter: true,

  // Custom retry condition
  isRetryable: (error) => {
    if (error instanceof NetworkError) return true;
    if (error instanceof ValidationError) return false;
    return true;
  },

  // Retry notification
  onRetry: (error, attempt) => {
    console.log(`Retry ${attempt}: ${error.message}`);
  },

  // Optional logger
  logger: myLogger,
});
```

### Backoff Policies

```typescript
// Exponential: delay = initialDelay * (multiplier ^ attempt)
// 100ms → 200ms → 400ms → 800ms → 1600ms
const exponential = new Retry({ backoffPolicy: 'exponential' });

// Linear: delay = initialDelay * (multiplier * attempt)
// 100ms → 200ms → 300ms → 400ms → 500ms
const linear = new Retry({ backoffPolicy: 'linear' });

// Constant: delay = initialDelay
// 100ms → 100ms → 100ms → 100ms → 100ms
const constant = new Retry({ backoffPolicy: 'constant' });
```

### Marking Errors as Retryable

```typescript
import { asRetryable, asNonRetryable } from '@klarlabs-studio/fortify-core';

// In your code, mark errors explicitly
if (isTemporary) {
  throw asRetryable(new Error('Temporary failure'));
} else {
  throw asNonRetryable(new Error('Permanent failure'));
}
```

## Configuration Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxAttempts` | number | 3 | Maximum attempts |
| `initialDelay` | number | 100 | Initial delay (ms) |
| `maxDelay` | number | - | Maximum delay (ms) |
| `backoffPolicy` | string | 'exponential' | Backoff policy |
| `multiplier` | number | 2.0 | Delay multiplier |
| `jitter` | boolean | false | Add jitter |
| `isRetryable` | function | - | Custom retry check |
| `onRetry` | function | - | Retry callback |
| `logger` | FortifyLogger | - | Optional logger |

## License

MIT
