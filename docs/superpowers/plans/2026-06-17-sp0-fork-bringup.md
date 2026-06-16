# SP-0: Fork Bring-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a Misul-branded fork of pi-mono (`tui` + `ai` + `agent` + `coding-agent`) that installs, builds, tests green, and runs as the `misul` CLI on Node — the foundation every later sub-project builds on.

**Architecture:** Vendor the four pi-mono source packages into a git-managed monorepo at the project root (npm workspaces, `type: module`, Node ≥22.19, `tsgo` build, vitest, biome — all matching upstream so the baseline builds unchanged). Rebrand only the user-facing surface in SP-0 (CLI bin name, banner/version); keep internal `@earendil-works/*` package scopes and the `.pi` config dir untouched to avoid 264-file import churn and session-migration risk (deeper rebrand is a later, isolated task). No cherry-picks yet (run-collector, compaction, tokenizer swaps land in SP-1+).

**Tech Stack:** TypeScript (`@typescript/native-preview`/`tsgo`), npm workspaces, esbuild, tsx, vitest, biome. Node ≥22.19. Git (local commits only; no remote push without approval).

**Source of truth:** upstream clone at `research/sources/pi-mono` (read-only reference). Findings: `docs/superpowers/specs/2026-06-17-misul-terminal-findings.md`.

---

## File structure (created in this plan)

- Root `package.json` — Misul monorepo manifest (workspaces `packages/*`), mirrors upstream root scripts/devDeps/engines.
- Root `.gitignore` — excludes `node_modules/`, `dist/`, and `research/sources/` (the multi-thousand-file upstream clones must never enter git).
- `packages/{tui,ai,agent,coding-agent}/` — vendored upstream source (unmodified in SP-0 except the rebrand in Task 6).
- `tsconfig.base.json`, `tsconfig.json`, `biome.json` — copied from upstream root.
- `packages/coding-agent/test/smoke.misul.test.ts` — new: asserts the built CLI runs and reports Misul branding.
- `MISUL.md` — short top-level readme (what this is, how to build/run).

Note: `research/`, `docs/` already exist at root and stay. The harness lives under `packages/`.

---

### Task 1: Initialize the Misul monorepo skeleton

**Files:**
- Create: `.gitignore`, `package.json` (root), `MISUL.md`

- [ ] **Step 1: Initialize git (local only)**

Run:
```bash
cd "/c/Users/deyan/Projects/Misul Terminal"
git init -b main
```
Expected: `Initialized empty Git repository`.

- [ ] **Step 2: Write `.gitignore`** (keep the huge upstream clones and build artifacts out of git)

```gitignore
node_modules/
dist/
*.tsbuildinfo
.DS_Store
# upstream reference clones — never commit (thousands of files, own .git)
research/sources/
# raw research payloads are large; keep findings (md) but not the raw JSON dumps
research/findings-raw/
```

- [ ] **Step 3: Write root `package.json`** (mirror upstream; workspaces limited to the 4 packages we vendor — drop the example-extension workspaces for now)

```json
{
  "name": "misul-terminal",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "cd packages/tui && npm run build && cd ../ai && npm run build && cd ../agent && npm run build && cd ../coding-agent && npm run build",
    "test": "npm run test --workspaces --if-present",
    "clean": "npm run clean --workspaces"
  },
  "devDependencies": {
    "@biomejs/biome": "2.3.5",
    "@types/node": "22.19.19",
    "@typescript/native-preview": "7.0.0-dev.20260120.1",
    "esbuild": "0.28.0",
    "shx": "0.4.0",
    "tsx": "4.22.1",
    "typescript": "5.9.3"
  },
  "engines": { "node": ">=22.19.0" }
}
```

- [ ] **Step 4: Write `MISUL.md`** (one short paragraph: "Misul Terminal — internal coding-agent harness, forked from pi-mono. Build: `npm install && npm run build`. Run: `node packages/coding-agent/dist/cli.js`.")

- [ ] **Step 5: Commit**

```bash
git add .gitignore package.json MISUL.md docs/ research/AUTONOMOUS-LOG.md research/findings/
git commit -m "chore: initialize Misul Terminal monorepo skeleton"
```

---

### Task 2: Vendor the four upstream packages and install

