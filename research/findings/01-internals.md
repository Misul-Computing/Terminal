I have all the research I need. This is a synthesis task — the structured findings are provided in full above, and my job is to write the cited markdown document. No further tool calls are warranted.

# Misul Terminal — SP-0/SP-1 Research Findings

## 1. Fork-target recommendation

**Pick: Fork minimal Pi (`pi-mono` `packages/ai` + `packages/agent` + `packages/coding-agent`), then cherry-pick algorithmic value from oh-my-pi as vendored TypeScript. Do not fork oh-my-pi wholesale.**

The decision turns on runtime lock, build tax, and merge surface, all confirmed by direct code inspection.

**Why not oh-my-pi as base.** oh-my-pi is a heavy fork (v16.0.2, dual-copyright MIT — Zechner + Bölük, `oh-my-pi/LICENSE`) whose value is real but whose carrying cost is high:

- *Pervasive Bun lock.* `bun:sqlite`, `Bun.file`, `Bun.YAML`, and Bun worker threads appear in hot paths across `stats` (`packages/stats/src/aggregator.ts`, `db.ts`), `mnemopi` (`packages/mnemopi/src/core/beam/schema.ts`), `snapcompact`, and the benchmark (`packages/typescript-edit-benchmark` uses `Bun.file`, `Bun.JSONL.parseChunk`, `Bun.Archive`, `bun:sqlite`). Adopting these as-is locks the runtime to Bun; porting to Node means a `bun:sqlite`→`better-sqlite3` pass plus JSONL/tar/IO rewrites.
- *Rust build tax.* The `crates/` workspace (~55k lines, `Cargo.toml`) compiles to a single N-API `pi-natives.node` that the JS packages call synchronously. It needs Cargo + Zig (cross-compile) + napi-build, vendors patched `brush-core`/`brush-builtins`, and bundles 50+ tree-sitter grammars (`crates/pi-ast`). The only quality-per-dollar-critical consumer is `snapcompact.rs` rasterization; everything else (grep, glob, PTY, SIXEL) is performance polish.
- *Core divergence + merge burden.* oh-my-pi modifies Pi's `agent`/`ai`/`coding-agent`/`tui` heavily, so tracking upstream Pi requires 3-way merges across all layers. The repo moves fast (extensive issue-number references in source comments).
- *Feature bloat for SP-0.* Collab/WebSocket (`wire`, collab-web), the `mnemopi` memory engine, the full `stats` dashboard, Cursor discovery, ISO terminal, and flame graphs are all irrelevant to a quality-per-dollar harness.

**Why minimal Pi is the right base.** `pi-mono/packages/ai` is clean, plain-data, pure-TypeScript with no Node-specific coupling in the core. `Model<TApi>` (`packages/ai/src/types.ts:579`) is a plain object; the provider registry is a `Map` (`api-registry.ts`); the streaming protocol is a well-defined async-iterable event sequence (`utils/event-stream.ts`). The `onPayload`/`onResponse` hooks (`types.ts:115`, `:120`) exist in *every* provider and were clearly built for exactly the telemetry/routing interception Misul needs. The agent loop (`packages/agent/src/agent-loop.ts` + `types.ts`) has no Node dependency and routes all I/O through injected functions. The `faux` provider (`packages/ai/src/providers/faux.ts`) is production-quality for offline cost-accounting tests.

**Cherry-pick list (vendored TS, no Bun/Rust):**

- **hashline** (`oh-my-pi/packages/hashline`) — highest-portability package: pure TS, only `diff` + `lru-cache`, no Bun, no Rust. The `BlockResolver` seam (`hashline/src/types.ts`) degrades gracefully to `null` if you skip tree-sitter block ops. Vendor directly.
- **catalog types** (`oh-my-pi/packages/catalog/src/types.ts`, `model-manager.ts`) — no Rust/Bun deps, type-only dependency on `pi-ai`. Useful if Pi's `models.generated.ts` proves too coarse for Misul's compat needs.
- **`computeUserMessageMetrics`** (`oh-my-pi/packages/stats/src/user-metrics.ts`) — zero-dependency pure regex function; copy into the eval harness as a frustration/quality signal.
- **swarm DAG/wave/pipeline** (`oh-my-pi/packages/swarm-extension/src/swarm/{schema,dag,pipeline}.ts`) — pure TS; only `executor.ts`'s `runSubprocess` call is the porting cost (re-implement against Misul's own agent spawn).
- **snapcompact TS logic** (`oh-my-pi/packages/snapcompact/src/snapcompact.ts`) — serialize/normalize/shape-selection/archive logic is portable; the Rust rasterizer (`crates/pi-natives/src/snapcompact.rs`) is not. Defer (see §3).

