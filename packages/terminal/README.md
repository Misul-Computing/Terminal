<p align="center"><img src="docs/images/misul-logo-header.svg" alt="Misul Terminal" width="100%"></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@misul/terminal"><img alt="npm" src="https://img.shields.io/npm/v/@misul/terminal?style=flat-square" /></a>
  <a href="https://misul.org/terminal/"><img alt="website" src="https://img.shields.io/badge/website-misul.org%2Fterminal-171e2b?style=flat-square" /></a>
</p>

> New issues and PRs from new contributors are auto-closed by default. Maintainers review auto-closed issues daily. See [CONTRIBUTING.md](../../CONTRIBUTING.md).

---

Misul Terminal is a minimal terminal coding harness. Adapt misul to your workflows, not the other way around, without having to fork and modify Misul Terminal internals. Extend it with TypeScript [Extensions](#extensions), [Skills](#skills), [Prompt Templates](#prompt-templates), and [Themes](#themes). Put your extensions, skills, prompt templates, and themes in [Misul Packages](#misul-packages) and share them with others via npm or git.

Misul Terminal ships with powerful defaults but skips features like sub agents and plan mode. Instead, you can ask misul to build what you want or install a third party Misul package that matches your workflow.

Misul Terminal runs in four modes: interactive, print or JSON, RPC for process integration, and an SDK for embedding in your own apps. See [openclaw/openclaw](https://github.com/openclaw/openclaw) for a real-world SDK integration.

## Table of Contents

- [Quick Start](#quick-start)
- [Providers & Models](#providers--models)
- [Interactive Mode](#interactive-mode)
  - [Editor](#editor)
  - [Commands](#commands)
  - [Keyboard Shortcuts](#keyboard-shortcuts)
  - [Message Queue](#message-queue)
- [Sessions](#sessions)
  - [Branching](#branching)
  - [Compaction](#compaction)
- [Settings](#settings)
- [Context Files](#context-files)
- [Customization](#customization)
  - [Prompt Templates](#prompt-templates)
  - [Skills](#skills)
  - [Extensions](#extensions)
  - [Addons](#addons)
  - [Themes](#themes)
  - [Misul Packages](#misul-packages)
- [Programmatic Usage](#programmatic-usage)
- [Philosophy](#philosophy)
- [CLI Reference](#cli-reference)

---

## Quick Start

```bash
npm install -g --ignore-scripts @misul/terminal
```

`--ignore-scripts` disables dependency lifecycle scripts during install. Misul Terminal does not require install scripts for normal npm installs.

Installer alternative:

```bash
curl -fsSL https://misul.dev/install.sh | sh
```

Authenticate with an API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
misul
```

Or use your existing subscription:

```bash
misul
/login  # Then select provider
```

Then just talk to misul. By default, misul gives the model four tools: `read`, `write`, `edit`, and `bash`. The model uses these to fulfill your requests. Add capabilities via [skills](#skills), [prompt templates](#prompt-templates), [extensions](#extensions), or [Misul packages](#misul-packages).

**Platform notes:** [Windows](docs/windows.md) | [Termux (Android)](docs/termux.md) | [tmux](docs/tmux.md) | [Terminal setup](docs/terminal-setup.md) | [Shell aliases](docs/shell-aliases.md)

---

## Providers & Models

For each built-in provider, misul maintains a list of tool-capable models, updated with every release. Authenticate via subscription (`/login`) or API key, then select any model from that provider via `/model` (or Ctrl+L).

**Subscriptions:**
- Anthropic Claude Pro/Max
- OpenAI ChatGPT Plus/Pro (Codex)
- GitHub Copilot

**API keys:**
- Anthropic
- Ant Ling
- OpenAI
- Azure OpenAI
- DeepSeek
- NVIDIA NIM
- Google Gemini
- Google Vertex
- Amazon Bedrock
- Mistral
- Groq
- Cerebras
- Cloudflare AI Gateway
- Cloudflare Workers AI
- xAI
- OpenRouter
- Vercel AI Gateway
- ZAI
- ZAI Coding Plan (China)
- OpenCode Zen
- OpenCode Go
- Hugging Face
- Fireworks
- Together AI
- Kimi For Coding
- MiniMax
- Xiaomi MiMo
- Xiaomi MiMo Token Plan (China)
- Xiaomi MiMo Token Plan (Amsterdam)
- Xiaomi MiMo Token Plan (Singapore)

See [docs/providers.md](docs/providers.md) for detailed setup instructions.

**Custom providers & models:** Add providers via `~/.misul/agent/models.json` if they speak a supported API (OpenAI, Anthropic, Google). For custom APIs or OAuth, use extensions. See [docs/models.md](docs/models.md) and [docs/custom-provider.md](docs/custom-provider.md).

---

## Interactive Mode

<p align="center"><img src="docs/images/interactive-mode.png" alt="Interactive Mode" width="600"></p>

The interface from top to bottom:

- **Startup header** - Logo, version, and tagline
- **Messages** - Your messages, assistant responses, tool calls and results, notifications, errors, and extension UI
- **Editor** - Where you type; border color indicates thinking level
- **Footer** - Working directory, session name, total token/cache usage (`↑` input, `↓` output, `R` cache read, `W` cache write, `CH` latest cache hit rate), cost, context usage, current model

The editor can be temporarily replaced by other UI, like built-in `/settings` or custom UI from extensions (e.g., a Q&A tool that lets the user answer model questions in a structured format). [Extensions](#extensions) can also replace the editor, add widgets above/below it, a status line, custom footer, or overlays.

### Editor

| Feature | How |
|---------|-----|
| File reference | Type `@` to fuzzy-search project files |
| Path completion | Tab to complete paths |
| Multi-line | Shift+Enter (or Ctrl+Enter on Windows Terminal) |
| Images | Ctrl+V to paste (Alt+V on Windows), or drag onto terminal |
| Bash commands | `!command` runs and sends output to LLM, `!!command` runs without sending |

Standard editing keybindings for delete word, undo, etc. See [docs/keybindings.md](docs/keybindings.md).

### Commands

Type `/` in the editor to trigger commands. [Extensions](#extensions) can register custom commands, [skills](#skills) are available as `/skill:name`, and [prompt templates](#prompt-templates) expand via `/templatename`.

| Command | Description |
|---------|-------------|
| `/login`, `/logout` | OAuth authentication |
| `/model` | Switch models |
| `/settings` | Thinking level, theme, message delivery, transport |
| `/resume` | Pick from previous sessions |
| `/new` | Start a new session |
| `/name <name>` | Set session display name |
| `/session` | Show session info (file, ID, messages, tokens, cost) |
| `/tree` | Jump to any point in the session and continue from there |
| `/fork` | Create a new session from a previous user message |
| `/clone` | Duplicate the current active branch into a new session |
| `/compact [prompt]` | Manually compact context, optional custom instructions |
| `/copy` | Copy last assistant message to clipboard |
| `/export [file]` | Export session to HTML file |
| `/reload` | Reload keybindings, extensions, skills, prompts, and context files (themes hot-reload automatically) |
| `/hotkeys` | Show all keyboard shortcuts |
| `/read <path>` | Read a file instantly |
| `/grep <pattern> [path]` | Search file contents instantly |
| `/edit <path> "<old>" "<new>"` | Apply a simple edit instantly |
| `/todo [text]` | Show or add to the local task list |
| `/quit` | Quit misul |

### Keyboard Shortcuts

See `/hotkeys` for the full list. Customize via `~/.misul/agent/keybindings.json`. See [docs/keybindings.md](docs/keybindings.md).

**Commonly used:**

| Key | Action |
|-----|--------|
| Ctrl+C | Clear editor |
| Ctrl+C twice | Quit |
| Escape | Cancel/abort |
| Escape twice | Open `/tree` |
| Ctrl+L | Open model selector |
| Ctrl+P / Shift+Ctrl+P | Cycle scoped models forward/backward |
| Shift+Tab | Cycle thinking level |
| Ctrl+O | Collapse/expand tool output |
| Ctrl+T | Collapse/expand thinking blocks |

### Message Queue

Submit messages while the agent is working:

- **Enter** queues a *steering* message, delivered after the current assistant turn finishes executing its tool calls
- **Alt+Enter** queues a *follow-up* message, delivered only after the agent finishes all work
- **Escape** aborts and restores queued messages to editor
- **Alt+Up** retrieves queued messages back to editor

On Windows Terminal, `Alt+Enter` is fullscreen by default. Remap it in [docs/terminal-setup.md](docs/terminal-setup.md) so misul can receive the follow-up shortcut.

Configure delivery in [settings](docs/settings.md): `steeringMode` and `followUpMode` can be `"one-at-a-time"` (default, waits for response) or `"all"` (delivers all queued at once). `transport` selects provider transport preference (`"sse"`, `"websocket"`, or `"auto"`) for providers that support multiple transports.

---

## Sessions

Sessions are stored as JSONL files with a tree structure. Each entry has an `id` and `parentId`, enabling in-place branching without creating new files. See [docs/session-format.md](docs/session-format.md) for file format.

### Management

Sessions auto-save to `~/.misul/agent/sessions/` organized by working directory.

```bash
misul -c                  # Continue most recent session
misul -r                  # Browse and select from past sessions
misul --no-session        # Ephemeral mode (don't save)
misul --name "my task"    # Set session display name at startup
misul --session <path|id> # Use specific session file or ID
misul --fork <path|id>    # Fork specific session file or ID into a new session
```

Use `/session` in interactive mode to see the current session ID before reusing it with `--session <id>` or `--fork <id>`.

### Branching

**`/tree`** - Navigate the session tree in-place. Select any previous point, continue from there, and switch between branches. All history preserved in a single file.

<p align="center"><img src="docs/images/tree-view.png" alt="Tree View" width="600"></p>

- Search by typing, fold/unfold and jump between branches with Ctrl+←/Ctrl+→ or Alt+←/Alt+→, page with ←/→
- Filter modes (Ctrl+O): default → no-tools → user-only → labeled-only → all
- Press Shift+L to label entries as bookmarks and Shift+T to toggle label timestamps

**`/fork`** - Create a new session file from a previous user message on the active branch. Opens a selector, copies the active path up to that point, and places the selected prompt in the editor for modification.

**`/clone`** - Duplicate the current active branch into a new session file at the current position. The new session keeps the full active-path history and opens with an empty editor.

**`--fork <path|id>`** - Fork an existing session file or partial session UUID directly from the CLI. This copies the full source session into a new session file in the current project.

### Compaction

Long sessions can exhaust context windows. Compaction summarizes older messages while keeping recent ones.

**Manual:** `/compact` or `/compact <custom instructions>`

**Automatic:** Enabled by default. Triggers on context overflow (recovers and retries) or when approaching the limit (proactive). Configure via `/settings` or `settings.json`.

Compaction is lossy. The full history remains in the JSONL file; use `/tree` to revisit. Customize compaction behavior via [extensions](#extensions). See [docs/compaction.md](docs/compaction.md) for internals.

---

## Settings

Use `/settings` to modify common options, or edit JSON files directly:

| Location | Scope |
|----------|-------|
| `~/.misul/agent/settings.json` | Global (all projects) |
| `.misul/settings.json` | Project (overrides global) |

See [docs/settings.md](docs/settings.md) for all options.

### Project Trust

On interactive startup, misul asks before trusting a project folder that contains project-local settings, resources, or project `.agents/skills` and has no saved decision for the folder or a parent folder in `~/.misul/agent/trust.json`. Trusting a project allows misul to load `.misul/settings.json` and `.misul` resources, install missing project packages, and execute project extensions.

Before the trust decision, misul loads only context files, user/global extensions, and CLI `-e` extensions so they can handle the `project_trust` event. Project-local extensions, project package-managed extensions, and project settings are loaded only after the project is trusted. This split also applies when switching to a session from a different cwd whose trust has not been resolved in the current process.

Non-interactive modes (`-p`, `--mode json`, and `--mode rpc`) do not show a trust prompt. Without an applicable saved trust decision, they use `defaultProjectTrust` from global settings: `ask` (default) and `never` ignore those project resources, while `always` trusts them. Pass `--approve`/`-a` or `--no-approve`/`-na` to override project trust for one run.

If no extension or saved decision applies, `defaultProjectTrust` controls the fallback behavior. Set it to `"ask"`, `"always"`, or `"never"` in `~/.misul/agent/settings.json`, or change it with `/settings`.

`misul config` and package commands use the same project trust flow, except `misul update` never prompts. Pass `--approve` to trust project-local settings for one command or `--no-approve` to ignore them.

### Telemetry and update checks

Misul Terminal has two separate startup features:

- **Update check:** fetches `https://misul.dev/api/latest-version` to check whether a newer Misul Terminal version exists. Disable it with `MISUL_SKIP_VERSION_CHECK=1`. Disabling update checks only turns off this check.
- **Install/update telemetry:** after first install or updates, sends an anonymous version ping to `https://misul.dev/api/report-install`. This setting also controls optional provider attribution headers for OpenRouter, Cloudflare, and direct NVIDIA NIM requests. Opt out by setting `enableInstallTelemetry` to `false` in `settings.json`, or by setting `MISUL_TELEMETRY=0`. This does not disable update checks; Misul Terminal may still contact `misul.dev` for the latest version unless update checks are disabled or offline mode is enabled.

Use `--offline` or `MISUL_OFFLINE=1` to disable all startup network operations described here, including update checks, package update checks, and install/update telemetry.

---

## Context Files

Misul Terminal loads `AGENTS.md` (or `CLAUDE.md`) at startup from:
- `~/.misul/agent/AGENTS.md` (global)
- Parent directories (walking up from cwd)
- Current directory

Use for project instructions (`AGENTS.md`/`CLAUDE.md`), conventions, common commands. All matching files are concatenated.

Disable context file loading with `--no-context-files` (or `-nc`).

### System Prompt

Replace the default system prompt with `.misul/SYSTEM.md` (project) or `~/.misul/agent/SYSTEM.md` (global). Append without replacing via `APPEND_SYSTEM.md`.

---

## Customization

### Prompt Templates

Reusable prompts as Markdown files. Type `/name` to expand.

```markdown
<!-- ~/.misul/agent/prompts/review.md -->
Review this code for bugs, security issues, and performance problems.
Focus on: {{focus}}
```

Place in `~/.misul/agent/prompts/`, `.misul/prompts/`, or a [Misul package](#misul-packages) to share with others. See [docs/prompt-templates.md](docs/prompt-templates.md).

### Skills

On-demand capability packages following the [Agent Skills standard](https://agentskills.io). Invoke via `/skill:name` or let the agent load them automatically.

```markdown
<!-- ~/.misul/agent/skills/my-skill/SKILL.md -->
# My Skill
Use this skill when the user asks about X.

## Steps
1. Do this
2. Then that
```

Place in `~/.misul/agent/skills/`, `~/.agents/skills/`, `.misul/skills/`, or `.agents/skills/` (from `cwd` up through parent directories) or a [Misul package](#misul-packages) to share with others. See [docs/skills.md](docs/skills.md).

### Extensions

<p align="center"><img src="docs/images/doom-extension.png" alt="Doom Extension" width="600"></p>

TypeScript modules that extend misul with custom tools, commands, keyboard shortcuts, event handlers, and UI components.

```typescript
export default function (misul: ExtensionAPI) {
  misul.registerTool({ name: "deploy", ... });
  misul.registerCommand("stats", { ... });
  misul.on("tool_call", async (event, ctx) => { ... });
}
```

The default export can also be `async`. misul waits for async extension factories before startup continues, which is useful for one-time initialization such as fetching remote model lists before calling `misul.registerProvider()`.

**What's possible:**
- Custom tools (or replace built-in tools entirely)
- Sub-agents and plan mode
- Custom compaction and summarization
- Permission gates and path protection
- Custom editors and UI components
- Status lines, headers, footers
- Git checkpointing and auto-commit
- SSH and sandbox execution
- MCP server integration
- Make misul look like Claude Code
- Games while waiting (yes, Doom runs)
- ...anything you can dream up

Place in `~/.misul/agent/extensions/`, `.misul/extensions/`, or a [Misul package](#misul-packages) to share with others. See [docs/extensions.md](docs/extensions.md) and [examples/extensions/](examples/extensions/).

### Addons

Addons are self-contained directories that bundle any combination of skills, code extensions, and MCP servers. An addon can be just a skill, just an MCP server, just an extension, or all three together.

```
my-addon/
  addon.json          # manifest (optional)
  skills/             # skill directories with SKILL.md
  extension.ts        # code extension
  mcp.json            # MCP server configuration
```

Load from any path:

```bash
misul --addon ./my-addon
```

Or place in `~/.misul/agent/addons/` (global) or `.misul/addons/` (project) for automatic discovery. See [docs/addons.md](docs/addons.md).

### Themes

Built-in: `dark`, `light`. Themes hot-reload: modify the active theme file and misul immediately applies changes.

Place in `~/.misul/agent/themes/`, `.misul/themes/`, or a [Misul package](#misul-packages) to share with others. See [docs/themes.md](docs/themes.md).

### Misul Packages

Bundle and share extensions, skills, prompts, and themes via npm or git. Find packages on [npmjs.com](https://www.npmjs.com/search?q=keywords%3Amisul-package).

> **Security:** Misul packages run with full system access. Extensions execute arbitrary code, and skills can instruct the model to perform any action including running executables. Review source code before installing third-party packages.

```bash
misul install npm:@foo/misul-tools
misul install npm:@foo/misul-tools@1.2.3      # pinned version
misul install git:github.com/user/repo
misul install git:github.com/user/repo@v1  # tag or commit
misul install git:git@github.com:user/repo
misul install git:git@github.com:user/repo@v1  # tag or commit
misul install https://github.com/user/repo
misul install https://github.com/user/repo@v1      # tag or commit
misul install ssh://git@github.com/user/repo
misul install ssh://git@github.com/user/repo@v1    # tag or commit
misul remove npm:@foo/misul-tools
misul uninstall npm:@foo/misul-tools          # alias for remove
misul list
misul update                               # update misul and packages (skips pinned packages)
misul update --extensions                  # update packages only
misul update --self                        # update misul only
misul update --self --force                # reinstall misul even if current
misul update npm:@foo/misul-tools             # update one package
misul config                               # enable/disable extensions, skills, prompts, themes
```

Packages install to `~/.misul/agent/git/` (git) or `~/.misul/agent/npm/` (npm). Use `-l` for project-local installs (`.misul/git/`, `.misul/npm/`). Git `@ref` values are pinned tags or commits; pinned packages are skipped by `misul update`, so use `misul install git:host/user/repo@new-ref` to move an existing package to a new ref. Git packages install dependencies with `npm install --omit=dev` by default, so runtime deps must be listed under `dependencies`; when `npmCommand` is configured, git packages use plain `install` for compatibility with wrappers. If you use a Node version manager and want package installs to reuse a stable npm context, set `npmCommand` in `settings.json`, for example `["mise", "exec", "node@20", "--", "npm"]`.

Create a package by adding a `misul` key to `package.json`:

```json
{
  "name": "my-misul-package",
  "keywords": ["misul-package"],
  "misul": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```

Without a `misul` manifest, misul auto-discovers from conventional directories (`extensions/`, `skills/`, `prompts/`, `themes/`).

See [docs/packages.md](docs/packages.md).

---

## Programmatic Usage

### SDK

```typescript
import { AuthStorage, createAgentSession, ModelRegistry, SessionManager } from "@misul/terminal";

const authStorage = AuthStorage.create();
const modelRegistry = ModelRegistry.create(authStorage);
const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  authStorage,
  modelRegistry,
});

await session.prompt("What files are in the current directory?");
```

For advanced multi-session runtime replacement, use `createAgentSessionRuntime()` and `AgentSessionRuntime`.

See [docs/sdk.md](docs/sdk.md) and [examples/sdk/](examples/sdk/).

### RPC Mode

For non-Node.js integrations, use RPC mode over stdin/stdout:

```bash
misul --mode rpc
```

RPC mode uses strict LF-delimited JSONL framing. Clients must split records on `\n` only. Do not use generic line readers like Node `readline`, which also split on Unicode separators inside JSON payloads.

See [docs/rpc.md](docs/rpc.md) for the protocol.

---

## Philosophy

Misul Terminal is aggressively extensible so it doesn't have to dictate your workflow. Features that other tools bake in can be built with [extensions](#extensions), [skills](#skills), or installed from third-party [Misul packages](#misul-packages). This keeps the core minimal while letting you shape misul to fit how you work.

**No MCP.** Build CLI tools with READMEs (see [Skills](#skills)), or build an extension that adds MCP support. [Why?](https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/)

**No sub-agents.** There's many ways to do this. Spawn misul instances via tmux, or build your own with [extensions](#extensions), or install a package that does it your way.

**No permission popups.** Run in a container, or build your own confirmation flow with [extensions](#extensions) inline with your environment and security requirements.

**No plan mode.** Write plans to files, or build it with [extensions](#extensions), or install a package.

**No built-in to-dos.** They confuse models. Use a TODO.md file, or build your own with [extensions](#extensions).

**No background bash.** Use tmux. Full observability, direct interaction.

---

## CLI Reference

```bash
misul [options] [@files...] [messages...]
```

### Package Commands

```bash
misul install <source> [-l]     # Install package, -l for project-local
misul remove <source> [-l]      # Remove package
misul uninstall <source> [-l]   # Alias for remove
misul update [source|self|misul]   # Update misul and packages (skips pinned packages)
misul update --extensions       # Update packages only
misul update --self             # Update misul only
misul update --self --force     # Reinstall misul even if current
misul update --extension <src>  # Update one package
misul list                      # List installed packages
misul config                    # Enable/disable package resources
```

`misul config` and project package commands accept `--approve`/`--no-approve` to trust or ignore project-local settings for one command. `misul update` never prompts for project trust.

### Modes

| Flag | Description |
|------|-------------|
| (default) | Interactive mode |
| `-p`, `--print` | Print response and exit |
| `--mode json` | Output all events as JSON lines (see [docs/json.md](docs/json.md)) |
| `--mode rpc` | RPC mode for process integration (see [docs/rpc.md](docs/rpc.md)) |
| `--export <in> [out]` | Export session to HTML |

In print mode, misul also reads piped stdin and merges it into the initial prompt:

```bash
cat README.md | misul -p "Summarize this text"
```

### Model Options

| Option | Description |
|--------|-------------|
| `--provider <name>` | Provider (anthropic, openai, google, etc.) |
| `--model <pattern>` | Model pattern or ID (supports `provider/id` and optional `:<thinking>`) |
| `--api-key <key>` | API key (overrides env vars) |
| `--thinking <level>` | `off`, `minimal`, `low`, `medium`, `high`, `xhigh` |
| `--models <patterns>` | Comma-separated patterns for Ctrl+P cycling |
| `--list-models [search]` | List available models |

### Session Options

| Option | Description |
|--------|-------------|
| `-c`, `--continue` | Continue most recent session |
| `-r`, `--resume` | Browse and select session |
| `--session <path\|id>` | Use specific session file or partial UUID |
| `--fork <path\|id>` | Fork specific session file or partial UUID into a new session |
| `--session-dir <dir>` | Custom session storage directory |
| `--no-session` | Ephemeral mode (don't save) |
| `--name <name>`, `-n <name>` | Set session display name at startup |

### Tool Options

| Option | Description |
|--------|-------------|
| `--tools <list>`, `-t <list>` | Allowlist specific tool names across built-in, extension, and custom tools |
| `--exclude-tools <list>`, `-xt <list>` | Disable specific tool names across built-in, extension, and custom tools |
| `--no-builtin-tools`, `-nbt` | Disable built-in tools by default but keep extension/custom tools enabled |
| `--no-tools`, `-nt` | Disable all tools by default |

Available built-in tools: `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`

### Resource Options

| Option | Description |
|--------|-------------|
| `-e`, `--extension <source>` | Load extension from path, npm, or git (repeatable) |
| `--no-extensions` | Disable extension discovery |
| `--addon <path>` | Load addon directory with skills, extension, and/or MCP server (repeatable) |
| `--skill <path>` | Load skill (repeatable) |
| `--no-skills` | Disable skill discovery |
| `--prompt-template <path>` | Load prompt template (repeatable) |
| `--no-prompt-templates` | Disable prompt template discovery |
| `--theme <path>` | Load theme (repeatable) |
| `--no-themes` | Disable theme discovery |
| `--no-context-files`, `-nc` | Disable AGENTS.md and CLAUDE.md context file discovery |

Combine `--no-*` with explicit flags to load exactly what you need, ignoring settings.json (e.g., `--no-extensions -e ./my-ext.ts`).

### Other Options

| Option | Description |
|--------|-------------|
| `--system-prompt <text>` | Replace default prompt (context files and skills still appended) |
| `--append-system-prompt <text>` | Append to system prompt |
| `--goal <text>` | Run non-interactively in autonomous goal mode until the goal is achieved |
| `--assistant-prefill <text>` | Override the assistant prefill text (empty string disables prefill) |
| `--verbose` | Force verbose startup |
| `-a`, `--approve` | Trust project-local files for this run |
| `-na`, `--no-approve` | Ignore project-local files for this run |
| `-h`, `--help` | Show help |
| `-v`, `--version` | Show version |

### File Arguments

Prefix files with `@` to include in the message:

```bash
misul @prompt.md "Answer this"
misul -p @screenshot.png "What's in this image?"
misul @code.ts @test.ts "Review these files"
```

### Examples

```bash
# Interactive with initial prompt
misul "List all .ts files in src/"

# Non-interactive
misul -p "Summarize this codebase"

# Non-interactive with piped stdin
cat README.md | misul -p "Summarize this text"

# Named one-shot session
misul --name "release audit" -p "Audit this repository"

# Different model
misul --provider openai --model gpt-4o "Help me refactor"

# Model with provider prefix (no --provider needed)
misul --model openai/gpt-4o "Help me refactor"

# Model with thinking level shorthand
misul --model sonnet:high "Solve this complex problem"

# Limit model cycling
misul --models "claude-*,gpt-4o"

# Read-only mode
misul --tools read,grep,find,ls -p "Review the code"

# Disable one extension or built-in tool while keeping the rest available
misul --exclude-tools ask_question

# High thinking level
misul --thinking high "Solve this complex problem"
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `MISUL_TERMINAL_DIR` | Override config directory (default: `~/.misul/agent`) |
| `MISUL_TERMINAL_SESSION_DIR` | Override session storage directory (overridden by `--session-dir`) |
| `MISUL_PACKAGE_DIR` | Override package directory (useful for Nix/Guix where store paths tokenize poorly) |
| `MISUL_OFFLINE` | Disable startup network operations, including update checks, package update checks, and install/update telemetry |
| `MISUL_SKIP_VERSION_CHECK` | Skip the Misul Terminal version update check at startup. This prevents the `misul.dev` latest-version request |
| `MISUL_TELEMETRY` | Override install/update telemetry and provider attribution headers. Use `1`/`true`/`yes` to enable or `0`/`false`/`no` to disable. This does not disable update checks |
| `MISUL_CACHE_RETENTION` | Set to `long` for extended prompt cache (Anthropic: 1h, OpenAI: 24h) |
| `VISUAL`, `EDITOR` | External editor for Ctrl+G |

---

## Roadmap

- **Autoresearch**: Deep research mode integrated with `/goal`. The agent
  will decompose a research question into subqueries, spawn parallel
  research subagents, synthesize findings, and produce a cited report.
  Built on the existing goal mode and subagent infrastructure.

## Contributing & Development

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines and [docs/development.md](docs/development.md) for setup, forking, and debugging.

---

## License

MIT

## See Also

- [@misul/ai](https://www.npmjs.com/package/@misul/ai): Core LLM toolkit
- [@misul/agent-core](https://www.npmjs.com/package/@misul/agent-core): Agent framework
- [@misul/tui](https://www.npmjs.com/package/@misul/tui): Terminal UI components
