# Misul Terminal

Misul Computing's internal coding-agent harness, forked from [pi-mono](https://github.com/badlogic/pi-mono) and modified into our own runtime. North star: maximize **quality-per-dollar**.

## Layout
- `packages/{tui,ai,agent,coding-agent}` — the harness (vendored from pi-mono, then modified).
- `docs/superpowers/specs/` — vision, master findings, design.
- `docs/superpowers/plans/` — implementation plans.
- `research/` — research trail (`AUTONOMOUS-LOG.md`) and findings; `research/sources/` (gitignored) holds upstream reference clones.

## Develop
```bash
npm install
npm run build      # builds tui -> ai -> agent -> coding-agent
npm test           # workspace test suites
npm run verify     # build + test gate
node packages/coding-agent/dist/cli.js --help
```

Requires Node >= 22.19.
