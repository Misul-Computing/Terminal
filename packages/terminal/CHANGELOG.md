# Changelog

Misul Terminal - a coding agent by Misul Computing.

## [Unreleased]

### Added

- Auto-thinking: new "auto" thinking level (now the default). Before each
  prompt, a lightweight model call classifies the reasoning effort needed
  (minimal, low, medium, high) and sets the thinking level for that turn.
  Trivial prompts skip the call entirely. Technical users can set a concrete
  level via --thinking, the settings menu, or the thinking selector to
  disable auto-classification.
- Light theme overhaul and accessibility fixes: darkened grays, darkened
  custom-message/tool backgrounds, and fixed muted/dim text to be legible on
  white terminal backgrounds.
- Light theme switched to a minimal monochrome palette: accent, links,
  warnings, and success indicators now use black/dark-gray tones instead of
  blue/green/orange, leaving only error text in red.
- Theme auto-detection now runs on every startup and switches to the
  detected light/dark theme when the terminal background is reported with
  high confidence, so the app stays readable even if the terminal profile
  or system theme changes.
- New `disableMouseCapture` setting to disable mouse capture and use the
  terminal's native selection. Toggles apply immediately without a restart.
  By default Misul keeps mouse capture on and provides in-app text selection.
- In-app text selection: click and drag anywhere in the conversation to
  highlight text; the selected text is copied to the system clipboard via
  OSC 52 on release. Mouse capture now enables button-motion tracking (mode
  1002) so drags are reported while mouse capture is enabled, keeping wheel
  scroll and click-to-toggle thinking blocks working.
- New `app.mouse.toggle` keybinding (`Ctrl+Shift+M` by default) to instantly
  switch mouse capture on/off, so you can quickly drop to native selection
  without opening `/settings`.

### Changed

- Removed the "What are we building today?" startup prompt from interactive mode
  while keeping the logo/version/tagline header visible by default.
- Startup resource listings and diagnostics (skills, extensions, prompts, themes,
  MCP, ACP, conflicts) are no longer shown. Resources still load and are available
  via slash commands and the /skills menu.

- In-app text selection now keeps the highlight visible after mouse release
  instead of clearing it immediately; the selection is cleared on the next press
  or when a new message is submitted.
- Tool calls now actually collapse when the assistant turn ends. They were
  being removed from the internal tracking map before the collapse could fire.
- The main agent no longer receives the `deep-work` subagent persona by default.
  The main agent uses the Misul constitution only; pass `--agent deep-work` to
  opt into that persona. Subagent delegation remains enabled by default.
- Internal scroll now forces a full redraw when returning to the bottom, so the
  input box and footer are no longer cut off after scrolling up.
- Scrolled viewport re-rendering no longer clears the whole screen; lines are
  redrawn in place inside a synchronized output block, which reduces jitter.
- Removed built-in slash commands `/probe-thinking`, `/scoped-models`, `/share`,
  `/changelog`, and `/trust` to keep the command surface focused.
- Added built-in instant slash commands: `/read <path>`, `/grep <pattern>
  [path]`, `/edit <path> "<oldText>" "<newText>"`, and `/todo [text]`. These run
  directly without an LLM round-trip, restrict paths to the project directory,
  and show compact results in chat.
- Bumped version to 0.6.1.
- Build `copy-assets` script now removes stale `dark.json`/`light.json` files
  before copying the consolidated `themes.json`.

### Fixed

- SGR mouse parsing now correctly decodes button, motion, wheel, and modifier
  bits. Modifier-key mouse events (Shift+drag, Ctrl+click, etc.) are left to
  the terminal so native text selection and link handling work while mouse
  capture is enabled.

## [0.6.0] - 2026-07-03

### Added

- Skills refresh on context compaction: after both auto-compaction and
  manual compaction complete, the resource loader reloads skills from disk
  and the system prompt is rebuilt. This picks up any skill changes that
  happened during the compacted-away portion of the conversation.
- Active skill names are now included in compaction summaries. When the
  context is compacted, the summary includes an `<active-skills>` section
  listing all currently loaded skills, so the model can re-invoke them
  after compaction without the user re-prompting.
- The summarization prompt now includes an "Active Skills" section in both
  the initial and update formats, preserving skill context across iterative
  compactions.
- Bundled skills: `coding-minimalism` (upgraded from ponytail with observable
  rung markers, dependency/multi-file/abstraction gates, post-edit
  self-review, and subagent propagation), `design-taste-frontend` (taste-skill
  v2, MIT-licensed), `shader-backgrounds` (Paper Shaders guide,
  Apache-2.0-licensed).

### Changed

- Addon system removed. Skills, Extensions, MCP, and ACP are now four
  independent extension mechanisms. MCP servers are configured in `mcp.json`
  files (`~/.misul/agent/mcp.json`, `.misul/mcp.json`). ACP agents are
  configured in `acp.json` files (`~/.misul/agent/acp.json`, `.misul/acp.json`).
  The `--addon` flag and `misul addon` CLI commands are removed. `--skill`
  and `--extension` are no longer deprecated.
- Default `keepRecentTokens` increased from 20000 to 24000. Modern models
  have larger context windows; keeping more recent context reduces
  information loss during compaction.
- Local package dependency ranges fixed: `@misul/ai`, `@misul/agent-core`,
  and `@misul/tui` now reference `^0.3.0` instead of the stale `^0.79.5`.

## [0.5.0] - 2026-07-01

### Added

- Live reload: on-demand change detection for skill, extension, prompt,
  theme, and addon directories. After each tool call completes, the agent
  checks if any resource directory changed (a few statSync calls, no
  background watcher). If so, a lightweight reload picks up the changes
  without restart. The prompt cache prefix stays stable when only skills
  change. No-op while streaming or compacting.
- Permission gate is always on and context-aware. Read-only tools run
  automatically. Everything else: one lightweight model call with recent
  conversation context decides whether to ask or just run. If the user
  asked for it, it runs. If it's destructive and wasn't requested, the
  agent asks in chat. No hardcoded dangerous patterns. No flag, no
  setting, no opt-in.
- System prompt now tells the agent about the permission gate, addons,
  and live reload. The agent knows about `misul addon` CLI commands and
  can install addons for the user.
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
