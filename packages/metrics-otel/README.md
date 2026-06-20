# @klarlabs-studio/fortify-metrics-otel

OpenTelemetry **metrics** adapter for the Fortify-TS resilience library.

This is the OTel sibling of `@klarlabs-studio/fortify-metrics` (which targets
Prometheus / prom-client) and the metrics counterpart to
`@klarlabs-studio/fortify-tracing` (which emits spans). It mirrors the Go
`fortify/metrics/otel` package.

## Installation

```bash
npm install @klarlabs-studio/fortify-metrics-otel @opentelemetry/api
# or
pnpm add @klarlabs-studio/fortify-metrics-otel @opentelemetry/api
```

`@opentelemetry/api` is an optional peer dependency — install it alongside this
package.

## Usage

```typescript
import { MetricsMeter } from '@klarlabs-studio/fortify-metrics-otel';

// Uses the global MeterProvider configured by your OTel SDK setup.
const meter = new MetricsMeter();

// Record from pattern callbacks:
meter.recordRetryDuration('planner', elapsedSeconds);
meter.recordCircuitBreakerStateChange('llm', 'closed', 'open');
meter.recordBulkheadActive('embeddings', activeCount);
```

Pass an explicit `MeterProvider` to the constructor to target a specific
pipeline instead of the global one.

## Instruments

Counters, histograms, and gauges are emitted under dotted `fortify.*` names for
the circuit breaker, retry, rate limit, timeout, and bulkhead patterns — the
same signal set as the Prometheus collector, named per OTel conventions
(e.g. `fortify.retry.duration`, `fortify.circuit_breaker.successes`,
`fortify.bulkhead.active`).

## Sensitive payloads

Instruments carry only pattern names, bucket keys, and state labels — never
operation arguments, results, or wrapped payloads. Keep prompts, request
bodies, PII, and credentials out of any custom attributes.

## License

MIT
