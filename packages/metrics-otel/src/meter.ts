import {
  metrics as otelMetrics,
  type Meter,
  type MeterProvider,
  type Counter,
  type Histogram,
  type Gauge,
} from '@opentelemetry/api';

/** OpenTelemetry instrumentation scope for all Fortify metrics. */
const INSTRUMENTATION_NAME = '@klarlabs-studio/fortify-metrics-otel';

/**
 * Records Fortify resilience-pattern metrics through the OpenTelemetry metrics
 * API. It is the TypeScript counterpart to the Go `metrics/otel` Meter and the
 * OTel sibling of the prom-client-based `@klarlabs-studio/fortify-metrics`
 * collector: the instrument set mirrors both so the same signals are reported
 * under provider-appropriate names (dotted for OTel).
 *
 * Sensitive payloads: instruments carry only pattern names, bucket keys, and
 * state labels — never operation arguments, results, or wrapped payloads. Keep
 * prompts, request bodies, PII, and credentials out of any custom attributes.
 *
 * @example
 * ```typescript
 * import { MetricsMeter } from '@klarlabs-studio/fortify-metrics-otel';
 *
 * const meter = new MetricsMeter(); // uses the global MeterProvider
 * meter.recordRetryDuration('planner', elapsedSeconds);
 * ```
 */
export class MetricsMeter {
  private readonly meter: Meter;

  // Circuit breaker.
  private readonly cbState: Gauge;
  private readonly cbRequests: Counter;
  private readonly cbFailures: Counter;
  private readonly cbSuccesses: Counter;
  private readonly cbStateChanges: Counter;

  // Retry.
  private readonly retryAttempts: Histogram;
  private readonly retrySuccesses: Counter;
  private readonly retryFailures: Counter;
  private readonly retryDuration: Histogram;

  // Rate limit.
  private readonly rlAllowed: Counter;
  private readonly rlDenied: Counter;
  private readonly rlWaitTime: Histogram;

  // Timeout.
  private readonly timeoutExecutions: Counter;
  private readonly timeoutExceeded: Counter;
  private readonly timeoutDuration: Histogram;

  // Bulkhead.
  private readonly bulkheadActive: Gauge;
  private readonly bulkheadQueued: Gauge;
  private readonly bulkheadRejected: Counter;
  private readonly bulkheadSuccesses: Counter;
  private readonly bulkheadFailures: Counter;
  private readonly bulkheadDuration: Histogram;

  /**
   * Create a MetricsMeter.
   *
   * @param provider - MeterProvider to source the meter from. Defaults to the
   *   global provider (`metrics.getMeterProvider()`), so a process that has
   *   already configured OTel can construct it with no arguments and have
   *   metrics flow to the same pipeline.
   */
  constructor(provider?: MeterProvider) {
    this.meter = (provider ?? otelMetrics).getMeter(INSTRUMENTATION_NAME);

    this.cbState = this.meter.createGauge('fortify.circuit_breaker.state', {
      description: 'Current circuit breaker state (0=closed, 1=open, 2=half-open)',
    });
    this.cbRequests = this.meter.createCounter('fortify.circuit_breaker.requests', {
      description: 'Total circuit breaker requests',
    });
    this.cbFailures = this.meter.createCounter('fortify.circuit_breaker.failures', {
      description: 'Total failed circuit breaker requests',
    });
    this.cbSuccesses = this.meter.createCounter('fortify.circuit_breaker.successes', {
      description: 'Total successful circuit breaker requests',
    });
    this.cbStateChanges = this.meter.createCounter('fortify.circuit_breaker.state_changes', {
      description: 'Total circuit breaker state changes',
    });

    this.retryAttempts = this.meter.createHistogram('fortify.retry.attempts', {
      description: 'Number of retry attempts made',
    });
    this.retrySuccesses = this.meter.createCounter('fortify.retry.successes', {
      description: 'Total successful retries',
    });
    this.retryFailures = this.meter.createCounter('fortify.retry.failures', {
      description: 'Total failed retries',
    });
    this.retryDuration = this.meter.createHistogram('fortify.retry.duration', {
      description: 'Duration of retry operations',
      unit: 's',
    });

    this.rlAllowed = this.meter.createCounter('fortify.rate_limit.allowed', {
      description: 'Total allowed rate-limited requests',
    });
    this.rlDenied = this.meter.createCounter('fortify.rate_limit.denied', {
      description: 'Total denied rate-limited requests',
    });
    this.rlWaitTime = this.meter.createHistogram('fortify.rate_limit.wait_duration', {
      description: 'Time spent waiting for a rate-limit token',
      unit: 's',
    });

    this.timeoutExecutions = this.meter.createCounter('fortify.timeout.executions', {
      description: 'Total timeout-guarded executions',
    });
    this.timeoutExceeded = this.meter.createCounter('fortify.timeout.exceeded', {
      description: 'Total executions that exceeded their timeout',
    });
    this.timeoutDuration = this.meter.createHistogram('fortify.timeout.duration', {
      description: 'Duration of timeout-guarded operations',
      unit: 's',
    });

    this.bulkheadActive = this.meter.createGauge('fortify.bulkhead.active', {
      description: 'Current number of active bulkhead requests',
    });
    this.bulkheadQueued = this.meter.createGauge('fortify.bulkhead.queued', {
      description: 'Current number of queued bulkhead requests',
    });
    this.bulkheadRejected = this.meter.createCounter('fortify.bulkhead.rejected', {
      description: 'Total rejected bulkhead requests',
    });
    this.bulkheadSuccesses = this.meter.createCounter('fortify.bulkhead.successes', {
      description: 'Total successful bulkhead requests',
    });
    this.bulkheadFailures = this.meter.createCounter('fortify.bulkhead.failures', {
      description: 'Total failed bulkhead requests',
    });
    this.bulkheadDuration = this.meter.createHistogram('fortify.bulkhead.duration', {
      description: 'Duration of bulkhead operations',
      unit: 's',
    });
  }

