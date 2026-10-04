# Project Guidelines and Agent Protocol

This repository is an autonomous testbed for distributed task processing and agent workflows.

## Jules Delegation Framework

This repository strictly delegates all source code and test file modifications to Google Jules (`jules.google`).
- Local harness: planning, domain modeling, ticket authoring, prompt engineering, and read-only test verification. It never edits source code or test files directly after initialization.
- Jules Coder Agent: writes code and tests test-first, opens a GitHub Pull Request.
- Jules Tester Agent: mandatory for every PR; writes boundary and adversarial tests in its Cloud VM.
- Test commands: run project test suites (`npm test`) using Node.js built-in test runner (`node:test`).

## Coding Conventions

- Modern JavaScript using ECMAScript Modules (ESM).
- Standard Node.js test runner: `node:test` and `node:assert/strict`.
- Zero external dependencies: rely strictly on Node.js built-ins.
- Zero em-dashes anywhere in prose, code comments, or commit messages.

## Agent skills

### Issue tracker

Local markdown in `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical roles mapped 1:1. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context with root `GLOSSARY.md` and `docs/adr/`. See `docs/agents/domain.md`.

### Jules delegation

All code implementation delegated to Google Jules (`jules.google`). See `docs/agents/jules.md`.

