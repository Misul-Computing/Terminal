# Changelog

Misul Terminal — a coding agent by Misul Computing.

## [Unreleased]

## [0.5.0] - 2026-07-01

### Added

- Live reload: on-demand change detection for skill, extension, prompt,
  theme, and addon directories. After each tool call completes, the agent
  checks if any resource directory changed (a few statSync calls, no
  background watcher). If so, a lightweight reload picks up the changes
  without restart. The prompt cache prefix stays stable when only skills
  change. No-op while streaming or compacting.
- Permission modes: three modes for tool execution, cycled with Shift+Tab.
  "ask" (default) asks the user in chat before risky actions. "auto" allows
  everything. "plan" is read-only, blocking all mutations. Replaces the old
  --auto flag and autoMode setting. Set via --permission CLI flag or
  permissionMode setting. Risk is assessed by rules first (zero tokens):
  reads are safe, edits are moderate, rm/git push/sudo are dangerous.
  Ambiguous cases use a lightweight model call (256 max tokens). The user
  replies in natural language; responses are interpreted by keyword
  matching first, then a lightweight model call for complex replies.
- System prompt now tells the agent about addons, permission modes, and
  live reload. The agent knows about `misul addon` CLI commands and can
  install addons for the user.
- Fix: syntax highlighting breaks on multi-line spans (strings, comments,
  template literals). ANSI codes are now applied per line so each line
  has balanced codes.
- Fix: mouse click stops working after scrolling. terminalRowToLineIndex
  now accounts for scrollOffset when mapping terminal rows to line indices.
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
