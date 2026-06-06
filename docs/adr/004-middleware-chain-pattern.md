# ADR-004: Middleware Chain Pattern

## Status

Accepted

## Context

Applications often need to combine multiple resilience patterns (e.g., circuit breaker + retry + timeout). We needed a composition mechanism that:

1. Allows combining patterns in a specific order
2. Provides a fluent API for easy configuration
3. Maintains type safety
4. Supports custom middleware for cross-cutting concerns

## Decision

We implemented a **Middleware Chain pattern** with the `Chain` class in `@klarlabs-studio/fortify-middleware`.

### Chain API

```typescript
const chain = new Chain<Response>()
  .withBulkhead(bulkhead)           // 1st: Outermost
  .withRateLimit(rateLimiter, key)
  .withTimeout(timeout, 5000)
  .withCircuitBreaker(circuitBreaker)
  .withRetry(retry)
  .withFallback(fallback)           // Last: Innermost
  .execute(operation);
```

### Middleware Type

```typescript
type Middleware<T> = (next: Operation<T>) => Operation<T>;
```

### Execution Order

Middleware executes from **first added (outermost) to last added (innermost)**:

```
Request:  Bulkhead → RateLimit → Timeout → CircuitBreaker → Retry → Fallback → Operation
Response: Operation → Fallback → Retry → CircuitBreaker → Timeout → RateLimit → Bulkhead
```

### Recommended Pattern Order

1. **Bulkhead** - Limit concurrency first to prevent resource exhaustion
2. **Rate Limit** - Apply rate limiting before expensive operations
3. **Timeout** - Fail fast if operation takes too long
4. **Circuit Breaker** - Prevent calls to failing services
5. **Retry** - Retry transient failures
6. **Fallback** - Provide fallback value if all else fails

## Consequences

### Positive

- **Composability**: Patterns combine naturally without tight coupling
- **Fluent API**: Method chaining provides readable, self-documenting code
- **Flexible ordering**: Patterns can be arranged in any order for different strategies
- **Custom middleware**: Users can add logging, metrics, or other cross-cutting concerns
- **Type safety**: Generic type parameter ensures type consistency through the chain

### Negative

- **Order matters**: Incorrect ordering can lead to unexpected behavior
- **Debugging complexity**: Errors may occur deep in the chain, making debugging harder
- **Memory overhead**: Each middleware creates closure, slight memory increase

### Neutral

- Each pattern must implement the Pattern interface to work with the chain
- The chain itself implements Pattern, allowing nested chains

## Alternatives Considered

### Decorator Pattern

```typescript
const decorated = withRetry(
  withTimeout(
    withCircuitBreaker(operation)
  )
);
```

**Rejected because:**
- Deeply nested, hard to read
- Order is reversed from reading order
- No type-safe pattern-specific configuration

### Configuration Object

```typescript
const executor = new ResilientExecutor({
  retry: { maxAttempts: 3 },
  timeout: { duration: 5000 },
  circuitBreaker: { maxFailures: 5 }
});
```

**Rejected because:**
- Fixed pattern order, no flexibility
- Harder to configure pattern-specific options
- Cannot add custom middleware

### Pipeline Pattern

```typescript
const pipeline = new Pipeline()
  .pipe(retry)
  .pipe(timeout)
  .pipe(circuitBreaker);
```

**Rejected because:**
- Generic `pipe` doesn't communicate intent
- No pattern-specific helper methods
- Less discoverable API

## Examples

### Basic Chain

```typescript
import { Chain } from '@klarlabs-studio/fortify-middleware';
import { CircuitBreaker } from '@klarlabs-studio/fortify-circuit-breaker';
import { Retry } from '@klarlabs-studio/fortify-retry';

const cb = new CircuitBreaker({ maxFailures: 5 });
const retry = new Retry({ maxAttempts: 3 });

const chain = new Chain<Response>()
  .withCircuitBreaker(cb)
  .withRetry(retry);

const result = await chain.execute(async (signal) => {
  return fetch('/api/data', { signal });
});
```

### Custom Middleware

```typescript
const loggingMiddleware: Middleware<Response> = (next) => async (signal) => {
  const start = Date.now();
  try {
    const result = await next(signal);
    console.log(`Success in ${Date.now() - start}ms`);
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

### Per-Key Rate Limiting

```typescript
async function handleRequest(userId: string) {
  return new Chain<Response>()
    .withRateLimit(rateLimiter, userId)  // Rate limit per user
    .withTimeout(timeout, 5000)
    .execute(fetchUserData);
}
```
