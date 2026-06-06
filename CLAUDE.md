# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Fortify TS is a production-grade resilience and fault-tolerance library for TypeScript, implementing patterns similar to the Go library [fortify](https://github.com/klarlabs-studio/fortify). All core packages are browser-compatible and use standard APIs (AbortController, Promise, Map).

## Development Commands

```bash
# Install dependencies
pnpm install

# Build all packages (uses Turborepo for dependency-aware builds)
pnpm build

# Run all tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Run tests in watch mode (single package)
cd packages/<package-name> && pnpm test:watch

# Run a single test file
cd packages/<package-name> && pnpm vitest run tests/<file>.test.ts

# Type check all packages
pnpm typecheck

# Lint all packages
pnpm lint

# Format code
pnpm format

# Clean build artifacts
pnpm clean
```

## Architecture

### Monorepo Structure

- **Package Manager**: pnpm with workspaces (`packages/*`)
- **Build Orchestration**: Turborepo for parallel, cached builds with dependency ordering
- **Build Tool**: tsup (outputs ESM + CJS with TypeScript declarations)
- **Testing**: Vitest with v8 coverage, plus fast-check for property-based testing
- **Linting**: ESLint with typescript-eslint (strict + stylistic)

### Package Hierarchy

```
@fortify-ts/core          <- Foundation: errors, types, utilities, Zod schemas
    ↑
┌───┴────┬──────────┬──────────┬──────────┬──────────┐
circuit-  retry     timeout   rate-limit  bulkhead  fallback  <- Resilience patterns
breaker
    ↑       ↑          ↑          ↑          ↑          ↑
    └───────┴──────────┴──────────┴──────────┴──────────┘
                              ↓
                        @fortify-ts/middleware  <- Chain composition
                              ↓
              ┌───────────────┼───────────────┐
          @fortify-ts/     @fortify-ts/    @fortify-ts/
          http             testing         metrics/logging/tracing
```

### Core Concepts

**Operation Type**: All patterns work with `Operation<T> = (signal: AbortSignal) => Promise<T>` - async functions that accept an abort signal for cancellation.

**Pattern Interface**: Each resilience pattern implements:
```typescript
interface Pattern<T> {
  execute(operation: Operation<T>, signal?: AbortSignal): Promise<T>;
}
```

**Middleware Chain**: Patterns compose via `Chain` class with fluent API:
```typescript
new Chain<T>()
  .withBulkhead(bh)      // Outermost (first)
  .withRateLimit(rl)
  .withTimeout(tm)
  .withCircuitBreaker(cb)
  .withRetry(retry)
  .withFallback(fb)      // Innermost (last)
  .execute(operation);
```

### Key Design Patterns

- **Error Hierarchy**: All errors extend `FortifyError` with pattern-specific subclasses (`CircuitOpenError`, `TimeoutError`, `BulkheadFullError`, etc.)
- **Retryable Errors**: Use `asRetryable(error)` / `asNonRetryable(error)` to control retry behavior
- **Configuration Validation**: Zod schemas for all config objects with runtime validation
- **Logger Interface**: `FortifyLogger` compatible with pino, winston, console

### File Conventions

- **Source**: `packages/<name>/src/` with `index.ts` re-exporting public API
- **Tests**: `packages/<name>/tests/*.test.ts` (unit) and `*.property.test.ts` (property-based)
- **Config per package**: Each package has its own `tsconfig.json`, `tsup.config.ts`, `package.json`
- **Shared base config**: `tsconfig.base.json` at root

### TypeScript Configuration

Strict mode with additional checks:
- `noUncheckedIndexedAccess`: true
- `exactOptionalPropertyTypes`: true
- `noImplicitReturns`: true
- `consistent-type-imports` enforced (use `import { type X }`)
- `interface` preferred over `type` for object shapes

### Testing Notes

- Tests run with `globals: true` (no need to import describe/it/expect)
- Property-based tests use fast-check
- Browser compatibility tests in `@fortify-ts/testing`
