I now have comprehensive, verified, cited material across all eleven required sections, including the harness seams, eval/telemetry caveats, and trust-ledger items. I have everything needed. Writing the corrected synthesis document now.

# Misul Terminal — Capabilities & Integration Findings (corrected)

This document supersedes the failed prior synthesis. Every recommendation is grounded first in **what the chosen base (`pi-mono`: `packages/ai` + `packages/agent` + `packages/coding-agent`) already provides**, then in what is genuinely worth porting or forking from oh-my-pi. Claims refuted by the prior critique are flagged in the Trust Ledger (§11) and are not relied upon here. Local clones are read-only; file paths are cited exactly.

A foundational correction governs the entire document: **pi-mono's `packages/agent` ships ZERO built-in agent tools** — it provides only the harness loop, session persistence, compaction, skills loading, system-prompt construction, and an `ExecutionEnv`/`FileSystem` abstraction. Tools are supplied by the application via the `tools` array in `AgentHarnessOptions` (`pi-mono/packages/agent/src/harness/types.ts:800-805`). pi-mono's `packages/coding-agent` ships as a pre-built binary; its tool source is **not** in the repo (`pi-mono/packages/coding-agent/README.md:20-24`). Therefore "what the base provides" for *tools* means: the harness slots, plus whatever Misul ports in. For *subsystems* (skills, compaction, trust, approval hooks), the base provides substantial, clean, pure-TS machinery that should be reused as-is.

---

## 1. Best skills to bundle

### Real skill-loading mechanism (the base already provides this — reuse it)

pi-mono's `packages/coding-agent` ships a complete, clean, pure-TS skill subsystem. **No porting is needed for the loader itself.**

- **Discovery** (`pi-mono/packages/coding-agent/src/core/skills.ts`): Markdown files discovered at startup. If a directory contains `SKILL.md` it is a skill root (no recursion); otherwise direct `.md` files at the scan root load. Two default roots: `agentDir/skills` (user scope) and `cwd/.pi/skills` (project scope), plus explicit CLI paths. Frontmatter requires a non-empty `description`; `name` falls back to the parent directory name. `disable-model-invocation: true` hides a skill from the prompt listing while still allowing explicit `/skill:name`. Collisions resolve first-writer-wins. Pure Node `fs` plus the `ignore` npm package.
- **Prompt injection** (`skills.ts:335`, `formatSkillsForPrompt`): emits an XML `<available_skills>` block of `<name>/<description>/<location>` stubs; the agent reads the `SKILL.md` path on demand. Injected by `buildSystemPrompt` (`system-prompt.ts:164`) only when the `read` tool is active. This **is** the progressive-disclosure / stub-injection pattern (~3–5 tokens/skill in prompt; full body lazy-loaded).
- **`/skill:name` expansion** (`agent-session.ts:1175`): strips frontmatter, wraps the body in a `<skill name=… location=…>` block, appends args verbatim.
- **ResourceLoader** (`resource-loader.ts`, `DefaultResourceLoader`): central coordinator for skills, extensions, prompt templates, AGENTS.md context, and system-prompt overrides. `reload()` resolves enabled paths via `packageManager.resolve()`; `skillsOverride`/`extensionsOverride` callbacks allow programmatic injection — the clean SDK seam for headless Misul pipelines.

**Implication:** any SKILL.md from the Claude Code ecosystem is directly portable into Misul with no modification. There is **no** `skill://` URL expansion in pi-mono bash (grep of `pi-mono/.../core/tools/bash.ts` returns no matches); that is an oh-my-pi-only feature (`oh-my-pi/.../tools/bash-skill-urls.ts:11`).

### Recommended bundle

| Skill | What | Why best | License | Action | Integration given the real mechanism |
|---|---|---|---|---|---|
| **oh-my-pi `system-prompts`** | Meta-skill: tag vocabulary, RFC-2119 keyword discipline, density rules (5–12 words/bullet), lost-in-the-middle positioning, anti-pattern table | Already in the local clone; **verified** accurate line-by-line; teaches how to author every other Misul prompt/skill | MIT (Zechner/Bölük) | **fork-and-brand** | Copy `oh-my-pi/.omp/skills/system-prompts/SKILL.md` → `.misul/skills/`. Pure SKILL.md, zero coupling. |
| **oh-my-pi `semantic-compression`** | Three-tier token-deletion rules for agent-authored text; preserves negation/numbers/RFC keywords | Already in clone; **verified**; directly serves quality-per-dollar | MIT | **fork-and-brand** | Same path pattern. Note: tiers are **categorical (always/unless/only-if), not numeric** — do not market a "% savings" figure. |
| **superpowers (full 14-skill bundle)** | TDD, systematic-debugging, brainstorming→writing-plans→executing-plans, code-review pair, git-worktrees, etc. | **verified `supported`**; de-facto community standard; MIT; pure SKILL.md; skills cross-reference each other | MIT (obra) | **reference/reuse-as-is** | Point `skills[]` at the `skills/` dir or symlink individual skills into `.misul/skills/`. Install **all together** (brainstorming terminates into writing-plans). |
| superpowers `test-driven-development` + `systematic-debugging` | Iron-Law TDD; four-phase root-cause loop | **verified `supported`** verbatim against source | MIT | reuse-as-is | Auto-load on task match; pairs together. |
| **ponytail (Full intensity)** | Five-rung minimal-code decision ladder | MIT, pure SKILL.md, zero runtime cost | MIT | reuse-as-is | Copy `skills/ponytail/SKILL.md`. See premise resolution below. |
| **taste-skill / gpt-taste** | Frontend anti-slop design enforcement (GSAP, bento grids, typography variance) | gpt-taste **confirmed to exist**; useful for frontend output quality | MIT (Leonxlnx) | reuse-as-is (frontend only) | See premise resolution below for the **corrected directory path**. |
| pi-mono `add-llm-provider` (internal) | Seven-step checklist + full provider test matrix incl. `cross-provider-handoff.test.ts` | **verified**; load-bearing for Misul, which forks the provider layer | MIT | fork-and-brand | Keep in `.misul/skills/`; update file paths in step 6 to Misul's layout. |

