import { describe, it, expect } from 'vitest';
import {
  MeterProvider,
  InMemoryMetricExporter,
  PeriodicExportingMetricReader,
  AggregationTemporality,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import { MetricsMeter } from '../src/index.js';

const setup = (): {
  meter: MetricsMeter;
  collect: () => Promise<ResourceMetrics>;
} => {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const reader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: 60_000,
  });
  const provider = new MeterProvider({ readers: [reader] });
  const meter = new MetricsMeter(provider);

  const collect = async (): Promise<ResourceMetrics> => {
    const result = await reader.collect();
    return result.resourceMetrics;
  };

  return { meter, collect };
};

const findMetric = (rm: ResourceMetrics, name: string): boolean =>
  rm.scopeMetrics.some((sm) => sm.metrics.some((m) => m.descriptor.name === name));

describe('MetricsMeter', () => {
  it('records circuit breaker counters with the expected sum', async () => {
    const { meter, collect } = setup();
    meter.recordCircuitBreakerSuccess('svc');
    meter.recordCircuitBreakerSuccess('svc');
    meter.recordCircuitBreakerFailure('svc');
    meter.recordCircuitBreakerStateChange('svc', 'closed', 'open');
    meter.recordCircuitBreakerState('svc', 1);
    meter.recordCircuitBreakerRequest('svc', 'closed');

    const rm = await collect();

    const successes = rm.scopeMetrics
      .flatMap((sm) => sm.metrics)
      .find((m) => m.descriptor.name === 'fortify.circuit_breaker.successes');
    expect(successes).toBeDefined();
    const total = successes!.dataPoints.reduce(
      (acc, dp) => acc + (dp.value as number),
      0
    );
    expect(total).toBe(2);

    expect(findMetric(rm, 'fortify.circuit_breaker.failures')).toBe(true);
    expect(findMetric(rm, 'fortify.circuit_breaker.state_changes')).toBe(true);
    expect(findMetric(rm, 'fortify.circuit_breaker.state')).toBe(true);
    expect(findMetric(rm, 'fortify.circuit_breaker.requests')).toBe(true);
  });

  it('records retry instruments', async () => {
    const { meter, collect } = setup();
    meter.recordRetryAttempts('svc', 3);
    meter.recordRetryDuration('svc', 0.5);
    meter.recordRetrySuccess('svc');
    meter.recordRetryFailure('svc');

    const rm = await collect();
    expect(findMetric(rm, 'fortify.retry.attempts')).toBe(true);
    expect(findMetric(rm, 'fortify.retry.duration')).toBe(true);
    expect(findMetric(rm, 'fortify.retry.successes')).toBe(true);
    expect(findMetric(rm, 'fortify.retry.failures')).toBe(true);
  });

  it('records rate-limit and timeout instruments', async () => {
    const { meter, collect } = setup();
    meter.recordRateLimitAllowed('svc', 'user-1');
    meter.recordRateLimitDenied('svc', 'user-1');
    meter.recordRateLimitWaitTime('svc', 'user-1', 0.01);
    meter.recordTimeoutExecution('svc');
    meter.recordTimeoutExceeded('svc');
    meter.recordTimeoutDuration('svc', true, 1.0);

    const rm = await collect();
    expect(findMetric(rm, 'fortify.rate_limit.allowed')).toBe(true);
    expect(findMetric(rm, 'fortify.rate_limit.denied')).toBe(true);
    expect(findMetric(rm, 'fortify.rate_limit.wait_duration')).toBe(true);
    expect(findMetric(rm, 'fortify.timeout.executions')).toBe(true);
    expect(findMetric(rm, 'fortify.timeout.exceeded')).toBe(true);
    expect(findMetric(rm, 'fortify.timeout.duration')).toBe(true);
  });

  it('records bulkhead gauges and counters', async () => {
    const { meter, collect } = setup();
    meter.recordBulkheadActive('svc', 5);
    meter.recordBulkheadQueued('svc', 2);
    meter.recordBulkheadRejected('svc');
    meter.recordBulkheadSuccess('svc');
    meter.recordBulkheadFailure('svc');
    meter.recordBulkheadDuration('svc', 0.25);

    const rm = await collect();
    expect(findMetric(rm, 'fortify.bulkhead.active')).toBe(true);
    expect(findMetric(rm, 'fortify.bulkhead.queued')).toBe(true);
    expect(findMetric(rm, 'fortify.bulkhead.rejected')).toBe(true);
    expect(findMetric(rm, 'fortify.bulkhead.successes')).toBe(true);
    expect(findMetric(rm, 'fortify.bulkhead.failures')).toBe(true);
    expect(findMetric(rm, 'fortify.bulkhead.duration')).toBe(true);
  });

  it('constructs against the global provider without throwing', () => {
    expect(() => new MetricsMeter()).not.toThrow();
  });
});
