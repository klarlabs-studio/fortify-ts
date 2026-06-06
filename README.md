# Fortify TS

Production-grade resilience and fault-tolerance library for TypeScript.

[![CI](https://github.com/klarlabs-studio/fortify-ts/actions/workflows/ci.yml/badge.svg)](https://github.com/klarlabs-studio/fortify-ts/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org)

## Features

- **Circuit Breaker** - Prevent cascading failures with automatic recovery
- **Retry** - Intelligent retry with exponential backoff and jitter
- **Rate Limiter** - Token bucket rate limiting with per-key support
- **Timeout** - Enforce time limits on async operations
- **Bulkhead** - Limit concurrent operations with optional queuing
- **Fallback** - Graceful degradation when primary operations fail
- **Middleware Chain** - Compose resilience patterns fluently

## Installation

```bash
# Install individual packages
pnpm add @fortify-ts/circuit-breaker
pnpm add @fortify-ts/retry
pnpm add @fortify-ts/rate-limit
pnpm add @fortify-ts/timeout
pnpm add @fortify-ts/bulkhead
pnpm add @fortify-ts/fallback
pnpm add @fortify-ts/middleware

# Or install all core patterns
pnpm add @fortify-ts/core @fortify-ts/circuit-breaker @fortify-ts/retry @fortify-ts/rate-limit @fortify-ts/timeout @fortify-ts/bulkhead @fortify-ts/fallback @fortify-ts/middleware
```

## Quick Start

### Circuit Breaker

```typescript
import { CircuitBreaker } from '@fortify-ts/circuit-breaker';

const breaker = new CircuitBreaker({
  maxFailures: 5,
  timeout: 60000, // 60 seconds before attempting recovery
  onStateChange: (from, to) => console.log(`State: ${from} -> ${to}`),
});

const result = await breaker.execute(async (signal) => {
  return await fetch('https://api.example.com/data', { signal });
});
```

### Retry with Backoff

```typescript
import { Retry } from '@fortify-ts/retry';

const retry = new Retry({
  maxAttempts: 3,
  initialDelay: 100,
  backoffPolicy: 'exponential',
  multiplier: 2,
  jitter: true,
  onRetry: (attempt, error) => console.log(`Retry ${attempt}: ${error.message}`),
});

const result = await retry.execute(async (signal) => {
  return await fetchWithTimeout('/api/data', { signal });
});
```

### Rate Limiter

```typescript
import { RateLimiter } from '@fortify-ts/rate-limit';

const limiter = new RateLimiter({
  rate: 100, // 100 requests
  interval: 1000, // per second
  burst: 150, // allow bursts up to 150
});

if (limiter.allow('user-123')) {
  // Process request
}

// Or wait for a slot
await limiter.wait('user-123');
```

### Composing Patterns

```typescript
import { Chain } from '@fortify-ts/middleware';
import { CircuitBreaker } from '@fortify-ts/circuit-breaker';
import { Retry } from '@fortify-ts/retry';
import { Timeout } from '@fortify-ts/timeout';

const chain = new Chain()
  .withTimeout(new Timeout({ defaultTimeout: 5000 }), 5000)
  .withCircuitBreaker(new CircuitBreaker({ maxFailures: 3 }))
  .withRetry(new Retry({ maxAttempts: 3 }));

const result = await chain.execute(async (signal) => {
  return await fetch('/api/data', { signal });
});
```

## Packages

| Package | Description | Browser |
|---------|-------------|---------|
| `@fortify-ts/core` | Shared types, errors, utilities | ✅ |
| `@fortify-ts/circuit-breaker` | Circuit breaker pattern | ✅ |
| `@fortify-ts/retry` | Retry with backoff strategies | ✅ |
| `@fortify-ts/rate-limit` | Token bucket rate limiter | ✅ |
| `@fortify-ts/timeout` | Timeout wrapper | ✅ |
| `@fortify-ts/bulkhead` | Concurrency limiter with queue | ✅ |
| `@fortify-ts/fallback` | Fallback pattern | ✅ |
| `@fortify-ts/middleware` | Pattern composition chain | ✅ |
| `@fortify-ts/http` | Framework-agnostic HTTP utilities | ✅ |
| `@fortify-ts/logging` | Structured logging adapters | ✅* |
| `@fortify-ts/metrics` | Prometheus metrics | ❌ |
| `@fortify-ts/tracing` | OpenTelemetry tracing | ✅* |
| `@fortify-ts/testing` | Chaos engineering utilities | ✅ |

\* Console adapter for browser, full features in Node.js

## Observability

### Logging

```typescript
import { createPinoLogger } from '@fortify-ts/logging';
import pino from 'pino';

const logger = createPinoLogger(pino());
const breaker = new CircuitBreaker({ logger });
```

### Metrics

```typescript
import { createMetricsCollector, withMetrics } from '@fortify-ts/metrics';

const collector = createMetricsCollector();
const breaker = withMetrics(new CircuitBreaker(), collector, { name: 'api' });
```

### Tracing

```typescript
import { withTracing } from '@fortify-ts/tracing';
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('my-service');
const breaker = withTracing(new CircuitBreaker(), { tracer });
```

## Testing

```typescript
import { createFlakeyService, createErrorInjector } from '@fortify-ts/testing';

const flakey = createFlakeyService({
  errorRate: 0.3,
  minLatencyMs: 10,
  maxLatencyMs: 100,
});

// Test your resilience patterns
const result = await breaker.execute(flakey(async () => fetchData()));
```

## Browser Support

All core packages are browser-compatible and use:
- `AbortController`/`AbortSignal` for cancellation
- `Promise` for async operations
- `Map` for key-value storage
- No Node.js-specific APIs

## TypeScript

Fortify TS is written in TypeScript and provides full type safety:
- Generic types for operation results
- Zod schemas for runtime configuration validation
- Strict null checks and exhaustive type checking

## Inspired By

This library is a TypeScript port of [fortify](https://github.com/klarlabs-studio/fortify), a Go resilience library implementing similar patterns.

## Requirements

- Node.js 20+
- TypeScript 5.0+ (for development)

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Run linting
pnpm lint

# Type check
pnpm typecheck

# Format code
pnpm format
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT
