import {
  type Registry,
  type Counter,
  type Gauge,
  type Histogram,
  type Labels,
} from './types.js';

/**
 * Fortify metrics collector interface.
 *
 * Provides all metrics for resilience pattern monitoring.
 */
export interface MetricsCollector {
  // Circuit Breaker metrics
  circuitBreakerState: Gauge;
  circuitBreakerRequests: Counter;
  circuitBreakerSuccesses: Counter;
  circuitBreakerFailures: Counter;
  circuitBreakerStateChanges: Counter;

  // Retry metrics
  retryAttempts: Histogram;
  retrySuccesses: Counter;
  retryFailures: Counter;
  retryDuration: Histogram;

  // Rate Limiter metrics
  rateLimitAllowed: Counter;
  rateLimitDenied: Counter;
  rateLimitWaitTime: Histogram;

  // Timeout metrics
  timeoutExecutions: Counter;
  timeoutExceeded: Counter;
  timeoutDuration: Histogram;

  // Bulkhead metrics
  bulkheadActive: Gauge;
  bulkheadQueued: Gauge;
  bulkheadRejected: Counter;
  bulkheadSuccesses: Counter;
  bulkheadFailures: Counter;
  bulkheadDuration: Histogram;

  // Fallback metrics
  fallbackExecutions: Counter;
  fallbackActivated: Counter;
}

/**
 * Configuration for creating a metrics collector.
 */
export interface MetricsCollectorConfig {
  /** Prometheus registry (uses default if not provided) */
  registry?: Registry;
  /** Metric name prefix */
  prefix?: string;
  /** Default labels to apply to all metrics */
  defaultLabels?: Labels;
}

/**
 * Prometheus metric factory functions.
 */
export interface PromClientFactories {
  Counter: new (config: {
    name: string;
    help: string;
    labelNames?: string[];
    registers?: Registry[];
  }) => Counter;
  Gauge: new (config: {
    name: string;
    help: string;
    labelNames?: string[];
    registers?: Registry[];
  }) => Gauge;
  Histogram: new (config: {
    name: string;
    help: string;
    labelNames?: string[];
    buckets?: number[];
    registers?: Registry[];
  }) => Histogram;
}

/**
 * Default histogram buckets for duration metrics (in seconds).
 */
export const DEFAULT_DURATION_BUCKETS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

/**
 * Default histogram buckets for retry attempt counts.
 */
export const DEFAULT_ATTEMPT_BUCKETS = [1, 2, 3, 4, 5, 10];

/**
 * Create a metrics collector using prom-client.
 *
 * @param promClient - prom-client module
 * @param config - Collector configuration
 * @returns Metrics collector instance
 *
 * @example
 * ```typescript
 * import * as promClient from 'prom-client';
 * import { createMetricsCollector } from '@klarlabs-studio/fortify-metrics';
 *
 * const metrics = createMetricsCollector(promClient, {
 *   prefix: 'myapp_',
 * });
 * ```
 */
