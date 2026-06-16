# Misul Terminal — Master Research Findings (locked 2026-06-17)

**Provenance:** 4 research waves + 2 adversarial critiques. Backing detail (read these for evidence/citations):
- `research/findings/01-internals.md` — Pi/oh-my-pi internals, seam map, ranked pipelines, SP-1 eval design (wf#1).
- `research/findings/02-capabilities.md` — skills, MCP, providers, reasoning, compression, system prompt, agents (wf#3, corrected).
- `research/findings/03-verification.json` — final code-only verification: telemetry, dependency-closure, type-compat, tokenizer (wf#4).
- Critiques: `01-internals-critique.json`, `02-capabilities-critique.json`. Raw: `research/findings-raw/*.json`.

**Confidence:** medium-high on architecture (verified against source); medium on quantitative pipeline impacts (single-source claims demoted — see Trust Ledger). Residual unknowns are SP-0 spikes (§F), not open research.

---

## A. Locked decisions

1. **Fork target.** Fork **minimal Pi** (`pi-mono`: `packages/ai` + `packages/agent` + `packages/coding-agent`) on the **Node** runtime. Cherry-pick algorithmic value from oh-my-pi as **vendored pure-TS**. Do **not** fork oh-my-pi wholesale (Bun lock + ~55k-line Rust crate + heavy 3-way merge surface). Rationale verified by source inspection.

2. **Cherry-pick set (verified portable, with the swap each needs).**
   - `oh-my-pi/packages/agent/src/run-collector.ts` — pure-TS; 3 import swaps to `@earendil-works/pi-ai` + ~10-line cost adapter reading pi-mono's pre-computed `Usage.cost.total`.
   - `stats/src/user-metrics.ts` (`computeUserMessageMetrics`) — copy as-is.
   - `agent/src/compaction/pruning.ts` + `shake.ts` — copy; swap `countTokens`(pi-natives Rust) → `gpt-tokenizer`. Algorithms are pure TS (superseded-read pruning, shake mechanical pre-pass).
   - `agent/src/compaction/branch-summarization.ts` — copy; swap LLM call surface to Misul's + replace `.md` `with {type:'text'}` import assertions with inline strings/Node loader.
   - `hashline/*` — copy except `NodeFilesystem` (use `node:fs`) and `computeFileHash` (`Bun.hash.xxHash32` → pure-JS xxhash32, ~5 lines). Block-level ops parse/apply are pure-TS; **the tree-sitter block resolver needs Rust → skip block-resolver ops for v1**.
   - `catalog/identity/*` subset (classify, equivalence, family, priority, selection, reference, id, dialect) — pure TS, minimal adaptation.
   - `swarm/dag.ts` as-is; `swarm/schema.ts` with `Bun.YAML.parse` → `js-yaml`. `swarm/executor.ts`/`pipeline.ts` — adapt to Misul's own runner (do not copy as-is).
   - **AVOID entirely:** `snapcompact` (Rust PNG renderer — defer visual compaction), `@oh-my-pi/pi-natives` (Rust N-API), full `@oh-my-pi/pi-utils` (import only the ~6 pure files: format, prompt, fs-error, type-guards, json, sanitize-text), `catalog/model-cache.ts` (`bun:sqlite`), oh-my-pi `stats` parser/aggregator/server (Bun-saturated).

3. **SP-1 cost-capture.** Cherry-pick `run-collector.ts` (above) for in-loop telemetry; **build the JSONL session aggregator from scratch (~40 lines)** — do not port the Bun-locked stats parser. A thin translation layer bridges pi-mono `SessionTreeEntry` ↔ the metrics shape (pi-mono lacks `duration`/`ttft`/`premiumRequests`; cost lives in `Usage.cost`).

4. **Tokenizer (two layers).** (i) **Provider `AssistantMessage.usage`** is authoritative for **cost truth and the compaction trigger** — fork pi-mono as-is. (ii) **Pre-call budgeting / cut-point sizing:** `gpt-tokenizer` (pure-TS, o200k_base) for OpenAI-family; Anthropic `/v1/messages/count_tokens` for Claude; Gemini `countTokens` for Gemini; `gpt-tokenizer` as cross-model fallback. Do **not** use `@anthropic-ai/tokenizer` (deprecated). Must count `thinkingSignature` bytes (oh-my-pi #2275 — omitting them lost ~half of provider-reported usage on thinking turns). Note Fable 5/Mythos 5 use a newer tokenizer (~30% more tokens) — pass the right model id.

5. **Model strategy.** Default to a single strong model + prompt caching + observation masking (these capture most savings). Treat Haiku/Sonnet cascade routing as a **measured experiment** (verified gain on coding is ~1.5–2.5×, not RouteLLM's 3.66× chat figure; needs coding-specific routing data + <25% escalation). Agents inherit the session model (per the mandate).

---

## B. Seam map (minimal Pi — reliable, from wf#1 §2)

Use `research/findings/01-internals.md §2`. Headlines: routing via `registerApiProvider`/`prepareNextTurn`; caching via `CacheRetention`+`sessionId` (prefer the provider-agnostic seam over `before_provider_payload`); compaction via `session_before_compact` (no auto-trigger — build it); context-gating via `transformContext` (fires every turn — keep lightweight); subagents via `AgentTool.executionMode` (carry the parallel-ordering/no-rollback hazard); skills/extensions via `registerTool`/`resources_discover`/`ResourceLoader`; cost telemetry via `AssistantMessage.usage` on the result promise (no per-session aggregation — build it; the run-collector cherry-pick provides it).

## C. Ranked token/cost pipelines (verified impacts, from wf#1 §3)

Use `01-internals.md §3`. Confidence-ordered: **prompt caching** (strong, low cost — do first), **observation masking / tool-result truncation** (~50%, strong; disable on thinking-heavy turns), **batch API for SP-1 eval runs** (50%, async only), **context pruning** (25–50%, higher effort), **surgical edit format** (directional 20–50% output), **progressive skill disclosure** (~27%, defensible), **model routing** (1.5–2.5× conservative), **structured-output discipline**. Snapcompact and subagent-isolation cost claims are demoted (see Trust Ledger).

## D. Capabilities & integration (from wf#3, corrected)

Use `research/findings/02-capabilities.md`. Headlines: skill loader already exists in pi-mono (pure-TS, progressive disclosure) — Claude Code `SKILL.md` files drop in unmodified. Bundle: oh-my-pi `system-prompts` + `semantic-compression` skills, **superpowers** (full 14, MIT), **ponytail** (full), **gpt-taste** (path `skills/gpt-tasteskill/`), pi-mono `add-llm-provider`. Browser/fetch are already built-in (fetch.ts multi-backend) → no browser-MCP fork needed for v1. Providers: OpenRouter + Claude-SDK/subscription (**ToS risk — temporary**) + OpenCode-Go (verify exact role); map onto pi-ai's provider abstraction + the routing/fallback/cost-aware layer (Pi has no retry — build it). Reasoning: unified effort selector → per-provider native control, with an **"Insane"** max tier (max thinking + multi-agent verification); detect available modes per model. Permission/sandbox, memory architecture, and the two agent designs (deep-work droid-factory + simple) are specified there.

---

## E. Trust ledger — claims NOT to rely on (verified-down)

- **ponytail "47–77% cost / 3–6× faster"** — author self-benchmark on 5 trivial tasks; *never cite*. Adopt ponytail on mechanism only.
- **MCP/browser/search multipliers** (939×, 70–95%, 99%, 9–16×) — single-vendor; directional at best.
- **RouteLLM 3.66×** — chat benchmark, not coding; use 1.5–2.5×.
- **snapcompact 67%** — compression real but quality unverified at our models (Opus-4.8 F1 ~0.60, not 0.86–0.96), vision-only, Rust renderer → **defer**; LLM-summary stays default.
- **"96% skill-disclosure drop", "subagent 9K-vs-15K 40%", "judge 85%/κ0.95"** — do not exist / misattributed (real inter-judge κ≈0.07–0.16 for open-ended).
- **SWE-bench Verified** — saturated/contaminated; use Terminal-Bench 2.0 + internal TS-edit fixtures; SWE-bench Pro only for external credibility (cite live leaderboard).
- **brave-search free tier** — eliminated Feb 2026 (now metered); don't bundle.
- **Anthropic OAuth/subscription programmatic use** — ToS risk, time-sensitive, treat the Claude-SDK provider as explicitly **temporary**.
- **char/4 estimate** — ±20–30% on code; any SP-1 percentage threshold **under ~15pp is noise**, not 5pp.
- **catalog "type-only trivial graft"** — false; types diverged (OpenAICompat ~35 vs ~15 fields, Model/Usage/KnownApi differ) → adapters required.
- **CLAUDE.md/AGENTS.md context files** — ambiguous evidence (can degrade success while raising cost); keep minimal (build/test commands only).

## F. Open items → SP-0 spikes (resolve in-build, NOT new research waves)

1. Audit oh-my-pi `agent/src/types.ts` `AgentMessage` union custom roles (bashExecution/hookMessage/branchSummary/compactionSummary) before porting compaction `estimateTokens` switch.
2. Port `thinkingSignature` byte-counting (pure TS) into the estimator.
3. Measure `gpt-tokenizer` perf on large batches (~10× slower than Rust rayon) — acceptable? cache counts.
4. Build: compaction auto-trigger (token-threshold from `message_end` usage), retry/backoff + context-overflow recovery (Pi has neither).
5. Confirm `catalog/identity/dialect.ts` import chain doesn't transitively pull model-cache (Bun).
6. Pricing freshness: regeneration CI vs runtime price-override for `models.generated.ts`.
7. SP-1 judge-calibration sprint (10–15 tasks, 2 annotators) before trusting Tier-2 rubric scores for optimization.
8. Eval isolation: Docker Desktop + WSL2 runner on Windows (thin wrapper; Pi has no orchestration).