**Caveats inherited from minimal Pi.** There is no built-in retry loop (`anthropic.ts:525` `maxRetries ?? 0`) — Misul's agent layer must add backoff. `models.generated.ts` is a build artifact requiring `npm run generate-models` (a 2000+-line script hitting external APIs); stale pricing silently corrupts cost math, so Misul needs either regeneration CI or a runtime price-override layer. There is no automatic compaction trigger or per-session cost accumulation in the loop — both must be built on top (see §2, §4).

---

## 2. Seam map (in the chosen base: minimal Pi)

| Concern | Seam(s) | File path(s) |
|---|---|---|
| **Model routing** | `registerApiProvider`/`getApiProvider` — wrap a built-in provider by re-registering the same `api` key, dispatching to Haiku vs Opus by task class. Also `prepareNextTurn` hook to swap model mid-session. | `pi-mono/packages/ai/src/api-registry.ts:66`; `pi-mono/packages/agent/src/agent-loop.ts:226` |
| **Prompt caching** | `CacheRetention` + `sessionId` in `StreamOptions` (`none`/`short`/`long` → provider TTLs; `sessionId` drives `prompt_cache_key`/`x-session-affinity`). `onPayload` to inject cache breakpoints beyond the built-in three positions (system prompt, last tool, last message). At harness level: `before_provider_payload`. | `pi-mono/packages/ai/src/types.ts:104,109`; `pi-mono/packages/ai/src/providers/anthropic.ts` (cache_control injection); `pi-mono/packages/agent/src/harness/agent-harness.ts:384` |
| **Context compaction** | `session_before_compact` hook — return `compaction:{...}` to substitute a custom summarizer (cheaper model, snapcompact, hashline-style), or `cancel:true`. No automatic trigger exists; the app must call `harness.compact()`. | `pi-mono/packages/agent/src/harness/agent-harness.ts:723`; pipeline in `pi-mono/packages/agent/src/harness/compaction/compaction.ts` (hardcoded `SUMMARIZATION_PROMPT`, `keepRecentTokens:20000`) |
| **Context gating** | `transformContext` hook (`AgentMessage[] → AgentMessage[]` before every LLM call) — token-budget pruning, observation masking, RAG injection, superseded-read pruning. Real-time filter, persists nothing. Fires every turn with no result caching, so must be lightweight. | `pi-mono/packages/agent/src/agent-loop.ts:283`; harness `context` event at `agent-harness.ts:430` |
| **Subagent fan-out** | `AgentTool.executionMode` (parallel default) — a tool whose `execute()` runs another loop is a subagent. `getSteeringMessages`/`getFollowUpMessages` inject mid-run. `prepareNextTurn` to route the next turn to a cheaper model. | `pi-mono/packages/agent/src/agent-loop.ts:451` (parallel dispatch), `:167`/`:253` (steering); reuse swarm DAG from oh-my-pi |
| **Skills / extensions** | `registerTool()`, `registerProvider()`, `before_agent_start` (replace system prompt per turn), `resources_discover` (inject skill/prompt/theme roots), `DefaultResourceLoader` override hooks for headless/SDK use. Extensions load via jiti at runtime. | `pi-mono/packages/coding-agent/src/core/extensions/types.ts`; `pi-mono/packages/coding-agent/src/core/resource-loader.ts`; loader at `extensions/loader.ts` |
| **Cost telemetry** | `calculateCost` — single function mutating `usage.cost` in-place; called by every provider. Cleanest hook: wrap `stream()`/`complete()` and read `AssistantMessage.usage` on the result promise. Harness exposes it via `message_end` events and `after_provider_response`. No per-session aggregation exists — build it. | `pi-mono/packages/ai/src/models.ts:39`; `Usage`/`cost` at `pi-mono/packages/ai/src/types.ts:274`; `pi-mono/packages/ai/src/stream.ts` |

Two integration warnings carried from the code findings: `calculateCost` **mutates usage in-place**, so intermediate streamed events are not authoritative — only the final `AssistantMessage` from `result()` is. And `before_provider_payload` receives the **provider-specific serialized payload**, so any cache-breakpoint injection there is provider-coupled and breaks on provider switch — prefer the provider-agnostic `CacheRetention` seam where possible.

