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
pnpm add @klarlabs-studio/fortify-circuit-breaker
pnpm add @klarlabs-studio/fortify-retry
pnpm add @klarlabs-studio/fortify-rate-limit
pnpm add @klarlabs-studio/fortify-timeout
pnpm add @klarlabs-studio/fortify-bulkhead
pnpm add @klarlabs-studio/fortify-fallback
pnpm add @klarlabs-studio/fortify-middleware

# Or install all core patterns
pnpm add @klarlabs-studio/fortify-core @klarlabs-studio/fortify-circuit-breaker @klarlabs-studio/fortify-retry @klarlabs-studio/fortify-rate-limit @klarlabs-studio/fortify-timeout @klarlabs-studio/fortify-bulkhead @klarlabs-studio/fortify-fallback @klarlabs-studio/fortify-middleware
```

## Quick Start

### Circuit Breaker

```typescript
import { CircuitBreaker } from '@klarlabs-studio/fortify-circuit-breaker';

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
import { Retry } from '@klarlabs-studio/fortify-retry';

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
import { RateLimiter } from '@klarlabs-studio/fortify-rate-limit';

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
import { Chain } from '@klarlabs-studio/fortify-middleware';
import { CircuitBreaker } from '@klarlabs-studio/fortify-circuit-breaker';
import { Retry } from '@klarlabs-studio/fortify-retry';
import { Timeout } from '@klarlabs-studio/fortify-timeout';

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
| `@klarlabs-studio/fortify-core` | Shared types, errors, utilities | ✅ |
| `@klarlabs-studio/fortify-circuit-breaker` | Circuit breaker pattern | ✅ |
| `@klarlabs-studio/fortify-retry` | Retry with backoff strategies | ✅ |
| `@klarlabs-studio/fortify-rate-limit` | Token bucket rate limiter | ✅ |
| `@klarlabs-studio/fortify-timeout` | Timeout wrapper | ✅ |
| `@klarlabs-studio/fortify-bulkhead` | Concurrency limiter with queue | ✅ |
| `@klarlabs-studio/fortify-fallback` | Fallback pattern | ✅ |
| `@klarlabs-studio/fortify-middleware` | Pattern composition chain | ✅ |
| `@klarlabs-studio/fortify-http` | Framework-agnostic HTTP utilities | ✅ |
| `@klarlabs-studio/fortify-logging` | Structured logging adapters | ✅* |
| `@klarlabs-studio/fortify-metrics` | Prometheus metrics | ❌ |
| `@klarlabs-studio/fortify-tracing` | OpenTelemetry tracing | ✅* |
| `@klarlabs-studio/fortify-testing` | Chaos engineering utilities | ✅ |

\* Console adapter for browser, full features in Node.js

## Observability

### Logging

```typescript
import { createPinoLogger } from '@klarlabs-studio/fortify-logging';
import pino from 'pino';

const logger = createPinoLogger(pino());
const breaker = new CircuitBreaker({ logger });
```

### Metrics

```typescript
import { createMetricsCollector, withMetrics } from '@klarlabs-studio/fortify-metrics';

const collector = createMetricsCollector();
const breaker = withMetrics(new CircuitBreaker(), collector, { name: 'api' });
```

### Tracing

```typescript
import { withTracing } from '@klarlabs-studio/fortify-tracing';
import { trace } from '@opentelemetry/api';

const tracer = trace.getTracer('my-service');
const breaker = withTracing(new CircuitBreaker(), { tracer });
```

## Testing

```typescript
import { createFlakeyService, createErrorInjector } from '@klarlabs-studio/fortify-testing';

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
