# @klarlabs-studio/fortify-middleware

Middleware chain for composing resilience patterns in Fortify-TS.

## Installation

```bash
npm install @klarlabs-studio/fortify-middleware
# or
pnpm add @klarlabs-studio/fortify-middleware
```

## Features

- **Pattern Composition**: Combine multiple patterns in a chain
- **Fluent API**: Method chaining for easy configuration
- **Custom Middleware**: Add your own middleware functions
- **Execution Order**: Outer to inner (first added = outermost)

## Usage

### Basic Usage

```typescript
import { Chain } from '@klarlabs-studio/fortify-middleware';
import { CircuitBreaker } from '@klarlabs-studio/fortify-circuit-breaker';
import { Retry } from '@klarlabs-studio/fortify-retry';
import { Timeout } from '@klarlabs-studio/fortify-timeout';

const circuitBreaker = new CircuitBreaker({ maxFailures: 5 });
const retry = new Retry({ maxAttempts: 3 });
const timeout = new Timeout({ defaultTimeout: 5000 });

const chain = new Chain<Response>()
  .withCircuitBreaker(circuitBreaker)
  .withRetry(retry)
  .withTimeout(timeout);

const result = await chain.execute(async (signal) => {
  return fetch('/api/data', { signal });
});
```

### Full Pattern Stack

```typescript
import { Chain } from '@klarlabs-studio/fortify-middleware';
import { Bulkhead } from '@klarlabs-studio/fortify-bulkhead';
import { RateLimiter } from '@klarlabs-studio/fortify-rate-limit';
import { Timeout } from '@klarlabs-studio/fortify-timeout';
import { CircuitBreaker } from '@klarlabs-studio/fortify-circuit-breaker';
import { Retry } from '@klarlabs-studio/fortify-retry';
import { Fallback } from '@klarlabs-studio/fortify-fallback';

const chain = new Chain<Response>()
  .withBulkhead(bulkhead)           // 1st: Limit concurrency
  .withRateLimit(rateLimiter, key)  // 2nd: Rate limiting
  .withTimeout(timeout, 5000)       // 3rd: Timeout
  .withCircuitBreaker(circuitBreaker) // 4th: Circuit breaker
  .withRetry(retry)                 // 5th: Retry
  .withFallback(fallback);          // 6th: Fallback (innermost)

const result = await chain.execute(operation);
```

### Custom Middleware

```typescript
import { Chain, type Middleware } from '@klarlabs-studio/fortify-middleware';

// Custom logging middleware
const loggingMiddleware: Middleware<Response> = (next) => async (signal) => {
  console.log('Starting operation');
  const start = Date.now();
  try {
    const result = await next(signal);
    console.log(`Completed in ${Date.now() - start}ms`);
    return result;
  } catch (error) {
    console.log(`Failed in ${Date.now() - start}ms`);
    throw error;
  }
};

const chain = new Chain<Response>()
  .use(loggingMiddleware)
  .withRetry(retry);
```

### Execution Order

Middleware executes from first added (outermost) to last added (innermost):

```
Request Flow:
  Bulkhead → RateLimit → Timeout → CircuitBreaker → Retry → Fallback → Operation

Response Flow:
  Operation → Fallback → Retry → CircuitBreaker → Timeout → RateLimit → Bulkhead
```

## API Reference

| Method | Description |
|--------|-------------|
| `withCircuitBreaker(cb)` | Add circuit breaker |
| `withRetry(retry)` | Add retry |
| `withTimeout(timeout, duration?)` | Add timeout |
| `withRateLimit(rl, key?)` | Add rate limiting |
| `withBulkhead(bh)` | Add bulkhead |
| `withFallback(fb)` | Add fallback |
| `use(middleware)` | Add custom middleware |
| `execute(operation, signal?)` | Execute chain |

## License

MIT