---

## 3. Ranked token/cost pipelines (by expected quality-per-dollar)

Impacts below use the **verification verdicts and corrected numbers**, not the raw claims. "Hooks which seam" references §2.

| Pipeline | Verified impact (corrected) | Evidence quality | Impl cost | Hooks which seam |
|---|---|---|---|---|
| **Prompt caching (static-prefix ordering)** | **supported.** 90% off cached-input tokens ($0.30 vs $3.00/MTok Sonnet 4.6); 41–80% overall multi-turn reduction (arxiv:2601.06007, 500+ sessions). Break-even at 2 reads (1h-TTL write = 2× input). First-party case: 7%→74% cache-hit, −59% cost (ProjectDiscovery). | Strong | Low | Prompt caching (`CacheRetention`+`sessionId`); order system/tools/skills before per-turn messages; never mutate prefix mid-session |
| **Observation masking / tool-result truncation** | **supported.** ~50% cost cut at equal-or-better solve rate (Qwen3-Coder 480B $1.29→$0.61, −52.7%; Gemini 2.5 Flash $0.41→$0.18, −56.1%; NeurIPS 2025 DL4Code). **Caveat:** degrades quality with thinking enabled (Gemini Flash 36.4% vs 40.4% raw) — disable for thinking-heavy turns. Modifying old results invalidates KV cache → blank only when suffix ≤8K or past cache TTL. | Strong | Low | Context gating (`transformContext`) + `tool_result` post-processing |
| **Batch API for eval runs (SP-1 only)** | **supported.** 50% off input+output for async; stacks with caching to ~95% off cached batch inputs. Zero quality impact. Async-only (24h SLA) — perfect for SP-1, not interactive sessions. | Strong | Medium | Cost telemetry / routing (eval-harness dispatch path) |
| **Context engineering / aggressive pruning (full pipeline)** | **supported.** SWE-Pruner 23–54% token cut *while improving* success (peer-reviewed, but unreviewed preprint + needs a trained 0.6B skimmer → SP-2+). AgentDiet 39.9–59.7% input / 21.1–35.9% total cut, no perf loss (FSE 2026) — **note:** reflection LLM is GPT-5 mini, *not* GPT-4o mini as widely cited. Conservative aggregate 25–50%. | Moderate–Strong | High | Context gating (`transformContext`); superseded-read pruning |
| **Surgical edit format (hashline / search-replace)** | **overstated→directionally sound.** Author-run only: 61% output-token cut (Grok 4 Fast), ~30% (Opus); Grok Code Fast 1 6.7%→68.3% success. No independent replication; private benchmark. Mechanism (emit only changed lines + hash verify) is sound and replicable → conservative 20–50% output cut on large-file/small-edit. | Moderate (author-run) | Medium | Skills/tools (register edit tool); reduces retries (quality lift, §5) |
| **Model routing (Haiku/Sonnet cascade)** | **overstated.** RouteLLM 3.66× is MT-Bench chat on GPT-4/Mixtral — **not transferable** to coding or to Haiku/Sonnet without retraining. Haiku 4.5 ≈90% of Sonnet coding quality shrinks the routable gap → conservative **1.5–2.5×** on coding, contingent on <25% escalation rate. Requires coding-specific preference data first. | Moderate | High | Model routing (`registerApiProvider` wrapper / `prepareNextTurn`) |
| **Progressive disclosure / context gating (skill libraries)** | **overstated.** SkillReducer 26.8% end-to-end input savings, 86% quality retention (+2.8% mean), 55K-skill study — **defensible number.** The widely-cited "96% drop for simple tasks" **does not exist at its cited URL — drop it.** | Moderate | Medium | Skills/extensions (`resources_discover`; metadata-only in prompt, full SKILL.md on demand) |
| **Structured-output format discipline** | **supported.** JSON ≈2× TSV tokens (tabular); strict-JSON mode −10–15% reasoning (EMNLP 2024). Rule: free-form reasoning, structured conversion only as final step. | Moderate–Strong | Low | Context gating / tool output formatting |
| **Snapcompact (bitmap-frame archival)** | **overstated / needs own measurement.** 67% text→image compression confirmed by billing formulas. **But SQuAD F1 in the survey is wrong** — Opus-4.8 scores 0.601 (not the claimed 0.86–0.96 range); Fable-5 0.882. Thinking-token decode cost "can eat the savings in a single pass." Single-author, zero independent replication; vision-only. **README shape table is stale — source of truth is `snapcompact.ts:248-266` + CHANGELOG (v16.0.1, 2026-06-15: Anthropic→`11on16-bw`, Google→`8on22-bw`).** | Moderate→author-run | High | Context compaction (`session_before_compact`); LLM-summary fallback stays default |
| **Subagent fan-out (isolated contexts)** | **UNVERIFIABLE for cost.** The 9K-vs-15K (40%) figure does not exist at any source; the 887K-tok/min "crisis" is promotional. The *only* confirmed fact is structural and a **risk**: isolated subagents do **not** share KV cache, so each pays full input price. The cost lever is model-tiering (cheap "smol" subagents), not isolation per se. | Anecdotal / unverifiable | High | Subagent fan-out (`executionMode`); reuse swarm DAG |

