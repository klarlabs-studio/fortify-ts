# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial release of Fortify TS
- `@fortify-ts/core` - Shared types, errors, and utilities
- `@fortify-ts/circuit-breaker` - Circuit breaker pattern implementation
- `@fortify-ts/retry` - Retry with exponential, linear, and constant backoff
- `@fortify-ts/rate-limit` - Token bucket rate limiter with per-key support
- `@fortify-ts/timeout` - Timeout wrapper with AbortSignal integration
- `@fortify-ts/bulkhead` - Concurrency limiter with queue support
- `@fortify-ts/fallback` - Fallback pattern for graceful degradation
- `@fortify-ts/middleware` - Fluent composition chain for patterns
- `@fortify-ts/http` - Framework-agnostic HTTP middleware adapters
- `@fortify-ts/logging` - Structured logging with pino and console adapters
- `@fortify-ts/metrics` - Prometheus metrics integration
- `@fortify-ts/tracing` - OpenTelemetry tracing support
- `@fortify-ts/testing` - Chaos engineering utilities for testing

### Features

- Full TypeScript support with strict type checking
- Zod-based runtime configuration validation
- Browser and Node.js compatibility
- AbortSignal support for cancellation
- Comprehensive test coverage

[Unreleased]: https://github.com/klarlabs-studio/fortify-ts/compare/v0.1.0...HEAD
