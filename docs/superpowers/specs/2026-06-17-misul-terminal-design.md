# Misul Terminal — Vision, Decomposition & Research Charter

Status: vision locked (2026-06-17). Specs for SP-0/SP-1 pending the research phase below.
Purpose of this doc: the single source of truth that grounds the ultracode research run and all sub-project specs.

## 1. The general idea (locked)

1. **Base.** Fork Pi (`badlogic/pi-mono` — TypeScript, MIT; layered into `pi-ai`, `pi-agent-core`, `pi-tui`, `pi-coding-agent`), modified deeply enough to become Misul's own runtime. The exact fork target (minimal Pi vs. the heavy `can1357/oh-my-pi` fork vs. Pi + cherry-pick) is deferred to research — it cannot be decided without reading both.
2. **Surface.** Coding-first spine, architected so non-coding "normal work" plugs in later as skills/pipelines on the same runtime — not a separate product.
3. **North star.** Maximize **quality-per-dollar**: a composite scored on a fixed task suite (quality rubric + cost capture). Every prompt/pipeline/skill change is judged by whether it moves that number.
4. **Method.** Make the model dramatically better *through the harness* — curated skills, token/cost pipelines, and instruction scaffolds — validated by the eval harness rather than asserted.

## 2. Decomposition (build order)

The vision is several independent subsystems. Ordering matters: build the meter before the engine.

- **SP-0 — Base & bring-up** *(first; research-gated).* Fork, brand, build/run; decide the fork target; map keep vs. replace. Gates everything.
- **SP-1 — The meter** *(first).* Quality-per-dollar eval harness: fixed task suite + dual scoring (quality rubric + cost) + one-command A/B of any change. The objective function for all later work.
- **SP-2 — First vertical slice.** One token/cost pipeline + one skill, measured by SP-1, proving the loop end-to-end before scaling.
- **SP-3 — Pipeline library.** Compaction, model routing (cheap-model triage → escalation), caching, subagent fan-out, context-gating, retrieval — each added *and measured*.
- **SP-4 — Skill system.** Authoring, cheap triggering/progressive-disclosure loading, and a curated coding skill set.
- **SP-5 — Normal-work surface** *(phase 2).* Non-coding workflows on the same spine.
- **Cross-cutting.** Telemetry/cost-capture (feeds SP-1); team distribution/config.

Only SP-0 and SP-1 are prerequisites for everything. SP-3 (the exciting part) is unmeasurable — and therefore unjustifiable — until SP-1 exists.

## 3. Research charter (for the ultracode run)

Goal: produce one cited **findings doc** that lets us write the SP-0 and SP-1 specs from evidence. Two tracks.

### Track A — The base (read primary source / code)

Read Pi and oh-my-pi source directly; do not rely on marketing or summaries.

- **Map Pi concretely:** `pi-ai` provider abstraction (request/stream/caching, token accounting); `pi-agent-core` agent loop, tool-call protocol, the tree-structured session/state model, and any context-window/compaction handling; `pi-tui`; `pi-coding-agent` system prompt, four-tool core, and the extension/skill/prompt-template/theme mechanism plus SDK and RPC modes.
- **Map oh-my-pi's deltas:** the 32 tools, LSP, subagents, slash commands, hash-anchored edits, browser, Python, cross-session memory, compaction metrics, telemetry, MCP resilience — what each adds to the loop/context/tooling.
- **Recommend the fork target** (minimal Pi vs. oh-my-pi vs. Pi + cherry-pick) against: cleanliness for deep runtime mods, how much of SP-3/SP-4 is already solved, license/maintenance burden, code quality, and alignment with a quality-per-dollar goal.
- **Locate the seams** in the chosen base where we hook: where context is assembled; where model calls are made (for routing/caching/compaction); where subagents fan out; where token/cost telemetry can be captured (for SP-1); where skills attach (for SP-4).

### Track B — The landscape (survey, evidence-based)

- **Token/cost-reduction techniques** and their *measured* impact: prompt caching, context compaction/summarization, retrieval over whole-file reads, model routing/cascades, subagent fan-out vs. single context, structured output, context-gating/progressive disclosure, tool-result truncation. For each: mechanism, expected quality-per-dollar effect, evidence/sources, implementation cost. Adversarially verify quantitative claims.
- **Quality-per-dollar eval methodology:** how serious teams build coding-agent eval suites (SWE-bench / SWE-bench-Verified, Terminal-Bench, internal task sets), quality rubrics, LLM-as-judge reliability, cost capture, A/B harness design, variance/significance handling. Define the *minimal credible* SP-1 harness.
- **Quality-lift instruction techniques:** system-prompt design, verification loops, self-consistency, plan-then-act, structured reasoning — with evidence.
- **Competitive scan:** what Claude Code, oh-my-pi, Goose, Aider, OpenCode do for token efficiency and quality that we should adopt or beat.