---

## 4. SP-1 eval harness — minimal credible design

The goal is a quality-per-dollar (QpD) signal trustworthy enough to A/B harness changes. Grounded in `oh-my-pi/packages/typescript-edit-benchmark` and the eval-methodology findings.

**Task suite (30–50 tasks, three tiers).**
- *Tier 1 (15–20):* coding tasks with deterministic test-execution grading, drawn from **real observed agent failures**. The TS edit-benchmark fixture format (`input/`, `expected/`, `prompt.md`, `metadata.json`; `typescript-edit-benchmark/src/tasks.ts`) is a stable, model-agnostic contract — reuse it, or generate fresh fixtures by pointing `generate.ts` at Misul's own TS code (20 AST mutation types, difficulty scoring in `generate.ts:scoreDifficulty`).
- *Tier 2 (10–15):* end-to-end CLI workflows without pre-written tests, graded by decomposed rubrics.
- *Tier 3 (5–10):* Terminal-Bench 2.0 public tasks (**verified:** 89 CLI-native tasks, Harbor framework, Stanford/Laude, arxiv:2601.11868) as an external anchor.
- **Skip for internal iteration:** SWE-bench Verified — **verified saturated and contaminated**, formally abandoned by OpenAI Feb 2026 (o3 ~90% on a benchmark OpenAI itself called contaminated; 32.67% solution-leakage / 31.08% inadequate-tests are from SWE-bench+, arxiv:2410.06992, *not* UTBoost). Use SWE-bench Pro only for external credibility, and cite the **live leaderboard** (43–59% top public, not the stale "23%").

**Scoring.** Tier 1: binary test-execution pass/fail (zero judge variance, zero per-judgment cost). Tier 2: domain-expert-authored decomposed rubrics (3–5 weighted yes/no leaves) — **verified** to beat LLM-authored rubrics (LH-Bench κ=0.60 vs 0.46, arxiv:2603.22744). Partial credit raises sensitivity on small suites. Combine to one task score in [0,1].

**LLM-judge discipline (Tier 2).** Use a judge from a **different model family** than the agent (self-enhancement bias confirmed, magnitude model-specific). Swap output ordering (position bias). **Critical correction:** the widely-cited "85% human agreement / κ≈0.95" is **misattributed** — arxiv:2604.27727 actually reports inter-judge κ=0.07–0.16 for open-ended tasks. Do **not** assume calibration; **budget one calibration sprint** (10–15 tasks, 2 human annotators) and measure real agreement on Misul's own distribution before trusting Tier 2 scores for optimization.

**Cost capture.** Wrap the cost path (§2): in pure Pi, attach to the `stream()`/`complete()` result promise and read `AssistantMessage.usage`; sum across calls (Pi has **no** per-session aggregation). The cleanest accounting borrows oh-my-pi's split — input/output/**cacheRead**/cacheWrite — because folding cache reads into input (as the TS edit-benchmark currently does, `diffTokenStats`) overstates cost ~10×. Track **cache_hit_ratio = cacheRead/input** as a first-class diagnostic; it dominates cost reproducibility across runs. Backfill formula and live cost-per-request schema are reusable from `oh-my-pi/packages/stats/src/db.ts` (`calculateCatalogCost`).