  // --- Circuit breaker ---

  /** Record the current circuit breaker state (0=closed, 1=open, 2=half-open). */
  recordCircuitBreakerState(name: string, state: number): void {
    this.cbState.record(state, { name });
  }

  /** Increment the request counter, labeled by admission-time state. */
  recordCircuitBreakerRequest(name: string, state: string): void {
    this.cbRequests.add(1, { name, state });
  }

  /** Increment the failure counter. */
  recordCircuitBreakerFailure(name: string): void {
    this.cbFailures.add(1, { name });
  }

  /** Increment the success counter. */
  recordCircuitBreakerSuccess(name: string): void {
    this.cbSuccesses.add(1, { name });
  }

  /** Increment the state-change counter, labeled with from/to states. */
  recordCircuitBreakerStateChange(name: string, from: string, to: string): void {
    this.cbStateChanges.add(1, { name, from, to });
  }

  // --- Retry ---

  /** Record the number of attempts a retry sequence made. */
  recordRetryAttempts(name: string, attempts: number): void {
    this.retryAttempts.record(attempts, { name });
  }

  /** Increment the retry-success counter. */
  recordRetrySuccess(name: string): void {
    this.retrySuccesses.add(1, { name });
  }

  /** Increment the retry-failure counter. */
  recordRetryFailure(name: string): void {
    this.retryFailures.add(1, { name });
  }

  /** Record the duration of a retry sequence, in seconds. */
  recordRetryDuration(name: string, seconds: number): void {
    this.retryDuration.record(seconds, { name });
  }

  // --- Rate limit ---

  /** Increment the allowed counter for the given key. */
  recordRateLimitAllowed(name: string, key: string): void {
    this.rlAllowed.add(1, { name, key });
  }

  /** Increment the denied counter for the given key. */
  recordRateLimitDenied(name: string, key: string): void {
    this.rlDenied.add(1, { name, key });
  }

  /** Record the time spent waiting for a token, in seconds. */
  recordRateLimitWaitTime(name: string, key: string, seconds: number): void {
    this.rlWaitTime.record(seconds, { name, key });
  }

  // --- Timeout ---

  /** Increment the timeout-guarded execution counter. */
  recordTimeoutExecution(name: string): void {
    this.timeoutExecutions.add(1, { name });
  }

  /** Increment the timeout-exceeded counter. */
  recordTimeoutExceeded(name: string): void {
    this.timeoutExceeded.add(1, { name });
  }

  /** Record the duration of a timeout-guarded operation, labeled by exceeded. */
  recordTimeoutDuration(name: string, exceeded: boolean, seconds: number): void {
    this.timeoutDuration.record(seconds, { name, exceeded });
  }

  // --- Bulkhead ---

  /** Record the current number of active requests. */
  recordBulkheadActive(name: string, count: number): void {
    this.bulkheadActive.record(count, { name });
  }

  /** Record the current number of queued requests. */
  recordBulkheadQueued(name: string, count: number): void {
    this.bulkheadQueued.record(count, { name });
  }

  /** Increment the rejected counter. */
  recordBulkheadRejected(name: string): void {
    this.bulkheadRejected.add(1, { name });
  }

  /** Increment the success counter. */
  recordBulkheadSuccess(name: string): void {
    this.bulkheadSuccesses.add(1, { name });
  }

  /** Increment the failure counter. */
  recordBulkheadFailure(name: string): void {
    this.bulkheadFailures.add(1, { name });
  }

  /** Record the duration of a bulkhead operation, in seconds. */
  recordBulkheadDuration(name: string, seconds: number): void {
    this.bulkheadDuration.record(seconds, { name });
  }
}
