# Contributing to Fortify TS

Thank you for your interest in contributing to Fortify TS! This document provides guidelines and information for contributors.

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## How to Contribute

### Reporting Bugs

Before creating a bug report, please check existing issues to avoid duplicates. When creating a bug report, include:

- A clear, descriptive title
- Steps to reproduce the issue
- Expected behavior vs actual behavior
- Your environment (Node.js version, OS, package versions)
- Code samples or test cases if applicable

### Suggesting Features

Feature requests are welcome! Please provide:

- A clear description of the feature
- The problem it solves or use case it addresses
- Any alternative solutions you've considered
- Code examples of how it might work

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Install dependencies**: `pnpm install`
3. **Make your changes** following our coding standards
4. **Add tests** for any new functionality
5. **Run the test suite**: `pnpm test`
6. **Run linting**: `pnpm lint`
7. **Run type checking**: `pnpm typecheck`
8. **Commit your changes** using conventional commits
9. **Push to your fork** and submit a pull request

## Development Setup

### Prerequisites

- Node.js 20+ (check `.nvmrc` for exact version)
- pnpm 9+

### Getting Started

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/fortify-ts.git
cd fortify-ts

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
```

### Project Structure

```
fortify-ts/
├── packages/
│   ├── core/              # Shared types, errors, utilities
│   ├── circuit-breaker/   # Circuit breaker pattern
│   ├── retry/             # Retry with backoff
│   ├── rate-limit/        # Token bucket rate limiter
│   ├── timeout/           # Timeout wrapper
│   ├── bulkhead/          # Concurrency limiter
│   ├── fallback/          # Fallback pattern
│   ├── middleware/        # Composition chain
│   ├── http/              # HTTP middleware adapters
│   ├── logging/           # Structured logging
│   ├── metrics/           # Prometheus metrics
│   ├── tracing/           # OpenTelemetry tracing
│   └── testing/           # Chaos engineering utilities
├── .github/               # GitHub workflows and templates
├── turbo.json             # Turborepo configuration
└── pnpm-workspace.yaml    # pnpm workspace configuration
```

## Coding Standards

### TypeScript

- Use TypeScript strict mode
- Provide explicit types for public APIs
- Use Zod for runtime configuration validation
- Prefer `interface` over `type` for object shapes
- Use `readonly` where applicable

### Code Style

- We use Prettier for code formatting
- ESLint for linting
- Run `pnpm format` to format code
- Run `pnpm lint` to check for issues

### Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

[optional body]

[optional footer]
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `chore`: Maintenance tasks

Examples:
```
feat(circuit-breaker): add half-open state timeout configuration
fix(retry): handle edge case with zero max attempts
docs(readme): add usage examples for rate limiter
```

### Testing

- Write tests for all new functionality
- Maintain or improve code coverage
- Use Vitest for testing
- Place tests in `tests/` directory within each package
- Use descriptive test names

Example test structure:
```typescript
describe('CircuitBreaker', () => {
  describe('execute', () => {
    it('should execute operation when circuit is closed', async () => {
      // ...
    });

    it('should reject when circuit is open', async () => {
      // ...
    });
  });
});
```

### Documentation

- Add JSDoc comments to public APIs
- Update README if adding new features
- Include code examples in documentation

## Package Development

### Creating a New Package

1. Create directory under `packages/`
2. Add `package.json` with proper naming (`@klarlabs-studio/fortify-package-name`)
3. Add `tsconfig.json` extending base config
4. Add `tsup.config.ts` for building
5. Export from `src/index.ts`
6. Add tests in `tests/`

### Building Packages

```bash
# Build all packages
pnpm build

# Build specific package
pnpm --filter @klarlabs-studio/fortify-circuit-breaker build
```

### Testing Packages

```bash
# Test all packages
pnpm test

# Test specific package
pnpm --filter @klarlabs-studio/fortify-circuit-breaker test

# Test with coverage
pnpm test:coverage
```

## Review Process

1. All PRs require at least one review
2. CI must pass (lint, typecheck, tests)
3. Code coverage should not decrease
4. Documentation must be updated if applicable

## Getting Help

- Open a [Discussion](https://github.com/klarlabs-studio/fortify-ts/discussions) for questions
- Check existing issues and discussions first
- Join our community channels (if available)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
