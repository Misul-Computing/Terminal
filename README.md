<p align="center"><img src="packages/terminal/docs/images/misul-logo-header.svg" alt="Misul Terminal" width="100%"></p>

<p align="center">
  <a href="https://discord.com/invite/3cU7Bz4UPx"><img alt="Discord" src="https://img.shields.io/badge/discord-community-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
  <a href="https://www.npmjs.com/package/@misul/terminal"><img alt="npm" src="https://img.shields.io/npm/v/@misul/terminal?style=flat-square" /></a>
</p>

Misul Terminal is a minimal terminal coding harness. Keep the core small and extend it with TypeScript extensions, skills, prompt templates, and themes.

- [Quickstart](packages/terminal/docs/quickstart.md)
- [Usage](packages/terminal/docs/usage.md)
- [Instant Tools](packages/terminal/docs/instant-tools.md)
- [Providers](packages/terminal/docs/providers.md)
- [Security](packages/terminal/docs/security.md)
- [Settings](packages/terminal/docs/settings.md)
- [Sessions](packages/terminal/docs/sessions.md)
- [Development](packages/terminal/docs/development.md)

## Packages

- [`packages/terminal`](packages/terminal) - TUI and CLI
- [`packages/ai`](packages/ai) - Provider and model abstractions
- [`packages/agent`](packages/agent) - Agent loop
- [`packages/tui`](packages/tui) - Terminal UI components
- [`packages/eval`](packages/eval) - Evaluation harness

## Install

```bash
npm install -g --ignore-scripts @misul/terminal
```

Then run `misul` in any project directory.

## Build and test

```bash
npm run build
npm test
```
