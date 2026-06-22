# Misul Terminal

Misul Computing's coding-agent harness and CLI runtime. North star: maximize **quality-per-dollar**.

## Layout
- `packages/{tui,ai,agent,terminal}` — the harness.
- `docs/superpowers/specs/` — vision, master findings, design.
- `docs/superpowers/plans/` — implementation plans.
- `research/` — research trail (`AUTONOMOUS-LOG.md`) and findings; `research/sources/` (gitignored) holds upstream reference clones.

## Develop
```bash
npm install
npm run build      # builds tui -> ai -> agent -> terminal -> eval
npm test           # workspace test suites
npm run verify     # build + test gate
node packages/terminal/dist/cli.js --help
```

Requires Node >= 22.19.