**Resolving the two premises:**

- **gpt-taste premise (resolve):** gpt-taste is real and installable, but the prior survey's integration path was **wrong**. The on-disk directory is `skills/gpt-tasteskill/` (not `skills/gpt-taste/`); `gpt-taste` is the frontmatter `name:`. For direct copy, the correct source is `skills/gpt-tasteskill/SKILL.md`. No published benchmark exists — adopt for frontend tasks on architectural merit, not on numbers.
- **ponytail premise (resolve):** ponytail is real, MIT, and its decision ladder/intensity modes are confirmed. Its headline **"47–77% cost reduction / 3–6× faster" numbers are self-benchmarked by the author on five trivial utility tasks with no independent replication** (verdict: `overstated`). Bundle it on mechanism (shorter output → lower cost), but **never cite those multipliers** in any external or internal quality-per-dollar claim. Star counts (claimed ~24.1k) are volatile and non-load-bearing.

**Do not bundle on a cost basis:** `pi-skills/brave-search` — its free tier was **eliminated Feb 2026** (now metered, ~$5/1,000 queries, card required) and the latency estimate is unsourced (verdict: `refuted`). Misul's ported `fetch` tool (see §2) supersedes it.

---

## 2. MCP plan (reframed: base first, then what to fork)

The prior synthesis recommended forking external MCP servers for browser/computer-use/code-search. **Direct source inspection contradicts this for browser and fetch, and largely for code-search.** The first question for a fork is "what does the base already provide" — and the answer changes the recommendation.

### Browser / web-fetch — already built-in, no MCP needed
- **`fetch.ts`** (`oh-my-pi/.../tools/fetch.ts`, 1938 lines): multi-backend web reader — HTTP, PDF/DOCX, SQLite, archives, HTML→markdown via a ranked fallback chain (native → trafilatura → lynx → Parallel → Jina), RSS/Atom, `llms.txt` discovery, line-range URL selectors. The `read` tool delegates URL handling here. **port-as-TS:** drop the pi-natives `htmlToMarkdown` import and rely on the trafilatura/lynx/Jina fallbacks already present; swap `bun:sqlite`→`better-sqlite3`, `Bun.Archive`→`fflate`+`tar`. The bulk is pure-TS HTTP orchestration.
- **`browser.ts`** (`oh-my-pi/.../tools/browser.ts`, 411 lines): full stateful multi-tab Puppeteer/CDP controller (open/run/close, `tab.observe/screenshot/fill/click`, 14 stealth scripts). **port-as-TS:** keep `puppeteer-core`, replace `Bun.write`→`fs.writeFile`, strip the cmux paths.

A Jina/Parallel MCP would be **partially redundant** with `fetch.ts`, which already calls those APIs as fallback backends.

### Code-search — built-in tools, port don't fork
- **`search.ts`** (1598 lines): ripgrep text search with pagination, context lines, archive-member and virtual-resource search. The filesystem path is bound to the Rust pi-natives `grep` binding; the **practical port is to call the system `rg` binary via `child_process`** (the same subprocess pattern `fetch.ts` uses for trafilatura/lynx), preserving the tool's schema, formatting, and pagination verbatim. The ~500-line pure-TS virtual-resource regex engine ports as-is.
- **`find.ts`** (636 lines): **port-as-TS** — the `FindOperations` pluggable interface was designed for backend swap; replace the native glob with `fast-glob`.
- **`ast-grep.ts` / `ast-edit.ts`**: **skip** — hard Rust dependency (ast-grep-core + 40+ tree-sitter grammars in pi-natives), no TS fallback. Ripgrep regex covers the practical case.
- **`search-tool-bm25.ts` + `tool-discovery/`**: **port-as-TS** — pure-TS BM25 index over the tool catalog (built-ins + MCP). This directly solves the "MCP catalog too large" problem and makes any external "tool-discovery MCP" redundant.

### What is genuinely worth forking + branding as an MCP

After the base is accounted for, the only categories with a real gap are **(a) external computer-use (OS-level GUI control)** and **(b) Web-Vitals/Lighthouse auditing**, which the built-in Puppeteer tool does not do.

- **Web-Vitals/Lighthouse:** `ChromeDevTools/chrome-devtools-mcp` (Apache-2.0) is the only MCP with native Lighthouse, Core Web Vitals, and V8 heap snapshots. Its "15–20% faster / 11KB-vs-326KB" figures are **single-source vendor (Lightpanda) marketing** — do not rely on them. Adopt only if Misul needs perf auditing; otherwise the built-in browser tool suffices.
- **OS-level computer-use:** `zavora-ai/computer-use-mcp` (MIT, Rust NAPI) is the credible Windows/macOS choice; its headline multipliers (939×, 31×) are **single-source README claims** (verdict: `overstated`) — the Rust-in-process-vs-Python *direction* is plausible, the magnitudes are not established.
- **AGPL hard-block:** `lightpanda` is **AGPL-3.0 with no commercial exception** — legal blocker for a proprietary fork. Avoid.
- **Baseline:** `modelcontextprotocol/servers` filesystem (MIT, **verified `supported`**) is a fine reference for the MCP wire contract.

**Concrete speed strategy:** keep any MCP browser warm across calls (cold start ~250–400 ms dominates); prefer ARIA-snapshot text over screenshots in loops (the "13× context accumulation" is real but applies to **screenshot/vision mode**, not ARIA text — it was measured on the claude-in-chrome extension, not Playwright ARIA); cap snapshot size to avoid context overflow; for code-search use in-process `rg` not an MCP round-trip. **Budget for MCP latency rather than assuming speed gains** — all browser/search MCP speed multipliers in the prior research are single-source (see §11).