export function createMetricsCollector(
  promClient: PromClientFactories & { register?: Registry },
  config: MetricsCollectorConfig = {}
): MetricsCollector {
  const prefix = config.prefix ?? 'fortify_';
  const registry = config.registry;

  // Use conditional spread to avoid exactOptionalPropertyTypes issues
  // Only include registers property when a registry is provided
  const registersConfig = registry ? { registers: [registry] } : {};

  const { Counter, Gauge, Histogram } = promClient;

  // Common label names
  const nameLabelNames = ['name'];

  return {
    // Circuit Breaker metrics
    circuitBreakerState: new Gauge({
      name: `${prefix}circuit_breaker_state`,
      help: 'Current state of circuit breaker (0=closed, 1=open, 2=half-open)',
      labelNames: nameLabelNames,
      ...registersConfig,
    }),

    circuitBreakerRequests: new Counter({
      name: `${prefix}circuit_breaker_requests_total`,
      help: 'Total number of requests through circuit breaker',
      labelNames: nameLabelNames,
      ...registersConfig,
    }),

    circuitBreakerSuccesses: new Counter({
      name: `${prefix}circuit_breaker_successes_total`,
      help: 'Total number of successful requests through circuit breaker',
      labelNames: nameLabelNames,
      ...registersConfig,
    }),

    circuitBreakerFailures: new Counter({
      name: `${prefix}circuit_breaker_failures_total`,
      help: 'Total number of failed requests through circuit breaker',
      labelNames: nameLabelNames,
      ...registersConfig,
    }),

    circuitBreakerStateChanges: new Counter({
      name: `${prefix}circuit_breaker_state_changes_total`,
      help: 'Total number of circuit breaker state changes',
      labelNames: ['name', 'from', 'to'],
      ...registersConfig,
    }),

    // Retry metrics
    retryAttempts: new Histogram({
      name: `${prefix}retry_attempts`,
      help: 'Distribution of retry attempts before success or failure',
      labelNames: ['name', 'outcome'],
      buckets: DEFAULT_ATTEMPT_BUCKETS,
      ...registersConfig,
    }),

    retrySuccesses: new Counter({
      name: `${prefix}retry_successes_total`,
      help: 'Total number of successful retries',
      labelNames: nameLabelNames,
      ...registersConfig,
    }),

    retryFailures: new Counter({
      name: `${prefix}retry_failures_total`,
      help: 'Total number of failed retries (max attempts reached)',
      labelNames: nameLabelNames,
      ...registersConfig,
    }),

    retryDuration: new Histogram({
      name: `${prefix}retry_duration_seconds`,
      help: 'Duration of retry operations',
      labelNames: ['name', 'outcome'],
      buckets: DEFAULT_DURATION_BUCKETS,
      ...registersConfig,
    }),

    // Rate Limiter metrics
    rateLimitAllowed: new Counter({
      name: `${prefix}rate_limit_allowed_total`,
      help: 'Total number of allowed requests',
      labelNames: ['name', 'key'],
      ...registersConfig,
    }),

    rateLimitDenied: new Counter({
      name: `${prefix}rate_limit_denied_total`,
      help: 'Total number of denied requests',
      labelNames: ['name', 'key'],
      ...registersConfig,
    }),

    rateLimitWaitTime: new Histogram({
      name: `${prefix}rate_limit_wait_seconds`,
      help: 'Time spent waiting for rate limit token',
      labelNames: ['name', 'key'],
      buckets: DEFAULT_DURATION_BUCKETS,
      ...registersConfig,
    }),

    // Timeout metrics
    timeoutExecutions: new Counter({
      name: `${prefix}timeout_executions_total`,
      help: 'Total number of timeout-wrapped executions',
      labelNames: nameLabelNames,
      ...registersConfig,
    }),

    timeoutExceeded: new Counter({
      name: `${prefix}timeout_exceeded_total`,
      help: 'Total number of timeouts exceeded',
      labelNames: nameLabelNames,
      ...registersConfig,
    }),

    timeoutDuration: new Histogram({
      name: `${prefix}timeout_duration_seconds`,
      help: 'Duration of timeout-wrapped operations',
      labelNames: ['name', 'outcome'],
      buckets: DEFAULT_DURATION_BUCKETS,
      ...registersConfig,
    }),

    // Bulkhead metrics
    bulkheadActive: new Gauge({
      name: `${prefix}bulkhead_active`,
      help: 'Current number of active executions in bulkhead',
      labelNames: nameLabelNames,
      ...registersConfig,
    }),

    bulkheadQueued: new Gauge({
      name: `${prefix}bulkhead_queued`,
      help: 'Current number of queued executions in bulkhead',
      labelNames: nameLabelNames,
      ...registersConfig,
    }),

    bulkheadRejected: new Counter({
      name: `${prefix}bulkhead_rejected_total`,
      help: 'Total number of rejected executions',
      labelNames: nameLabelNames,
      ...registersConfig,
    }),

    bulkheadSuccesses: new Counter({
      name: `${prefix}bulkhead_successes_total`,
      help: 'Total number of successful executions',
      labelNames: nameLabelNames,
      ...registersConfig,
    }),

    bulkheadFailures: new Counter({
      name: `${prefix}bulkhead_failures_total`,
      help: 'Total number of failed executions',
      labelNames: nameLabelNames,
      ...registersConfig,
    }),

    bulkheadDuration: new Histogram({
      name: `${prefix}bulkhead_duration_seconds`,
      help: 'Duration of bulkhead-wrapped operations',
      labelNames: ['name', 'outcome'],
      buckets: DEFAULT_DURATION_BUCKETS,
      ...registersConfig,
    }),

    // Fallback metrics
    fallbackExecutions: new Counter({
      name: `${prefix}fallback_executions_total`,
      help: 'Total number of fallback-wrapped executions',
      labelNames: nameLabelNames,
      ...registersConfig,
    }),

    fallbackActivated: new Counter({
      name: `${prefix}fallback_activated_total`,
      help: 'Total number of times fallback was activated',
      labelNames: nameLabelNames,
      ...registersConfig,
    }),
  };
}
