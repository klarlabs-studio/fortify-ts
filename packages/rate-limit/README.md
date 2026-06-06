# @klarlabs-studio/fortify-rate-limit

Token bucket rate limiter for the Fortify-TS resilience library.

## Installation

```bash
npm install @klarlabs-studio/fortify-rate-limit
# or
pnpm add @klarlabs-studio/fortify-rate-limit
```

## Features

- **Token Bucket Algorithm**: Smooth rate limiting with burst support
- **Per-Key Limiting**: Rate limit by user ID, IP, or custom key
- **External Storage**: Support for Redis, DynamoDB, or custom storage
- **Sync and Async APIs**: Both `allow()` and `allowAsync()` methods
- **Wait Support**: Block until tokens available with `wait()`

## Usage

### Basic Usage

```typescript
import { RateLimiter } from '@klarlabs-studio/fortify-rate-limit';

const limiter = new RateLimiter({
  rate: 100,      // 100 requests
  interval: 1000, // per second
});

// Check if request is allowed
if (limiter.allow('user-123')) {
  // Process request
} else {
  // Rate limited
}
```

### With Burst

```typescript
const limiter = new RateLimiter({
  rate: 10,       // 10 requests per second steady state
  burst: 50,      // Allow bursts up to 50 requests
  interval: 1000,
});
```

### Wait for Token

```typescript
// Block until token available (with timeout via signal)
await limiter.wait('user-123', signal);
// Token acquired, process request
```

### Execute with Rate Limiting

```typescript
// Throws RateLimitExceededError if rate limited
const result = await limiter.execute(
  async (signal) => fetch('/api/data', { signal }),
  'user-123'
);
```

### External Storage (Redis)

```typescript
import { RateLimiter, type RateLimitStorage } from '@klarlabs-studio/fortify-rate-limit';
import Redis from 'ioredis';

const redis = new Redis();

const storage: RateLimitStorage = {
  async get(key) {
    const data = await redis.get(`ratelimit:${key}`);
    return data ? JSON.parse(data) : null;
  },
  async set(key, state) {
    await redis.set(`ratelimit:${key}`, JSON.stringify(state), 'EX', 3600);
  },
  async delete(key) {
    await redis.del(`ratelimit:${key}`);
  },
};

const limiter = new RateLimiter({
  rate: 100,
  interval: 1000,
  storage,
});
```

### Configuration Options

```typescript
const limiter = new RateLimiter({
  // Requests per interval
  rate: 100,

  // Interval in milliseconds
  interval: 1000,

  // Maximum burst size (defaults to rate)
  burst: 200,

  // Tokens consumed per request
  tokensPerRequest: 1,

  // Maximum buckets in memory
  maxBuckets: 10000,

  // External storage adapter
  storage: myRedisStorage,

  // Storage timeout
  storageTimeoutMs: 1000,

  // Failure mode: 'fail-open' | 'fail-closed' | 'throw'
  storageFailureMode: 'fail-open',

  // Sanitize keys (prevents injection)
  sanitizeKeys: true,

  // Rate limit exceeded callback
  onLimit: (key) => console.log(`Rate limited: ${key}`),

  // Optional logger
  logger: myLogger,
});
```

## API Reference

| Method | Description |
|--------|-------------|
| `allow(key)` | Sync check if request allowed |
| `allowAsync(key)` | Async check with external storage |
| `wait(key, signal?)` | Wait for token availability |
| `execute(op, key, signal?)` | Execute with rate limiting |
| `getTokens(key)` | Get current token count |
| `reset(key)` | Reset bucket for key |
| `close()` | Clean up resources |

## Configuration Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `rate` | number | 100 | Requests per interval |
| `interval` | number | 1000 | Interval (ms) |
| `burst` | number | rate | Maximum burst |
| `tokensPerRequest` | number | 1 | Tokens per request |
| `maxBuckets` | number | 10000 | Max memory buckets |
| `storage` | RateLimitStorage | - | External storage |
| `storageTimeoutMs` | number | 1000 | Storage timeout |
| `storageFailureMode` | string | 'fail-open' | Failure handling |
| `sanitizeKeys` | boolean | true | Sanitize keys |
| `onLimit` | function | - | Rate limit callback |
| `logger` | FortifyLogger | - | Optional logger |

## License

MIT
