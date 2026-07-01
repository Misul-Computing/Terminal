# Changelog

Misul Terminal — a coding agent by Misul Computing.

## [Unreleased]

## [0.79.5] - 2026-06-17

Initial Misul Terminal builds. Misul Terminal is a model-agnostic coding agent
that aims to get the best work out of whatever model drives it.

### Added

- Quality-per-dollar evaluation harness for measuring harness changes on a fixed task suite.
- Bundled universal skills: `frontend-design`, `api-design`, `secure-coding`, plus `semantic-compression`.
- Deep-work and simple subagents that inherit the active session model.
- A Misul-adapted default system prompt (identity, tone, and behavior).

### Changed

- Faster cold start, and memoized resolution of the `grep`/`find` search binaries so repeat searches skip the per-call lookup.
