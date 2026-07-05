# Misul Terminal Documentation

Misul Terminal is a minimal terminal coding harness. It is designed to stay small at the core while being extended through TypeScript extensions, skills, prompt templates, themes, and Misul packages.

## Quick start

Install Misul Terminal with npm:

```bash
npm install -g --ignore-scripts @misul/terminal
```

`--ignore-scripts` disables dependency lifecycle scripts during install. Misul Terminal does not require install scripts for normal npm installs.

On Linux or macOS, you can also use the installer:

```bash
curl -fsSL https://misul.dev/install.sh | sh
```

To uninstall Misul Terminal itself, use npm for curl and npm installs:

```bash
npm uninstall -g @misul/terminal
```

For pnpm, Yarn, or Bun installs, use the matching global remove command: `pnpm remove -g @misul/terminal`, `yarn global remove @misul/terminal`, or `bun uninstall -g @misul/terminal`.

Then run it in a project directory:

```bash
misul
```

Authenticate with `/login` for subscription providers, or set an API key such as `ANTHROPIC_API_KEY` before starting misul.

For the full first-run flow, see [Quickstart](quickstart.md).

## Start here

- [Quickstart](quickstart.md) - install, authenticate, and run a first session.
- [Using Misul Terminal](usage.md) - interactive mode, slash commands, context files, and CLI reference.
- [Instant Tools](instant-tools.md) - local /read, /grep, /edit, and /todo commands.
- [Providers](providers.md) - subscription and API-key setup for built-in providers.
- [Security](security.md) - project trust, sandbox boundaries, and vulnerability reporting.
- [Containerization](containerization.md) - sandbox misul with Gondolin, Docker, or OpenShell.
- [Settings](settings.md) - global and project settings.
- [Keybindings](keybindings.md) - default shortcuts and custom keybindings.
- [Sessions](sessions.md) - session management, branching, and tree navigation.
- [Compaction](compaction.md) - context compaction and branch summarization.

## Customization

- [Extensions](extensions.md) - TypeScript modules for tools, commands, events, and custom UI.
- [Skills](skills.md) - Agent Skills for reusable on-demand capabilities.
- [Prompt templates](prompt-templates.md) - reusable prompts that expand from slash commands.
- [Themes](themes.md) - built-in and custom terminal themes.
- [Misul packages](packages.md) - bundle and share extensions, skills, prompts, and themes.
- [Custom models](models.md) - add model entries for supported provider APIs.
- [Custom providers](custom-provider.md) - implement custom APIs and OAuth flows.

## Programmatic usage

- [SDK](sdk.md) - embed misul in Node.js applications.
- [RPC mode](rpc.md) - integrate over stdin/stdout JSONL.
- [JSON event stream mode](json.md) - print mode with structured events.
- [TUI components](tui.md) - build custom terminal UI for extensions.

## Reference

- [Session format](session-format.md) - JSONL session file format, entry types, and SessionManager API.

## Platform setup

- [Windows](windows.md)
- [Termux on Android](termux.md)
- [tmux](tmux.md)
- [Terminal setup](terminal-setup.md)
- [Shell aliases](shell-aliases.md)

## Development

- [Development](development.md) - local setup, project structure, and debugging.