**Files:**
- Create: `packages/{tui,ai,agent,coding-agent}/` (copied), `tsconfig.base.json`, `tsconfig.json`, `biome.json`

- [ ] **Step 1: Copy the four packages + root TS/biome config from the clone** (exclude any nested `node_modules`/`dist`/`.git`)

```bash
cd "/c/Users/deyan/Projects/Misul Terminal"
SRC="research/sources/pi-mono"
mkdir -p packages
for p in tui ai agent coding-agent; do
  rm -rf "packages/$p"
  cp -r "$SRC/packages/$p" "packages/$p"
  rm -rf "packages/$p/node_modules" "packages/$p/dist"
done
cp "$SRC/tsconfig.base.json" "$SRC/tsconfig.json" "$SRC/biome.json" .
# drop the example-extension nested workspaces that we excluded from root workspaces
rm -rf packages/coding-agent/examples/extensions/*/node_modules
```
Expected: `packages/` now holds tui, ai, agent, coding-agent with `src/` populated.

- [ ] **Step 2: Verify the source landed** (ground-truth file counts)

```bash
for p in tui ai agent coding-agent; do echo "$p: $(find packages/$p/src -name '*.ts' | wc -l) ts files"; done
```
Expected: roughly `tui: 28`, `ai: 55`, `agent: 25`, `coding-agent: 156` (matches upstream).

- [ ] **Step 3: Install dependencies**

Run: `npm install`
Expected: completes; `node_modules/` created; no peer-dep fatal errors. (If the optional `bun`-only or native deps warn, that is acceptable — the primary build is Node/tsgo. Record any hard failure and triage before continuing.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: vendor pi-mono packages (tui, ai, agent, coding-agent) as Misul base"
```

---

### Task 3: Build the baseline (unmodified upstream source)

- [ ] **Step 1: Build in dependency order**

Run: `npm run build`
Expected: each package emits `dist/`; `packages/coding-agent/dist/cli.js` exists and is chmod +x. 

- [ ] **Step 2: Verify the CLI entry built**

```bash
ls -la packages/coding-agent/dist/cli.js && node packages/coding-agent/dist/cli.js --help 2>&1 | head -20
```
Expected: help/usage text prints without a crash (it will say "pi" branding pre-rebrand — that is fine here).

- [ ] **Step 3: Triage any build failure before proceeding.** If `tsgo`/`tsc` errors on Windows/Node, capture the first error, fix the minimal cause (missing dep, path, asset copy), and re-run. Do NOT proceed to Task 4 until `npm run build` is clean. (No commit if nothing changed.)

---

### Task 4: Establish the test baseline

- [ ] **Step 1: Run the workspace test suites**

Run: `npm test`
Expected: vitest runs in ai/agent/coding-agent. Record pass/fail counts.

- [ ] **Step 2: Triage.** Some upstream tests may assume a network/key or a non-Windows shell. For each failure: classify as (a) environment-only (document + skip via `vitest` filter, do not delete) or (b) real breakage from vendoring (fix). Write the classification into `research/AUTONOMOUS-LOG.md`. The bar to pass SP-0: every non-environment test green.

- [ ] **Step 3: Commit** any skip-config or fixes.

```bash
git add -A && git commit -m "test: establish Misul baseline test suite (document environment-only skips)"
```

---

### Task 5: CLI smoke test (first new Misul code, TDD)

**Files:**
- Create: `packages/coding-agent/test/smoke.misul.test.ts`

- [ ] **Step 1: Write the failing smoke test** (asserts the built CLI starts and exits 0 on `--help`)

```ts
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, "..", "dist", "cli.js");

