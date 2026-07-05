<p align="center"><img src="packages/terminal/docs/images/misul-logo-header.svg" alt="Misul Terminal"></p>

<p align="center">
  <a href="https://www.npmjs.com/package/@misul/terminal"><img alt="npm" src="https://img.shields.io/npm/v/@misul/terminal?style=flat-square" /></a>
  <a href="https://misul.org/terminal/"><img alt="website" src="https://img.shields.io/badge/website-misul.org%2Fterminal-171e2b?style=flat-square" /></a>
</p>

Misul Terminal is a minimal terminal coding harness. Adapt misul to your workflows, not the other way around, without having to fork and modify Misul Terminal internals. Extend it with TypeScript extensions, skills, prompt templates, and themes. Put your extensions, skills, prompt templates, and themes in Misul Packages and share them with others via npm or git.

- [Quickstart](https://misul.org/terminal/docs/quickstart)
- [Usage](https://misul.org/terminal/docs/usage)
- [Instant Tools](https://misul.org/terminal/docs/instant-tools)
- [Providers](https://misul.org/terminal/docs/providers)
- [Security](https://misul.org/terminal/docs/security)
- [Settings](https://misul.org/terminal/docs/settings)
- [Sessions](https://misul.org/terminal/docs/sessions)
- [Development](https://misul.org/terminal/docs/development)

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