**QpD metric.** `QpD = mean(task_score) / mean(cost_usd_per_task)`. Track quality and cost as **independent time series** (a system that fails cheaply has high QpD, zero value). Also track `cost_of_pass = total_cost / tasks_passed`. **Verified backing:** CLEAR (arxiv:2511.14136) — cost-aware agents reach equal performance at 4.4–10.8× lower cost; Efficient Agents (arxiv:2508.02694) — 28.4% cost-of-pass improvement on GAIA.

**Runs-for-signal.** Minimum 3 seeds per task per cycle (90–150 runs at $30–$150/cycle). **Verified:** single-run pass@1 varies 2.2–6.0 pp even at temp 0 (arxiv:2602.07150, 60k trajectories) — improvements below ~5 pp are noise. Report pass@1 and pass^k. For A/B of a harness change, use **matched-pairs**: same tasks+seeds for both variants, McNemar for binary (≥10 discordant pairs — practically aim ≥25), bootstrap CI (1000 resamples) on the delta; ship only when the 95% CI excludes zero (all methodology-verified).

**Isolation.** Each run from a clean container/subprocess. On Windows 11, Docker Desktop + WSL2 is sufficient for SP-1; Pi has no container orchestration, so add a thin runner. Skip Kubernetes and ICC analysis until SP-2+.

**Best-run selection.** The TS edit-benchmark's `isBetterRun` (`runner.ts:1724`) is self-contained and replaceable — swap it to prefer the **cheapest successful** run to make cost a first-class optimization target.

---

## 5. Quality-lift instruction techniques worth adopting (with cost tradeoffs)

Ordered by verified quality-per-dollar; all four below are net-positive or low-risk.

- **Concise, principle-based system prompt (RFC-2119 constraints).** *Strongly positive on both axes* — shorter prompts cut input tokens every call and reduce attention dilution. Adopt oh-my-pi's `system-prompt.md` structure as the base template. Tradeoff: none (verbose prompts actively hurt — see CLAUDE.md note below).
- **Tool-use discipline (specialized tools over shell, parallel batching, pruned manifests).** *Strongly positive* and **best-evidenced quality-lift in the survey** (GitHub: 19–62% token cut across 109 production runs; AWO meta-tools +4.2 pp success, peer-reviewed). Fewer failed edits → fewer retries. Tradeoff: medium build cost, permanent per-call return.
- **Verification loops, hard-capped at 3 rounds.** *Positive for rounds 1–2, rapidly negative after.* Rounds 1–2 capture ~75% of recoverable gain; a 10-cycle loop costs ~50× a single pass. Only meaningful for tasks with runnable test oracles. The loop-count ceiling is the primary cost lever.
- **Explore-plan-implement phase separation.** *Net positive* on multi-file changes (conservative 10–20 pp; the headline 17%→53% SICA / 12%→50% TDAD numbers are full-system, not isolated). Tradeoff: a read-only plan pass adds tokens upfront; **skip for single-file/trivial edits** (the diff fits in one sentence).
- **Adaptive thinking-level routing.** *Positive when routed, negative if uniform.* A cheap classifier sets the extended-thinking budget per task; thinking tokens bill at output rate, so applying them to trivial tasks is pure waste. Budget 4k–10k (medium coding), 16k–32k (architecture/debug); diminishing returns above 32k.
- **Subagent decomposition with model-tiering** (cheap model for exploration, capable for plan/review). *Positive for complex multi-file, negative for simple.* CodeAgents 55–87% input cut with +3–36 pp gains (wide range = decomposition-overhead-dominated at the low end).

**Use sparingly / avoid as defaults:** Self-consistency sampling — *worst QpD in the survey* (≈1.8 pp gain at 4.9× cost); tie-breaking only. Inference-time MCTS — verified 23% relative gain on SWE-bench Lite but unquantified 10–100× compute; SP-3+ for highest-stakes debugging only.