---

## 3. Provider + auth + routing plan

### Mapping to pi-ai (the base already implements these providers correctly)

- **OpenRouter** — first-class in pi-mono: `KnownProvider` (`types.ts:38`), auto-detected `thinkingFormat:'openrouter'` and `cacheControlFormat:'anthropic'` for `anthropic/*` models (`openai-completions.ts:1105-1163`), full `OpenRouterRouting` interface (`types.ts:497-564`). Fees: 5.5% card / 5% crypto on credit purchase, **no per-token markup**; BYOK free first 1M req/month then 5% (verified against OpenRouter primary sources). **reuse-as-is** as primary fallback gateway. *Doc correction:* the "5-min/1h TTL" and "0.1×/0.25× cache-read" figures the prior survey attached to OpenRouter are **provider-side Anthropic/OpenAI ratios**, not OpenRouter's own response-cache (which is zero-token on hit). Treat "300+ models" as a lower bound.
- **OpenCode-Go — what it is:** a **flat-rate subscription gateway** sold by Anomaly Innovations Inc. ($10/month, ~$5 first month; caps $12/5h, $30/week, $60/month), exposing ~13 open-source coding models via one key. It is **not** the open-source opencode Go CLI. pi-mono implements it fully as `KnownProvider` (`types.ts:51`) with **13 model entries** at `models.generated.ts:8568-8803`: `deepseek-v4-flash`, `deepseek-v4-pro`, `glm-5`, `glm-5.1`, `kimi-k2.6`, `kimi-k2.7-code`, `mimo-v2.5`, `mimo-v2.5-pro`, `minimax-m2.7`, `minimax-m3`, `qwen3.6-plus`, `qwen3.7-max`, `qwen3.7-plus`. Ten use `openai-completions` (`https://opencode.ai/zen/go/v1`); **three** (`minimax-m3`, `qwen3.7-max`, `qwen3.7-plus`) use `anthropic-messages` (`https://opencode.ai/zen/go`, no `/v1`). `deepseek-v4-flash/pro` set `requiresReasoningContentOnAssistantMessages:true` (history replay must include `reasoning_content`). **reuse-as-is** for single-user low-cost tracks. **ToS constraint:** "internal use only, not on behalf of any third party" — Misul cannot route multiple users through one subscription; each user supplies their own `OPENCODE_API_KEY` (and `opencode`/`opencode-go` share that env key, `env-api-keys.ts:97-98`, so they cannot hold separate quotas).
- **Claude-SDK / OAuth subscription — ToS risk:** pi-mono has a complete, technically accurate OAuth/PKCE stealth implementation (`anthropic.ts:72-109` stealth headers, `:789` `isOAuthToken`, system-prompt injection, tool-name remapping). **Do not use it.** Verdict: `refuted` — Anthropic deployed a hard technical block (April 4, 2026; pi-mono issue #3372), header spoofing was patched, and the path returns 400 for third-party tools. Build **exclusively on API-key auth**; use OpenRouter's Anthropic provider as the recommended wrapper. Gate any carried-forward OAuth code behind a prominent deprecation warning. (See §11 for the time-sensitivity caveat.)

### Routing / fallback / cost-aware layer (build-new on top of `stream.ts`)

pi-mono has **no cross-provider failover, no per-session cost accumulation, and `maxRetries` defaults to 0** in `anthropic.ts:524`, `openai-completions.ts`, `openai-responses.ts` (the **one** exception is `openai-codex-responses.ts:308-377`, which has its own exponential-backoff retry loop with `Retry-After` cap — a reuse candidate). Design three layers above `stream.ts`, touching no provider internals:

1. **ProviderRouter (outage/429 failover).** Ordered `RouteEntry[]` of `(model, options)`. Call `complete()` on the first; on `stopReason:'error'` matching a 429/503/"overloaded"/"capacity" pattern, advance to the next. Use the `onResponse` callback (`types.ts:120`) for fast HTTP-status detection. Each entry can point at a different provider (direct Anthropic, OpenRouter, opencode-go). Maintain a per-`model.provider` consecutive-failure circuit-breaker `Map`. **Hazard to handle:** when replaying history across a provider switch, normalize assistant messages (e.g., add `reasoning_content` for the deepseek opencode-go models).
2. **CostAwareSelector (cheap vs strong).** `TurnClass = 'utility' | 'reasoning'`; map to `ModelTier` using `Model.cost.output` as the sort key. Utility (tool-execution turns) → cheap open-source (e.g. opencode-go `deepseek-v4-flash` at $0.14/$0.28 per M); reasoning/planning → strong direct Anthropic. **Caution:** verified coding routing gain is only **~1.5–2.5×** (the "RouteLLM 3.66×" figure is MT-Bench chat, **not transferable** — §11), and requires coding-specific preference data plus a <25% escalation rate. A single strong model + caching + observation-masking already captures most savings; treat routing as an investment decision, not a default.
3. **SessionCostAccumulator.** Subscribe to `AssistantMessage.usage.cost.total` after each `complete()`; expose `currentCost()`, `remainingBudget()`, `budgetExceeded()`. `calculateCost` (`models.ts:39`) **mutates `usage.cost` in place** and is per-message only — read only the **final** `AssistantMessage` from `result()`; intermediate streamed events are not authoritative. Track `cache_hit_ratio = cacheRead/input` as a first-class diagnostic (it dominates cost reproducibility). Do **not** fold `cacheRead` into `input` for cost (cacheRead is ~0.1× input price on Anthropic).

**Auth failover (port-as-TS):** oh-my-pi's `auth-retry.ts` (`withAuth`/`ApiKeyResolver`, pure-TS) handles 401/usage-limit credential rotation (refresh → rotate sibling account). This is **orthogonal** to 429 provider switching — keep the two concerns in separate layers. Optionally port `ProviderHttpError` (status/headers/code) for cleaner classification than pi-mono's `errorMessage` strings.

---

## 4. Reasoning-effort design

### Unified selector → per-provider control (the base abstraction is correct — keep it)

pi-mono's `ThinkingLevel` union (`types.ts:65`: `minimal|low|medium|high|xhigh`), `ThinkingLevelMap` (per-level → provider-native string or `null`), `clampThinkingLevel`, and `getSupportedThinkingLevels` are the right design: one UI knob → 5+ wire formats. Keep intact; **add a `max` sentinel** (the type stops at `xhigh` but `models.generated.ts` already uses `'max'` as a map value for Opus 4.6 Bedrock variants) and an explicit `off`/`none` tier.

| Provider | Control surface | Values | pi-mono path | "Insane" tier mapping |
|---|---|---|---|---|
| **Anthropic** | `thinking.type='adaptive'` + `output_config.effort` | low/medium/high/**xhigh/max** | `anthropic.ts:960-989`; `forceAdaptiveThinking` compat; `display:'summarized'` override (`:965`) | `effort='xhigh'` (or `'max'` on Fable 5/Mythos 5/Opus 4.6), `max_tokens≈128k`, `display='summarized'` + a mid-conversation system message granting multi-agent orchestration |
| **OpenAI** | Responses: `reasoning:{effort,summary}`; Completions: `reasoning_effort` | none/minimal/low/medium/high/xhigh | `openai-responses.ts:262-278` (incl. `include:['reasoning.encrypted_content']`); `openai-completions.ts:620-628` | `reasoning.effort='xhigh'`, `max_output_tokens≈128k`, `summary='auto'`, encrypted-content include |
| **Google Gemini** | 2.5: `thinkingBudget` (int); 3.x: `thinkingLevel` (enum) — **not interchangeable, mixing → 400** | budget ints / MINIMAL-LOW-MEDIUM-HIGH | `google.ts:280-315,398-504`; `isGemini3ProModel/isGemini3FlashModel/isGemma4Model` gates | `thinkingLevel='HIGH'` + large max-output; 3.1 Pro cannot disable thinking |
| **xAI Grok** | (see correction) | — | — | `reasoning_effort='high'` ceiling — but **never actually emitted as shipped** (below) |
| **DeepSeek** | `thinking:{type}` + `reasoning_effort` | high/max (low/medium→high, xhigh→max) | `openai-completions.ts:579-588`; `requiresReasoningContentOnAssistantMessages` | `reasoning_effort='max'` |

### Correct grok handling (refutes the prior self-contradiction)

**`reasoning_effort` is NEVER sent to any xAI/grok model as shipped.** `detectCompat` sets `isGrok = provider==='xai' || baseUrl.includes('api.x.ai')` (`openai-completions.ts:1131`), then `supportsReasoningEffort = !isGrok && …` (`:1141`). Both `buildParams` branches that emit `reasoning_effort` (`:620`, `:623`) gate on `compat.supportsReasoningEffort`. No xAI model carries an override. The grok reasoning models (`grok-4.3`, `grok-build-0.1`) have `reasoning:true` — which only enables thinking-content parsing in the stream handler — **but get no effort parameter**. This is the **correct shipping behavior** if uncontrolled grok reasoning spend is undesirable; it is a **defect** only if xAI's API is meant to receive a top-level `reasoning_effort` (then add a `supportsReasoningEffort:true` compat override or remove `isGrok` from the exclusion). Decision for Misul: either exclude grok variants from the reasoning tier, or add the override and a provider-matrix test. Do **not** route reasoning turns to grok until this is decided.

### Detecting available modes per model

- **Anthropic** is the **only** provider with a live, structured capability API: `GET /v1/models` returns `thinking.supported`, `thinking.types.{adaptive,enabled}.supported`, and `effort.{low/medium/high/xhigh/max}.supported`. Fetch once at boot, cache ~1h, and populate `thinkingLevelMap` + `forceAdaptiveThinking` from live data — no hardcoded lists, auto-picks up new effort tiers. Budget-based thinking returns **400** on Opus 4.7+/4.8/Fable 5/Mythos 5; those models reject `thinking.type='disabled'`.
- **Google** `GET /v1/models` returns `thinking:boolean` (useful filter) but does **not** distinguish budget vs level mode — still needs model-name regex gates.
- **OpenAI / xAI / DeepSeek** have **no** capability endpoint — maintain static tables in `models.generated.ts`.

**"Insane" tier (verified design):** ultracode is **not a secret model** — at the API level it is `effort=xhigh` (or `max`) + adaptive thinking + large `max_tokens` + one system reminder granting multi-agent orchestration. The parameter mapping is entirely handled by pi-ai already; the **multi-agent spawning is a harness concern** (§9). Reserve for frontier tasks: a single xhigh/128k Opus call can cost $3–6 in output alone; multi-agent multiplies that.

---

## 5. Context + compression plan

### What the base provides (reuse / fork-and-brand)

pi-mono's compaction (`packages/agent/src/harness/compaction/compaction.ts`) is production-quality and pure-TS:
- **Threshold is FLAT:** `shouldCompact()` returns `contextTokens > contextWindow - settings.reserveTokens` (`:196-199`), `reserveTokens` default **16384** (`:113-116`). There is **no** "15% of contextWindow / max()" term — that formula exists **only in oh-my-pi's `docs/compaction.md:413`** and must not be attributed to pi-mono (see §11).
- Structured summary schema (Goal / Constraints / Progress / Decisions / Next Steps / Critical Context); iterative `UPDATE_SUMMARIZATION_PROMPT` (avoids exponential re-summarization); branch summarization on tree navigation; cumulative file-op tracking in summaries; cut-points never split tool-call/result pairs; a minimal 2-sentence `SUMMARIZATION_SYSTEM_PROMPT` so a **cheaper model** can summarize.

**Critical harness gap:** there is **no automatic compaction trigger** in the loop. `harness.compact()` must be called externally and requires `phase==='idle'` (between-turn pause). The `session_before_compact` hook (`agent-harness.ts:723-730`) lets Misul substitute a custom compactor or `cancel:true`. The token estimate driving any trigger is a hybrid (last `usage.totalTokens` + `chars/4` for the tail) and **may fire early or late** — carry this caveat into the trigger design.

### Honest snapcompact assessment

`snapcompact` replaces LLM-summarized compaction with **PNG bitmap frames of pixel-font text** that vision models read back. It is:
- **Deterministic** at the orchestration layer (format selection, provider dispatch, summary construction in `snapcompact.ts` are pure-TS) — but the **rasterization (`renderSnapcompactPng`, `snapcompact.ts:51`) is entirely Rust in pi-natives.** Without that binary the package produces **nothing**.
- **Vision-dependent** for retrieval (only vision-capable models can read the frames back).
- **Quality unverified at Misul's models:** the prior research's SQuAD-F1 numbers are wrong (Opus-4.8 ~0.601, not 0.86–0.96); thinking-token decode cost "can eat the savings in a single pass." Single-author, zero independent replication. Provider frame shapes are **stale in the README** — source of truth is `snapcompact.ts:248-266` + CHANGELOG.

**Viability verdict: skip for now.** It cannot be vendored as pure-TS. Use pi-mono's LLM-summary compaction as the default. If Misul later ships the pi-natives binary, snapcompact becomes available via npm — but enable it only after an internal provider-aware billing+recall measurement.

### Plan (ordered by quality-per-dollar, using corrected impacts)

1. **Prefix-ordered prompt caching** (`supported`, low cost, highest ROI). Order system + tool defs + skill stubs → project context → conversation; never mutate the prefix mid-session. Use pi-ai's `CacheRetention` + `sessionId` seams (`types.ts:104,109`); `onPayload`/`before_provider_payload` for extra breakpoints (but those are provider-coupled — prefer the agnostic `CacheRetention`). ~90% off cached-input tokens; break-even at ~2 reads on the 1h tier.
2. **Observation masking / tool-result truncation** (`supported`, low cost): ~50% cost cut at equal solve rate — but **disable for thinking-heavy turns** (degrades quality there). Modify old results only when the suffix ≤8K or past cache TTL (else it busts KV cache). Wire via `transformContext` + `tool_result` post-processing.
3. **Skill stub injection / JIT loading** — already the base behavior (§1). SkillReducer's **26.8%** input savings at 86% quality retention is the defensible number; the "96% drop for simple tasks" claim **does not exist at its cited source — drop it** (§11).
4. **Structured-output discipline** (`supported`): reason free-form, convert to structured only as the final step (strict JSON costs −10–15% reasoning).
5. **Aggressive context-engineering pruning** (moderate–strong, high cost): superseded-read pruning and a `shake` mechanical pre-pass (drop tool-results / >400-token blocks before LLM compaction) are **near-zero-cost adopt-now wins**; a trained skimmer (SWE-Pruner) is SP-2+.

---

## 6. System-prompt plan

### Architecture (two-block split — verified pattern from base + Claude Code)

- **Block 0 (stable "constitution"):** role identity, tool inventory, workflow rules, critical constraints, skill stubs. Changes only on deliberate version bumps. This is the maximally cacheable prefix (near-100% hit rate after turn 1).
- **Block 1 (dynamic footer):** date, cwd, git status, workspace tree, memory summary — regenerated per session.
- **Runtime control as system-reminder in the user turn**, never by mutating Block 0. This maps to pi-mono's turn-snapshot architecture (the snapshot is immutable during a turn; config changes affect the next turn). pi-mono's `before_agent_start` and `context` hooks are the injection points.

### Fable 5 adaptation — honest fallback

The "Fable 5 system prompt" is an **unverified leak** (Pliny, June 2026); Anthropic has not confirmed authenticity. **Do not treat it as a spec.** Adopt only the **structural patterns**, which are independently sound: (a) separate stable constitution from runtime surfaces; (b) a request-routing decision tree; (c) apply memory **silently** (no "I notice/I see" attribution); (d) define environment surfaces rather than step-by-step instructions. Do **not** copy the copyright/safety/MCP-connector sections (Anthropic product-specific). **Honest fallback:** the real, verified, MIT-licensed base for Misul's prompt is **oh-my-pi's `system-prompts` skill** (§1) plus pi-mono's own `system-prompt.ts` template — these are inspectable and confirmed, unlike the leak.

### Techniques from top harnesses (verified, low cost)
- RFC-2119 keywords in caps; `NEVER`/`AVOID` as single-token aliases; critical rules at **start and end** (lost-in-the-middle); 5–12-word tactical bullets; XML structural tags with defined semantics; tool prompts that teach **when/why, not how**, with worked examples (oh-my-pi `system-prompts` — verified).
- Plan/Explore/Task **sub-agent prompt specialization** (Claude Code): three small focused prompts beat one monolithic prompt.
- In-context plan tool with crossed-off steps positioned at context end (Factory Droid recency-bias pattern; Terminal-Bench #1 — but that ranking is single-vendor, non-load-bearing).
- **Anti-patterns to avoid (verified):** bribe language ("I'll tip $200"), few-shot on advanced reasoning models, explicit CoT on reasoning models (conflicts with internal reasoning), "be efficient with tokens" (triggers premature abandonment), "Don't do X" without a positive alternative. **Keep AGENTS.md/CLAUDE.md minimal** — build/test commands only; ETH Zurich found verbose generated context files *degrade* success 2–3% while raising cost >20%.

---

## 7. Permission / sandbox model

### Two layers — base provides Layer 1, port the algorithmic value for Layer 2

**Layer 1 — Project trust (already in pi-mono base, reuse-as-is).** `trust-manager.ts:184-206` + `project-trust.ts`: per-directory decisions in `~/.pi/trust.json` (lockfile-safe); `hasTrustRequiringProjectResources()` gates loading of `.pi/` config, extensions, and skills **at startup** before any project-local resource loads. Pure Node-TS. Adopt verbatim → `~/.misul/trust.json`. This is the correct threat model for an agent operating on arbitrary repos. *(Correction: the prior claim that "pi-mono has no permission model" is false — it has this trust system plus a `tool_call` extension hook that can `{block:true}`, with a working `examples/extensions/permission-gate.ts`.)*

**Layer 2 — Tool-call authorization** via the `beforeToolCall` hook (`agent/src/types.ts:280-284` / `:262`), which can `{block:true, reason}` before execution. Enforce in order:

1. **Hard regex blocklist:** port `CRITICAL_BASH_PATTERNS` (`oh-my-pi/.../tools/bash.ts:51-90`, 17 patterns: `rm -rf /`, `sudo rm`, `mkfs`, `dd` to device, `shred`, `/etc/passwd|shadow|sudoers` writes, fork bombs, `kill` PID 1, `nc -e/-c` exfil, curl|wget piped to shell). Pure-TS, carefully anchored against false positives. **Block (don't prompt)** — these are never legitimate in automation. Wire onto `beforeToolCall`. **Skip `bash-command-fixup.ts`** — it delegates entirely to a Rust pi-natives addon (`bash-command-fixup.ts:20-37`); a naive regex strip of trailing `| head`/`2>&1` covers 95% of cases.
2. **Three-tier / three-mode approval** (port `oh-my-pi/.../tools/approval.ts`, ~190 lines pure-TS): tiers `read/write/exec`; modes `always-ask/write/yolo`. Resolution: tool's own `approval(args)` → per-tool user policy → mode-vs-tier rank. Map Misul tools: read-only/search → `read`; write/edit → `write`; bash/network-mutating → `exec`. **Default to `write` (not `yolo`)** for non-interactive runs — oh-my-pi's default is `yolo` (`settings-schema.ts:2896-2899`), which is too permissive for a quality-first harness. *(Note: oh-my-pi forces subtasks to `yolo`, `executor.ts:724-726` — "parent is the authorization boundary"; Misul should reconsider this for untrusted-input subagents.)*
3. **Per-tool user policy table** (`tools.approval.<name>: allow|deny|prompt`, from `approval.ts`): a `deny` blocks even in yolo mode.

**Auto-generated-file guard (port-as-TS):** `auto-generated-guard.ts` blocks edits to generated files (header-marker regex + filename patterns + LRU cache). One Bun call only (`Bun.file().stat()` at `:258`) → replace with `node:fs/promises stat`; replace `peekFile` with a direct `fs.read` of the first 1024 bytes. ~323 lines, otherwise standalone. This prevents silent corruption of generated files — belongs in the write/edit tools.

**Bash interceptor (optional, port-as-TS):** `bash-interceptor.ts` redirects `cat/head/grep` to structured `read`/`search` tools when those tools are active. Pure-TS engine, ~70 lines. Improves quality-per-dollar by keeping the model in structured tools.

**Plan-mode guard (build-new, do NOT port):** oh-my-pi's `plan-mode-guard.ts` is coupled to `@oh-my-pi/hashline` and `local://` URL schemes Misul will not have. Build a ~30-line guard: a session boolean + a `isUnderCwd` path-containment check that rejects writes/moves/deletes outside a designated scratch dir while planning.

**Do not** build OS-level sandboxing (seccomp/namespaces/containers) in v1 — the regex blocklist + exec-tier confirmation is the right tradeoff for a tool that must run arbitrary build commands. (Container isolation is appropriate for the **eval** harness, not the interactive product.)

---

## 8. Memory architecture recommendation

### What the base provides + what to port

pi-mono provides AGENTS.md/CLAUDE.md hierarchy discovery via the ResourceLoader, plus the structured compaction summary as session-scoped memory. It has **no** cross-session long-term memory. From oh-my-pi:

- **Port the local-backend two-phase pipeline** (`oh-my-pi/.../memories/index.ts` + `storage.ts`) as the highest-leverage cross-session lever: Phase 1 (per-thread LLM extraction → `{raw_memory, rollout_summary, slug}`, ≤8 concurrent, secrets redacted) and Phase 2 (per-cwd consolidation via lease+heartbeat → `MEMORY.md`, `memory_summary.md`, per-skill `SKILL.md`). Injected as a "Memory Guidance" block capped at **5000 tokens**, treated as heuristic (repo state wins on conflict). **Bun surface is significant** (`bun:sqlite` in `storage.ts:1`; `Bun.file/Bun.write` throughout `index.ts`; `Bun.YAML` in `managed-skills.ts:76`). Two viable paths: (a) if Misul runs on Bun, vendor as-is and only re-point imports + the `completeSimple` call site to pi-ai (~1–2 days); (b) if Node, swap `bun:sqlite`→`better-sqlite3` (mind `busy_timeout`/WAL), `Bun.file/write`→`fs`, `Bun.YAML`→`js-yaml`.
- **Skip retain/recall/reflect/memory_edit tools** — they are gated to the **hindsight (proprietary REST) or mnemopi (embedded semantic store) backends only**; `createIf` returns null for the local backend (`memory-retain.ts:31-34`, `recall:26-29`, `reflect:27-30`). Only the **`learn` tool** has a `backend==='local'` path (`learn.ts:84-99`) that appends a redacted lesson to `learned.md` (newest-first, ≤100 entries). Port the local `learn` path only.
- **Self-improving skill library (port-as-TS, high value):** `manage_skill` + `autolearn/managed-skills.ts` — atomic, hardened skill writes confined to a managed dir (`O_CREAT|O_EXCL` create, `O_NOFOLLOW` update, hardlink-count check, 64KB cap, kebab-case sanitize, per-name serialize). **Preserve the security hardening verbatim;** replace only `Bun.YAML.stringify` with `js-yaml`. Wire as an **inline ExtensionFactory** so it never touches pi-mono core. Managed skills load dead-last (authored skills win by name). Gate behind an `autolearn.enabled` setting. Port the `AutoLearnController` nudge (`autolearn/controller.ts`) **only after** confirming pi-mono's `AgentSession` exposes a compatible `subscribe`/`sendCustomMessage` shape.
- **Convenience (lowest priority): `skill://` URL expansion in bash** (`bash-skill-urls.ts`, pure-TS). pi-mono has no equivalent; add an `expandInternalUrls()` call in Misul's bash tool's pre-execute path (the only blocker is that pi-mono's bash exposes no pre-execute hook — a small surgical edit).

**Recommendation:** vector-store/RAG memory is **not** worth the infrastructure for a coding agent — JIT file-based retrieval (skill stubs + the capped memory summary + `learned.md`) covers the case more cheaply. Priority: (1) `manage_skill`/managed-skills (self-improving, no service dep); (2) local two-phase memory pipeline (cross-session accumulation, highest leverage); (3) `skill://` expansion.

---

## 9. Agent designs

Both agents inherit pi-mono's **session model** (turn-snapshot isolation, JSONL/in-memory repos, compaction, branch summarization) and use the same harness seams. The seams that make this possible:

- **Subagent fan-out:** an `AgentTool` whose `execute()` runs another agent loop **is** a subagent — the parent just awaits the promise (`agent-loop.ts:329-330`). Parallel dispatch via `executeToolCallsParallel` (`agent-loop.ts:451-515`); `executionMode:'sequential'` forces serialization; `AgentToolResult.terminate` lets a child signal the parent to stop. **Hazard:** parallel execution emits `tool_execution_end` in completion order but writes results in source order, and a mid-batch failure commits earlier results with **no rollback** — design subagent tasks to be independent and idempotent.
- **Mid-run injection:** `getSteeringMessages`/`getFollowUpMessages` (`agent-loop.ts:167,253,257`) inject task assignments/confirmations into a running child.
- **Model-swap per turn:** `prepareNextTurn` (`agent-loop.ts:226-238`) returns `{model}` to route the next turn to a cheaper/specialized model — the cost lever for fan-out (isolated subagents do **not** share KV cache, so each pays full input price; the savings come from **model-tiering**, not isolation).
- **Spawn substrate:** reuse oh-my-pi's pure-TS swarm DAG/wave/pipeline (`swarm-extension/src/swarm/{schema,dag,pipeline}.ts`); only `executor.ts`'s `runSubprocess` must be re-implemented against Misul's spawn. Do **not** vendor oh-my-pi's `job.ts`/`task` tool — it is coupled to oh-my-pi's AgentRegistry; rebuild on the pi-mono harness.

### Deep-work agent ("droid-factory": plan + autoreview)
- **Spec phase:** produce `requirements.md` + `design.md` + `tasks.md` (with explicit task dependencies) in `.misul/specs/<id>/` (Kiro pattern). Skip for <5-step tasks.
- **Plan → orchestrate:** a planning subagent reads the spec; the orchestrator fans out task subagents in **dependency waves** (independent tasks run concurrently). Each subagent gets a **bounded brief** (objective, output format, tool permissions, task boundaries — vague "research X" causes duplication) in an **isolated session**, returns a structured report. Model-tier: cheap "smol" model for exploration, capable model for plan/synthesis. Use oh-my-pi's `fix-issues.md`/`review-prs.md` as bounded-task templates (reproduce-on-main-first → worktree → fix → conventional-commit → report).
- **Autoreview:** a review subagent in a **fresh context** receives only the task spec + the diff + a rubric (tests pass, no regressions, matches spec, no scope creep) and classifies worthy/needs-fix. **Cap the review-fix loop at 3 iterations** (rounds 1–2 capture ~75% of recoverable gain; a 10-cycle loop costs ~50× a single pass). Use a **different model family** for the judge (self-enhancement bias). Note: the "90.2% multi-agent uplift" is an internal Anthropic eval and multi-agent uses ~15× tokens — justify fan-out only by parallelism or contamination-prevention, not by the headline number (§11).

### Simple / quick agent
- Single pi-mono session, **no** spec phase, **no** review loop, single-edit-per-turn discipline, 3-error-iteration cap, deliver immediately (Cursor pattern). Inherits the same compaction/trust/approval machinery; can still **spawn** a deep-work workflow or a subagent on demand via the same `AgentTool`-as-subagent seam if a task escalates.
- Mode boundary is explicit (user-selectable or a complexity heuristic at spec-read time).

---

## 10. What beats other harnesses — ranked levers

1. **Prefix-ordered prompt caching** — table stakes and the single highest-ROI move (~90% off cached input). Steal Aider's cache-keepalive ping (extend the 5-min TTL across idle gaps — secondary-source, mechanism plausible).
2. **An integrated quality-per-dollar (QpD) eval harness** — **no competitor publishes one.** Measuring quality *and* dollars as one compound metric across technique combinations is genuinely differentiating. (Build on pi-mono primitives — pi-mono has no per-session cost aggregation; oh-my-pi's `run-collector.ts` telemetry is **not** in pi-mono and would have to be ported or rebuilt. Decide tokenizer strategy explicitly: pi-mono has none; `chars/4` estimation is ±25% and undermines a "5pp = noise" threshold.)
3. **Observation masking + superseded-read pruning + `shake` pre-pass** — ~50% cost cut at equal solve rate (off for thinking turns); pruning is a near-zero-cost adopt-now win.
4. **Cost-aware routing with model-tiering** — cheap open-source utility turns (opencode-go DeepSeek tiers) + strong reasoning turns; conservative **1.5–2.5×** on coding, contingent on a data-collection investment.
5. **Self-improving managed-skills + cross-session memory pipeline** — compounding quality with no external service dependency.
6. **Structured handoff-document compaction** (Goal/Progress/Decisions/Critical Context) — beats naive summarization for resumability.
7. **Built-in browser + fetch + BM25 tool-discovery** ported from oh-my-pi — capability parity with the best harnesses without external MCP latency.
8. **Tool-use discipline** (specialized tools over shell, parallel batching, pruned manifests) — best-evidenced *efficiency* lever (GitHub: 19–62% token cut across 109 production runs — note: efficiency data, not a direct quality-lift measure).

What to beat: Claude Code has the best caching docs; oh-my-pi the most sophisticated compaction/edit pipeline. Misul's edge is the integrated QpD measurement plus capability parity at lower marginal cost.

---

## 11. TRUST LEDGER — claims NOT to rely on, and substitutions

**Refuted / do not use:**
- **Anthropic OAuth/subscription "stealth" path works day-to-day.** Refuted — hard technical block since April 4, 2026 (pi-mono #3372), header spoofing patched, 400 for third-party tools. *Substitution:* API-key auth only; OpenRouter Anthropic wrapper. **Time-sensitive caveat:** the enforcement timeline oscillated three times in 2026 (Feb ban → April enforce → May credit-split → June 15 pause); the *instability itself* is the risk signal. The code-level facts (`anthropic.ts:72-109`) are verified; the *functional status* rests on third-party reporting and cannot be verified from the clones.
- **pi-mono uses a "15% of contextWindow / max(reserveTokens)" compaction threshold.** False (laundered cross-repo). pi-mono is **flat** `contextWindow - reserveTokens` (`compaction.ts:196-199`, default 16384). The 15% formula is **oh-my-pi-only** (`docs/compaction.md:413`). *Substitution:* use the flat formula as base; treat the 15% variant as an optional additive oh-my-pi upgrade, never as base behavior.
- **`reasoning_effort` is sent to grok-4.3 / "the openai path sends it directly, which is correct."** Self-contradictory and false — `supportsReasoningEffort=false` for all xai, so it is **never emitted** (`openai-completions.ts:1131,1141,620`). *Substitution:* §4 — decide explicitly (override or exclude).
- **"96% context drop for simple tasks" (progressive disclosure).** Does not exist at its cited URL — **drop it.** *Substitution:* SkillReducer's defensible **26.8%** input savings at 86% quality retention.
- **The Fable 5 leak is an authoritative spec.** Unverified; Anthropic unconfirmed. *Substitution:* adopt structural patterns only; base the real prompt on the verified oh-my-pi `system-prompts` skill + pi-mono `system-prompt.ts`.

**Single-source / directional-only — do not gate decisions or make external claims on these numbers:**
- **All MCP performance multipliers**: 939×/31× (computer-use README), 70–95% token reduction (fast-playwright README), 99%/10× (codebase-memory — an arXiv preprint of unconfirmed-independence found **10× tokens at 83% vs 92% answer quality**, a ~9pp quality *loss*, not the 99% headline), 9×/16× (Lightpanda, a competing vendor), 15–20% Puppeteer-vs-Playwright (Lightpanda). Mechanisms are plausible; magnitudes are unreplicated. **Budget for MCP latency rather than assuming gains.**
- **ponytail 47–77% cost / 3–6× faster**: author-run, five trivial tasks, no replication (`overstated`). Bundle on mechanism; never cite the numbers.
- **RouteLLM 3.66×**: MT-Bench *chat* on GPT-4/Mixtral — **not transferable** to coding. *Substitution:* conservative 1.5–2.5× on coding, contingent on coding preference data + <25% escalation.
- **Multi-agent "90.2% uplift" / "15× tokens" / subagent "40% cost saving"**: the uplift is an internal Anthropic eval; the 9K-vs-15K saving figure has no locatable source; subagent isolation does **not** save cost (no shared KV cache). *Substitution:* justify fan-out by parallelism/contamination, and tier models for the cost lever.
- **Anthropic pricing & "fast mode"**: Opus 4.8 at **$5/MTok input, $25/MTok output** (standard; $50 fast) — the prior "$25–$82.50" was wrong; **no current model reaches $82.50**. Verified June 2026, single-vendor pricing page, date-sensitive — **refresh quarterly, apply a ±20% buffer.**
- **GitHub star counts** (superpowers ~226k, taste ~45k, ponytail ~24k): volatile, single-source, **non-load-bearing** — never cite as quality evidence.
- **Terminal-Bench #1 (Factory Droid), Brave latency, "158K requests/month" DeepSeek figure**: single-vendor or unsupported-arithmetic — the 158K figure has no stated token-per-request assumption; drop it.

**Refuted premises with substitutions already applied above:** "fork an external MCP for browser/fetch/code-search" → **already built-in** as `fetch.ts`/`browser.ts`/`search.ts`/`search-tool-bm25.ts`, port don't fork (§2); "pi-mono has no permission model" → it has project trust + a blocking tool-call hook (§7); "snapcompact can be vendored as pure-TS" → Rust rasterizer is non-negotiable (§5); "memory retain/recall/reflect work locally" → hindsight/mnemopi-only; use the `learn` local path (§8).