### Required deliverable

A single cited findings doc that: (1) recommends the fork target with justification; (2) maps the hook-points/seams in the chosen base for pipelines, telemetry, and skills; (3) gives a ranked, evidence-backed list of token/cost pipelines with expected quality-per-dollar impact and implementation cost; (4) proposes a minimal-credible SP-1 eval harness design; (5) lists open decisions. Constraint: read primary sources/code, cite everything, and adversarially verify any quantitative savings claim.

## 4. Open decisions (deferred, not forgotten)

- **Model strategy:** Claude-standardized vs. multi-provider routing — materially shapes the cost pipelines; informed by Track B routing research + Misul's account/cost reality.
- **Team & deployment:** number of users, install/update/secrets distribution.
- **Sandboxing posture:** Pi supports containerization; decide our default.

## 5. Expanded mandate (2026-06-17, round 2) — autonomous build

The user expanded scope and authorized autonomous, out-of-the-loop execution: after research, build the whole thing, refine and reiterate "until exhaustion." Standing working disciplines for ALL written code: (a) tests for everything, (b) the `ponytail` skill (laziest/simplest solution that works), (c) the autoreview agent (in-session `/code-review` at max effort on Opus, never billed `ultra`/cloud) per `~/.claude/autoreview-contract.md`, (d) simplicity-first throughout, (e) always double-check info against primary sources, (f) never build on unverified premises.

### 6. Requirements catalogue (authoritative; R1–R11)

- **R1 — Autonomy.** Build out-of-the-loop as a self-paced loop; converge to shipping, don't research forever. Each increment: tested + ponytail'd + autoreviewed + measured by SP-1.
- **R2 — Skill curation.** Find the absolute best skills across the ecosystem AND document *why* each is best (evidence, not vibes). Named seeds: `ponytail` (coding simplicity), `gpt-taste` (frontend; reportedly fixes frontend skills for GPT models — VERIFY it exists). Cover everything, especially coding.
- **R3 — MCP servers.** Build best-in-class MCPs — browser automation and computer use first — that are extremely fast, free, and Misul-branded. Forking existing MCP servers is allowed but must be customized/rebranded. Target: fastest + highest quality.
- **R4 — Two agents.** (i) Deep-work agent: plan-driven, "droid-factory"-style (spec → plan → execute → review), with autoreview built in. (ii) Simple agent: fast iteration. Both inherit the model currently used by the Terminal. Agents can spin up workflows/subagents.
- **R5 — Providers.** Support OpenRouter, a Claude-SDK solution (temporary; uses Claude subscription — CHECK ToS), and "OpenCode GO" (IDENTIFY exactly what this is). Map onto pi-ai's provider abstraction.
- **R6 — Reasoning/effort modes.** Per-model thinking modes "perfectly curated" based on what each model/provider actually supports (detect programmatically). Add an ultracode-like maximal mode named **"Insane"** in the reasoning/effort selector.
- **R7 — Context & compression.** Make context "actually work"; achieve best-in-class context compression.
- **R8 — System prompt.** Adapted copy of the **Fable** system prompt (source it; if not obtainable, adapt from best-known principles — do NOT fabricate and claim it's Fable's).
- **R9 — Beat other harnesses.** Research what makes harnesses raise model scores; exceed it.
- **R10 — Simplicity** is a recurring hard constraint.
- **R11 — Fill gaps** with best judgment ("a ballad of other things I'm missing").

### 7. Execution model (autonomous loop)

Phases, each gated on verified evidence: **(P1)** finish research wf #1 (Pi/oh-my-pi internals + token-pipeline/eval landscape) — RUNNING (`wf_bf1fd036-944`). **(P2)** research wf #2 (skills, MCPs, providers/auth, reasoning modes, Fable prompt, context-compression SOTA, harness-quality techniques, agent architectures) — with adversarial + license/ToS verification. **(P3)** synthesize one master findings doc; **(P4)** writing-plans → master plan + per-SP plans; **(P5)** SP-0 fork bring-up; **(P6)** SP-1 eval harness (the meter); **(P7+)** feature build loop (providers, agents, MCPs, skills, reasoning modes, context/compression, system prompt), each increment tested + ponytail'd + autoreviewed + measured. Loop state/trail lives in `research/AUTONOMOUS-LOG.md`.

### 8. Assumptions while user is away (correct on return if wrong)

- Local git commits to the project repo are part of "building it"; NO remote push without explicit approval.
- The loop runs under `ultracode` by the user's standing order, even if a given wake-up doesn't re-assert it.
- Where a named premise (gpt-taste, OpenCode GO, Fable prompt) proves false/unobtainable, substitute the best verified equivalent and record the substitution in the log.