**Two cautionary corrections.** *Trust-framing* (the "+59% hidden issues / +83% steps") is from a single-author preprint with compounding validity threats (author designed the method, the scenarios, and the eval; no inter-annotator agreement; implausible Cohen's d=2.28–3.51) — include a neutral trust line (oh-my-pi already does) but **do not architect around the magnitudes**. *CLAUDE.md/AGENTS.md context files* are *ambiguous*: ETH Zurich found LLM-generated files **degrade** success 2–3% while raising cost >20%. Keep them minimal — build commands and test runners only (high-signal, non-inferrable); exclude directory trees and standard conventions.

---

## 6. Competitive insights to steal

- **Prefix-ordered prompt caching is table stakes** and the single highest-ROI move (Claude Code calls it "everything"). Layer order: system + tool defs → project context → conversation. **Steal the cache-keepalive ping** (Aider: ping every 5 min to extend Anthropic's 5-min TTL across long idle gaps).
- **Aider's PageRank repo-map** — tree-sitter symbol graph ranked by NetworkX PageRank (chat-mentioned files 50×, well-named identifiers 10×), binary-searched to a ~1k-token budget. Structural repo awareness at fixed low token cost; adoptable without reading full files. (`aider.chat/docs/repomap.html`.)
- **LSP diagnostic feedback loop** (OpenCode: 40+ servers, 150 ms debounce, dedup) — feed compiler/type errors back after each edit for self-correction without test runs. Compact messages, low token cost, high quality impact. oh-my-pi already has LSP support to reference.
- **Progressive skill disclosure** (Codex CLI + oh-my-pi `skill://`) — name+description in the prompt (~dozens of tokens each), full content lazy-loaded on use; cap the listing at ~2% of context. Adopt as the SP-0 skills/pipelines baseline.
- **Structured handoff-document compaction** (oh-my-pi `handoff-document.md`: Goal / Progress / Key Decisions / Critical Context) beats naive summarization for resumability; the `shake` mechanical pre-pass (drop tool-results / >400-token blocks before LLM compaction) and **always-on superseded-read pruning** (`[Superseded by newer read]`) are near-zero-cost wins.
- **Model-tiered subagents** (oh-my-pi: `smol` for explore, `slow` for plan/review) — the real cost lever in fan-out, since isolated contexts cannot share KV cache.

What to beat: **no competitor publishes an integrated quality-per-dollar benchmark.** Claude Code has the best caching docs; oh-my-pi the most sophisticated compaction/edit pipeline. Misul's SP-1 harness measuring quality *and* dollars as one compound metric across technique combinations is genuinely differentiating.

---

## 7. Open decisions

1. **Bun vs Node runtime.** The fork recommendation assumes Node, which forces porting work on any Bun-locked cherry-pick (snapcompact rasterizer, stats DB, mnemopi). If Bun is accepted (defensible for performance), oh-my-pi becomes a more attractive base — at the cost of the upstream-merge and Rust-build burdens. **Decide before SP-0**, because it gates every other cherry-pick.
2. **Model strategy / routing.** Routing's verified gain on coding is only 1.5–2.5× (not RouteLLM's 3.66× chat figure) and requires **coding-specific preference data** plus a <25% escalation rate. Decide whether to invest in collecting that data, or default to a single strong model + caching + masking (which already capture most of the savings).
3. **Snapcompact adoption.** 67% compression is real but quality is unverified at Misul's models (Opus-4.8 F1 0.601, not 0.86–0.96), vision-only, and thinking-token decode can erase savings. Needs an internal provider-aware billing+recall measurement before enabling by default; LLM-summary stays the safe default. Also: any integration must read shapes from `snapcompact.ts`/CHANGELOG, **not** the stale README.
4. **Pricing freshness.** `models.generated.ts` is a build artifact; stale rates silently corrupt cost math. Decide between regeneration CI (owning a 2000+-line external-API script) vs a runtime price-override layer. Also replicate OpenAI's `applyServiceTierPricing` (flex 0.5×, priority 2–2.5×) if tiered pricing is used.
5. **Retry/backoff ownership.** Pi has no retry loop (`maxRetries ?? 0`). Misul must build retry + context-overflow recovery (`utils/overflow.ts` offers detection only) at the agent layer for production reliability.
6. **Compaction trigger.** No automatic trigger exists in the loop; `harness.compact()` requires `phase=='idle'`, creating a between-turn pause. Misul must build the trigger (token-threshold from `message_end` usage) and decide UX for the pause.
7. **Sandboxing.** Codex CLI uses Bubblewrap + Landlock + Seccomp; SP-1 isolation needs only Docker Desktop + WSL2 on Windows. Decide the production sandboxing target (local CLI vs container) separately from the eval-isolation requirement.
8. **Judge calibration risk (SP-1 blocker).** Inter-LLM-judge agreement for open-ended coding is κ≈0.07–0.16, far below the misattributed "85%." Tier 2 rubric scores are noisier than assumed; budget a calibration sprint and lean on narrow binary leaves before trusting Tier 2 for optimization decisions.