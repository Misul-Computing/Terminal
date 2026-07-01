# Changelog

Misul Terminal — a coding agent by Misul Computing.

## [Unreleased]

## [0.5.0] - 2026-07-01

### Added

- Addon install/remove/list/search/store CLI commands. Addons can be
  installed from git, npm, or local sources and are tracked in settings.
- Addon store registry with configurable URL. Search and browse
  available addons from a remote JSON registry.
- Addon installer module with git clone (shallow), npm pack+extract,
  and local symlink/copy strategies. Verifies installed addons contain
  at least one valid component.
- Settings persistence for installed addons (addons[] array in global
  and project settings).
- Documentation for addon commands, install sources, and store format.

## [0.4.0] - 2026-07-01

### Added

- Hardened system prompt with verification, iteration, and blind_spots
  sections based on research into production agent prompts and academic
  findings. No completion claims without fresh evidence. Iteration caps
  at 3 rounds. Blind spot mitigation via re-reading own output.
- MISUL.md as the preferred global system prompt file in
  ~/.misul/agent/. AGENTS.md remains for per-project context. Backward
  compatibility preserved.

### Changed

- Context files no longer shown as a startup section; loaded silently
  into the system prompt instead.
- Tool calls, bash execution, errors, and other chat components now
  centered using CenteredBlock, matching assistant text centering.
- collectCollapsibleItems recurses into containers so cursor navigation
  finds tool calls wrapped in CenteredBlock.

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