describe("misul cli smoke", () => {
  it("has a built cli entrypoint", () => {
    expect(existsSync(cli)).toBe(true);
  });
  it("runs --help and exits cleanly", () => {
    const out = execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
    expect(out.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it, expect PASS** (the CLI is already built from Task 3)

Run: `cd packages/coding-agent && npx vitest run test/smoke.misul.test.ts`
Expected: 2 passed. (If the cli path differs, correct the join() — do not weaken the assertion.)

- [ ] **Step 3: Commit**

```bash
cd "/c/Users/deyan/Projects/Misul Terminal" && git add packages/coding-agent/test/smoke.misul.test.ts && git commit -m "test: add Misul CLI smoke test"
```

---

### Task 6: User-facing rebrand (bin name + banner), TDD

**Files:**
- Modify: `packages/coding-agent/package.json` (bin key), and the banner/product-name string in `packages/coding-agent/src/main.ts` (locate the exact string first)
- Modify/extend: `packages/coding-agent/test/smoke.misul.test.ts`

- [ ] **Step 1: Locate the product-name/banner string** (do not guess)

Run: `cd "/c/Users/deyan/Projects/Misul Terminal" && grep -rn "Pi coding agent\|piVersion\|\"pi\"\|Pi v" packages/coding-agent/src/main.ts packages/coding-agent/src/cli.ts | head -30`
Use the result to identify the banner/version print site.

- [ ] **Step 2: Add the failing brand assertion** to the smoke test

```ts
  it("identifies as Misul, not pi, in --help or --version", () => {
    const out = execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" }).toLowerCase();
    expect(out).toContain("misul");
  });
```

- [ ] **Step 3: Run it, expect FAIL** (`misul` not present yet)

Run: `cd packages/coding-agent && npx vitest run test/smoke.misul.test.ts`
Expected: the new case FAILS.

- [ ] **Step 4: Rebrand the bin + banner.** In `packages/coding-agent/package.json` change `"bin": { "pi": "dist/cli.js" }` → `"bin": { "misul": "dist/cli.js", "pi": "dist/cli.js" }` (keep `pi` alias to avoid breaking internal scripts). In the banner string located in Step 1, change the displayed product name to `Misul Terminal`. Make the minimal edit only.

- [ ] **Step 5: Rebuild and verify PASS**

Run: `cd "/c/Users/deyan/Projects/Misul Terminal" && npm run build && cd packages/coding-agent && npx vitest run test/smoke.misul.test.ts`
Expected: all smoke cases pass, including the Misul brand assertion.

- [ ] **Step 6: Commit**

```bash
cd "/c/Users/deyan/Projects/Misul Terminal" && git add -A && git commit -m "feat: rebrand CLI surface to Misul Terminal (bin + banner)"
```

---

### Task 7: Lock the dev loop + ponytail/autoreview gate

- [ ] **Step 1: Add a `verify` script** to root `package.json` scripts: `"verify": "npm run build && npm test"`.

- [ ] **Step 2: Run the full gate**

Run: `npm run verify`
Expected: build clean, tests green (minus documented environment skips).

- [ ] **Step 3: ponytail pass.** Invoke the `ponytail` skill against the SP-0 diff; apply any simplification it surfaces (e.g. unneeded copied config, dead workspace entries). Re-run `npm run verify`.

- [ ] **Step 4: autoreview pass.** Run `/code-review` at max effort (Opus, in-session — not billed ultra) over the SP-0 diff per `~/.claude/autoreview-contract.md`; verify each finding against real code; fix actionable ones; re-run `npm run verify`.

- [ ] **Step 5: Commit + log**

```bash
git add -A && git commit -m "chore: SP-0 dev-loop + verify gate; ponytail+autoreview applied"
```
Append an SP-0-complete entry to `research/AUTONOMOUS-LOG.md`, then proceed to writing the SP-1 (eval meter) plan.

---

## Self-review

- **Spec coverage:** SP-0 scope = "runnable, tested, rebranded Misul fork." Tasks 1–7 cover init, vendor, build, test, smoke, rebrand, gate. Cherry-picks/cost-capture/tokenizer are explicitly deferred to SP-1 per findings §A/§F — not gaps.
- **Placeholders:** none — every step has a real command or real code. The two "locate the exact string" steps (Task 6.1) are grounding greps, not placeholders (the edit is gated on their result, since inventing the banner string would risk a wrong edit).
- **Consistency:** `npm run verify` defined in Task 7 used nowhere earlier; smoke test path `packages/coding-agent/test/smoke.misul.test.ts` consistent across Tasks 5–6; bin name `misul` consistent.
- **Risk note carried from findings §F:** the `bun/` subdir in coding-agent/src and `build:binary` use bun — SP-0 uses only the Node `build` (tsgo), so bun is not required; if any imported module hard-requires bun at runtime in the Node path, capture it in Task 3 triage.
