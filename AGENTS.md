# AGENTS.md

## Project

Misul Terminal. Coding agent CLI in TypeScript. Monorepo:
`terminal` (TUI + CLI), `ai` (providers, models), `agent` (agent loop),
`tui` (rendering), `eval` (eval harness).

## Build and test

```
npm run build
cd packages/ai && npm test
cd packages/terminal && npm test
node packages/terminal/dist/cli.js
```

## Rules

Do not cut corners. The minimal solution means the simplest correct
approach, not skipping necessary work. If a task requires block hashing,
telemetry, or tests, do them. A shortcut that omits a crucial piece is
not minimal, it is incomplete.

Fix pre-existing test failures when encountered, not just the ones
caused by current changes. The test suite should be golden.

## References

- `docs/cache-aware-design.md` - prompt caching architecture for coding
  agents. Read before touching prompt rendering, tool ordering, session
  compaction, or subagent context.
