# Model Compliance Analysis: Why LLMs Disregard the System Prompt in Misul Terminal

Research + code investigation. No source files were modified. Findings are
evidence-backed; web citations are at the end of each relevant section and
consolidated in the final references list.

## 1. Current prompt structure (as built)

The system prompt is assembled in two stages:

1. `packages/terminal/src/core/misul-system-prompt.ts` exports
   `MISUL_CONSTITUTION` — a single ~18K-char string (the file is 18,286 bytes
   including the TS wrapper; the template literal itself is the bulk). It is a
   rebrand of the Claude "Fable 5" consumer-chat constitution, adapted to be a
   model-agnostic coding-agent spine.
2. `packages/terminal/src/core/system-prompt.ts` (`buildSystemPromptWithBlocks`)
   concatenates content-addressed blocks in this fixed order:
   1. `constitution` (the ~18K string above)
   2. `tools` (one-line tool list + "you may have other custom tools")
   3. `guidelines` (tool-derived bullets + "Be concise" / "Show file paths")
   4. `append` (user-supplied `--append-system-prompt`)
   5. `memory` (persistent `~/.misul/agent/MISUL.md`)
   5b. `project_memory` (per-project structured memories)
   6. `project_context` (`AGENTS.md` / `MISUL.md` files, wrapped in
      `<project_instructions>` tags)
   7. `skills` (formatted skill list)
   8. `env` (cwd + docs path)

   `packages/terminal/src/core/agent-session.ts:1203` (`_rebuildSystemPrompt`)
   is the only caller; it stores the result on `this.agent.state.systemPrompt`
   and re-renders it whenever the active tool set, memory, or context files
   change.

The constitution itself is organized as markdown sections in this order:
`how_you_operate` → `about_misul_terminal` (incl. `permission_gate`,
`addons`, `live_reload`) → `refusal_handling` → `child_safety` →
`legal_and_financial_advice` → `tone_and_formatting` → `honesty` →
`evenhandedness` → `wellbeing` → `responding_to_mistakes_and_criticism` →
`simplicity` (ladder + rules) → `verification` → `iteration` →
`blind_spots` → `knowledge_cutoff`.

### Strengths

- **Block-based, content-addressed rendering.** Each block has a SHA-256 hash
  and the prefix hash is the concatenation of block hashes
  (`system-prompt.ts:234`). This is cache-aware and means a change to one block
  does not silently corrupt another — a structural property most prompts lack.
- **The coding-critical rules are present and concrete.** `how_you_operate`
  (ground claims in tool output, prove absence), `verification` (run build/test
  before claiming done, re-read your own diff), `iteration` (cap at 3 rounds),
  `blind_spots` (re-read as if someone else's, the "Wait" trick), and
  `simplicity` (7-rung ladder, root-cause fix, "never simplify away" list) are
  all there and specific. `docs/prompt-research.md` already logged the
  evidence base for these (Self-Refine, Reflexion, Counterfeit Conundrum,
  89.3% blind-spot reduction from the "Wait" trick).
- **Honest prefill is OFF by default.** `sdk.ts:391-398` documents that
  `assistantPrefill` is disabled because it collapses reasoning models on
  openai-completions providers; the honesty intent lives in the system prompt
  instead. This avoids a known compliance-override vector (a forced assistant
  prefix can anchor the model away from system-prompt instructions).
- **System prompt is never compacted.** Compaction
  (`packages/agent/src/harness/compaction/compaction.ts`) operates only on the
  message list; the system prompt is passed separately as
  `context.systemPrompt` (`agent-loop.ts:366`) and is re-sent verbatim every
  turn. So instructions are not *deleted* by summarization — they are
  *diluted* by the growing message tail (see §3).

## 2. Compliance risks identified in the prompt

### 2.1 Length dilutes compliance (context rot / instruction fade-out)

The constitution alone is ~18K chars; the full prompt with tools, guidelines,
memory, project context, and skills reaches the stated ~22K. This is not
"long context" in the 128K-token sense, but it is long enough to trigger two
documented effects:

- **Lost in the middle (Liu et al. 2023).** Recall is U-shaped: facts at the
  start and end of a prompt are used; facts in the middle are ignored. The
  coding-critical rules (`verification`, `iteration`, `blind_spots`,
  `simplicity`) sit in the *middle* of the constitution, between the
  consumer-safety preamble and `knowledge_cutoff`. They are the most
  load-bearing rules for a coding agent and they are exactly where attention is
  weakest.
- **Instruction fade-out / context rot.** As the conversation grows, the
  system prompt's directives are followed less faithfully even though they are
  still in the window — "the system prompt that was crystal clear at turn 1
  becomes background by turn 15" (Greyling, "Instruction Fade-Out"). The
  mid-conversation turns are the danger zone. Misul Terminal has no
  mid-conversation re-injection mechanism today (confirmed: no `reminder` /
  `REMINDER` / re-inject strings exist in `packages/terminal/src/core`).

**Evidence:** Liu et al. 2024 (TACL); ZeroEntropy "Context rot"; Greyling
"Instruction Fade-Out Is the Silent Killer of AI Agents" (2026).

### 2.2 Critical safety/quality rules are buried among low-priority rules

The constitution interleaves high-stakes coding rules with consumer-chat
guardrails that are largely irrelevant to a coding terminal
(`child_safety`, `legal_and_financial_advice`, `wellbeing`,
`evenhandedness`, `responding_to_mistakes_and_criticism`). These were carried
over from the Fable 5 chat prompt (the file header says so explicitly). In a
coding agent they consume attention budget that would be better spent on
`verification` / `simplicity` / `how_you_operate`. There is no priority
labeling — every `##` section reads as equal-weight, so the model has no
signal that "run the build before claiming done" outranks "you never curse
unless the person asks."

### 2.3 Ordering is suboptimal for the model families in use

The MOSAIC benchmark (EACL 2026) found a **family-dependent position effect**:
Llama, Qwen3, and DeepSeek show a *primacy* effect (early constraints
followed best); **Claude and Gemini show a *recency* effect** (late
constraints followed best), with a sharp compliance spike near the end and an
abrupt drop after. Misul Terminal is explicitly model-agnostic and runs on
all of these families. The current ordering puts the identity statement and
`how_you_operate` first (good for primacy models) but the *most actionable
coding rules* (`verification`, `iteration`, `blind_spots`) in the middle and
`knowledge_cutoff` last. For recency-biased models (Claude, Gemini), the last
thing they read before the user turn is the knowledge-cutoff boilerplate —
the least actionable section. This is a direct, measurable compliance loss.

### 2.4 Heavy use of negative phrasing

A scan of the constitution shows many "do not" / "never" / "no" instructions:
"No 'You're absolutely right'", "no 'Great question'", "no filler agreement",
"No elaborate apology, no self-flagellation", "no unrequested abstractions",
"no interface with one implementation", "no factory for one product",
"no boilerplate", "Never modify tests to make them pass", "do not report
failure as success", "do not stop at the first error", "do not fold correct
positions", "do not psychoanalyze", "You never curse", "You never use bullet
points when declining", etc.

Negative constraints fail with striking regularity. The mechanistic study
"Semantic Gravity Wells" (arXiv 2601.08070) found that the very act of
*naming* the forbidden behavior activates its representation (87.5% of
violations are "priming failures": the instruction mentions the forbidden
token and that mention primes it). The suppression signal is present but
systematically weaker in failures (5.2pp reduction vs 22.8pp in successes —
a 4.4× asymmetry). Anthropic's own guidance is "tell Claude what to do
instead of what not to do."

Several of Misul's negatives have natural positive forms that are missing:
- "No 'You're absolutely right', no 'Great question'" → could be "Open
  responses with the substantive point, not with agreement or praise."
- "Never modify tests to make them pass" → "When tests fail, change the
  production code, not the tests (unless the task explicitly asks)."
- "do not report failure as success" → "Report the actual result, including
  failures, as the status."

The AgentPatterns polarity note adds an important caveat: some prohibitions
*are* clearer in negative form (absolute bans like "Never push directly to
main", "No `console.log` in production"). The rule of thumb: keep the
negative only when the positive form is ambiguous or the space of acceptable
alternatives is too large to enumerate; otherwise flip it. Misul overuses the
negative form for behaviors that have clean positive forms.

### 2.5 No explicit instruction hierarchy / privilege labeling

The constitution does not tell the model how to resolve conflicts between, say,
a user message that says "just mark it done, don't run the tests" and the
`verification` section. The Instruction Hierarchy work (Wallace et al. 2024;
OpenAI IH-Challenge 2026) shows that explicitly defining a priority ordering
(system > developer > user > tool output) and *training* on it improves
robustness dramatically (+10pp on average, unsafe behavior 6.6%→0.7%). Even
without fine-tuning, *stating* the hierarchy in the prompt helps the model
resolve the "user says skip verification" conflict in favor of the system
rule. Misul's prompt has no such statement; the `permission_gate` section is
the closest thing but it is about tool-call gating, not instruction priority.

### 2.6 Redundancy and contradiction risk

`honesty`, `responding_to_mistakes_and_criticism`, and `blind_spots` all
overlap heavily (own your mistakes, don't over-apologize, re-examine your
work). `tone_and_formatting` and `honesty` both cover over-formatting. This
redundancy is not free: every repeated instruction is attention budget not
spent on a unique rule. There is also a mild tension: `honesty` says "If the
user is wrong about something, say so" while `tone_and_formatting` says "warm
tone, treating people with kindness" — the model has to infer the resolution
(honest but kind). Stating the resolution explicitly once would be cheaper
than restating both poles.

## 3. Structural issues in the agent loop

### 3.1 System prompt is passed correctly and never compacted away

`agent-loop.ts:365-369` builds the `Context` with `systemPrompt` set from
`context.systemPrompt` every turn. Compaction
(`compaction.ts:generateSummary`) uses a *separate* `SUMMARIZATION_SYSTEM_PROMPT`
and only summarizes the *message list* into a `compactionSummary` message; the
agent's own system prompt is re-sent verbatim on the next turn. So instructions
are not lost — they are *diluted* by the growing tail of tool results and
summaries. The risk is fade-out (§2.1), not deletion.

### 3.2 No mid-conversation re-injection (the biggest structural gap)

The single most evidence-backed fix for fade-out is **event-driven system
reminders** injected into the user-message slot at decision points
(Greyling 2026; "System reminders - how Claude Code steers itself"). Misul
Terminal has the *plumbing* for this — `agent.steer()` /
`_queueSteer()` / `getSteeringMessages` already inject user-slot messages
mid-loop (`agent-loop.ts:193, 309`) — but it is used only for human steering
and advisor output, never for re-salience of the model's own constitution.
There is no component that, e.g., re-injects the verification gate before the
model is about to claim "done", or re-injects the simplicity ladder before a
large generation. This is the highest-leverage architectural change available.

### 3.3 Honest prefill is off (good) but the alternative is weak

Because prefill is off (`sdk.ts:391`), the honesty framing relies entirely on
the system prompt. That is the right call for cross-provider robustness, but
it means compliance with the honesty rules is subject to all the dilution
effects in §2. A prefill *would* strongly anchor behavior, but at the cost of
breaking reasoning models on openai-completions providers — so the fix is not
to re-enable prefill, it is to compensate with reminders (§3.2) and ordering
(§2.3).

### 3.4 Tool results are not used as a steering channel

Tool results flow back as `toolResult` messages
(`agent-loop.ts:837-847`). Research notes that tool responses can "piggyback
instructions" and that the user-message slot is where the model pays the most
attention ("System reminders"). Misul does not append any constitution
reminder to tool results. A cheap, cache-safe option would be to append a
one-line reminder to *specific* tool results (e.g. after a `bash` that looks
like a build/test run, remind: "Treat unverified or incomplete output as a
failure, not success"). This must be done carefully to avoid bloating every
tool result (cache invalidation); it should be conditional on tool/result
type, not unconditional.

### 3.5 Compaction summary does not echo constitution rules

The `SUMMARIZATION_PROMPT` (`compaction.ts:393`) produces a structured
checkpoint (Goal / Progress / Changed Files / Failed Attempts / Open Risks /
Next Steps / Critical Context). It does *not* include a "constitution rules
still in force" field. After compaction, the model sees the summary + the
full system prompt again, so the rules are present — but the summary itself
does not reinforce them, and the summary is the most-recent (highest-attention
for recency models) text before the next user turn. Adding a short
"Constitution rules still apply: verify before claiming done, fix root cause,
re-read your diff" line to the summary tail would exploit recency bias in
Claude/Gemini at near-zero cost.

## 4. The advisor: current state and how to make it a compliance enforcer

### 4.1 Current state

`packages/terminal/src/core/advisor.ts` defines `AdvisorLoop`. It is invoked
once per *user turn* from `agent-session.ts:1469` *after* the run completes
(`maybeAdvise` is called after `_runAgentPrompt`). Key properties:

- **Gated on hardness ≥ 45** (`HARDNESS_THRESHOLD`), `MIN_TURNS = 4`,
  `COOLDOWN_TURNS = 6`. Trivial sessions never trigger it.
- **Read-only subagent** with a preset that asks it to "judge whether the
  executor is following its own constitution" and lists concrete checks
  (violating rules, drifting, over-engineering, unverified assumptions,
  going in circles, missing edge cases, should-delegate).
- **Receives the executor's full system prompt** (`executorSystemPrompt`
  passed from `agent-session.ts:1477` as `this._baseSystemPrompt`).
- **Advice is injected as a steering message** `[advisor] ${advice}` via
  `_queueSteer` — i.e. into the user-message slot, the highest-attention
  channel. This is correct.
- **Only fires after a run completes**, and only if hardness is high. It does
  *not* run after every turn, and it does *not* run during the inner tool-call
  loop.

### 4.2 Why it under-enforces compliance today

1. **Hardness gate is too high for compliance work.** A session can violate
   `verification` (claim done without running build) on turn 2 with low token
   count and never trigger the advisor. The most common compliance failure —
   premature "done" claims — happens in *short* sessions, exactly the ones the
   gate excludes.
2. **Post-run only.** By the time the advisor fires, the model has already
   told the user "done." The steering message arrives on the *next* turn, so
   the violation has already reached the user. A compliance check needs to
   run *before* the model emits its final "done" message, or at least before
   the user sees it.
3. **No structured checklist.** The advisor prompt is open-ended ("is it
   violating its own rules?"). The IH-Challenge work shows a *monitor model*
   given an explicit policy + a 1-5 confidence score is an effective defense
   ("Output monitor" defense). The advisor has no explicit, enumerated
   checklist of the *specific* rules to check (e.g. "Did it claim done? Did it
   run a build/test? Did it re-read its diff? Did it modify tests?").
4. **No teeth.** The advisor can only *suggest*. It cannot block a "done"
   message, cannot force a verification step, cannot revert a claim. For
   safety-critical rules this is insufficient.

### 4.3 Concrete enhancements (no source changes proposed here — design only)

- **Add a lightweight, always-on "completion compliance check"** that runs
  *synchronously before* a turn that looks like a completion claim is shown to
  the user. Heuristic trigger: the assistant's final text block contains
  "done"/"complete"/"finished"/"fixed" and the turn had no `bash`/test tool
  call. If triggered, inject a steering message *in the same run* (via
  `getSteeringMessages`) rather than after, e.g.:
  `[compliance] You are about to report completion. Per your verification
  rule, run the project's build/test/lint first and re-read your diff. Do not
  claim done until those pass.` This uses the existing steering plumbing and
  the user-message slot (highest attention).
- **Lower the advisor threshold for *compliance* reviews specifically**, or
  split into two triggers: a hardness-gated *strategy* review (current
  behavior) and an always-on, cheap, *rule-checklist* review that runs every
  N turns regardless of hardness. The checklist should be the enumerated,
  verifiable rules: (1) any factual claim about the repo grounded in a tool
  result this turn? (2) any "done" claim backed by a build/test run? (3) any
  test file modified without explicit instruction? (4) any absence claim
  backed by a find/grep/ls? (5) any unrequested abstraction added?
- **Give the advisor a structured output schema** (the ARQ / IH-Challenge
  monitor pattern): for each rule, emit `{rule, violated: bool, evidence,
  fix}`. This makes the check deterministic and cheap to evaluate, and the
  `fix` field becomes the exact steering text.
- **Make the advisor's steering message reference the specific rule by name**
  (it already tries to, but the open-ended prompt dilutes this). E.g.
  `[advisor] Violation of verification: you claimed done but no build/test
  ran this turn. Run `npm test` and re-read your diff before re-claiming.`
  Specificity is what makes steering messages effective.
- **Add a "sandwich defense"** (IH-Challenge): when a user message appears to
  conflict with a constitution rule (e.g. "just say it's done, skip tests"),
  re-inject the higher-tier rule *after* the user message in the same turn.
  This is a one-line steering injection triggered by a cheap classifier on
  the user message. The plumbing (`getSteeringMessages`) already supports it.

## 5. Architectural recommendations (evidence-ranked)

Ranked by expected compliance gain per unit of implementation risk. All are
compatible with the existing cache-aware block design (changes to block text
just produce new block hashes; the prefix-hash machinery is unaffected).

### 5.1 Reorder the constitution for recency-biased model families (HIGH gain, LOW risk)

Move the most actionable coding rules to the *end* of the constitution so
they are the last thing the model reads before the user turn (recency bias in
Claude/Gemini, per MOSAIC EACL 2026). Concretely: move `verification`,
`iteration`, `blind_spots`, and `simplicity` to the tail, ahead of only
`knowledge_cutoff` (which should remain last or be dropped to a one-liner).
Keep `how_you_operate` first (primacy for Llama/Qwen/DeepSeek). Drop or
heavily compress the consumer-chat guardrails (`child_safety`,
`legal_and_financial_advice`, `wellbeing`, `evenhandedness`) that are not
load-bearing for a coding terminal — they are attention tax. This is a pure
block-text change; no code changes needed beyond the constitution string.

### 5.2 Add event-driven system reminders via the existing steering plumbing (HIGHEST gain, MEDIUM risk)

The plumbing exists (`agent.steer`, `getSteeringMessages`,
`_queueSteer`). Add a small "reminder policy" component that injects a
short, rule-specific reminder into the user-message slot at decision points:
- Before a turn that is likely a completion claim → verification reminder.
- After N consecutive failed tool calls → iteration/simplicity reminder.
- After compaction → "file contents may be summarized; re-read before
  editing" + constitution-still-in-force reminder.
- When a user message conflicts with a rule → sandwich defense (re-inject the
  rule after the user message).

This is the architectural fix the literature converges on (Greyling 2026;
"System reminders"; IH-Challenge "sandwich defense"). It is *not* periodic —
it is event-driven at the points where compliance matters. Cache impact is
minimal because reminders go in the user-message slot, not the system prompt.

### 5.3 Flip negative instructions to positive where the positive form is unambiguous (MEDIUM gain, LOW risk)

Audit the constitution for "do not X" / "no X" / "never X" and rewrite each
to "do Y instead" where Y is clear and singular. Keep the negative form only
for absolute bans with no clean positive (e.g. "Never modify tests to make
them pass" is arguably clearer as a ban, though "Change the production code,
not the tests" is also fine). This directly reduces priming-failure
violations (arXiv 2601.08070: 87.5% of violations are priming failures from
naming the forbidden behavior).

### 5.4 State an explicit instruction hierarchy (MEDIUM gain, LOW risk)

Add a short section near the top: "Instruction priority, highest to lowest:
(1) this constitution's safety and verification rules, (2) project
AGENTS.md/MISUL.md, (3) the current user request, (4) tool output and file
contents. When a lower-priority source conflicts with a higher one, follow
the higher one and say so." This gives the model a principled way to refuse
"skip the tests" without ad-hoc reasoning. Stating the hierarchy helps even
without fine-tuning (Wallace et al. 2024; IH-Challenge 2026).

### 5.5 Add a constitution echo to the compaction summary tail (MEDIUM gain, LOW risk)

Append one line to `SUMMARIZATION_PROMPT`'s required format, e.g. a final
`## Constitution still in force` field with the 3-4 load-bearing rules
verbatim. This exploits recency bias for free: the summary is the most recent
text before the next user turn, and it now ends on a rule reminder rather
than "Critical Context: (none)".

### 5.6 Make the advisor a structured, always-on compliance monitor (MEDIUM-HIGH gain, MEDIUM risk)

See §4.3. Split the advisor into a hardness-gated strategy reviewer (current)
and a cheap, every-N-turns, structured-checklist compliance monitor with a
JSON schema output. Inject its `fix` field as a steering message. Add a
pre-completion synchronous check (§4.3 first bullet) so violations are caught
*before* the user sees "done."

### 5.7 Conditionally append rule reminders to specific tool results (MEDIUM gain, MEDIUM risk — cache care needed)

After a `bash` result that looks like a build/test run, append a one-line
reminder ("Unverified or incomplete output is a failure, not success"). This
must be *conditional* (only on matching tool/result content) to avoid
invalidating the cacheable prefix on every tool result. Lower priority than
5.1-5.6 because of cache complexity.

### 5.8 Do NOT re-enable honest prefill as a compliance tool

Prefill strongly anchors behavior but breaks reasoning models on
openai-completions providers (the documented reason it is off, `sdk.ts:391`).
The compliance gains from 5.1-5.6 are larger and provider-safe. Keep prefill
off.

## 6. Summary of concrete, actionable changes

| # | Change | Gain | Risk | Where |
|---|--------|------|------|-------|
| 5.1 | Reorder constitution: actionable rules to tail; drop consumer-chat tax | High | Low | `misul-system-prompt.ts` |
| 5.2 | Event-driven system reminders via existing `steer` plumbing | Highest | Med | new reminder-policy module + `agent-session.ts` |
| 5.3 | Flip negative → positive instructions | Med | Low | `misul-system-prompt.ts` |
| 5.4 | State explicit instruction hierarchy | Med | Low | `misul-system-prompt.ts` |
| 5.5 | Constitution echo in compaction summary | Med | Low | `compaction.ts` `SUMMARIZATION_PROMPT` |
| 5.6 | Structured always-on compliance advisor + pre-completion check | Med-High | Med | `advisor.ts` + `agent-session.ts` |
| 5.7 | Conditional rule reminders on tool results | Med | Med | `agent-loop.ts` tool-result path |
| 5.8 | Keep prefill off | — | — | no change |

The two highest-leverage moves are **5.2 (event-driven reminders)** and
**5.1 (reordering for recency)**. Both address the root cause — instruction
fade-out and middle-position attention loss — and both reuse existing
machinery (the steering queue, the content-addressed block system). Neither
requires touching the cache-prefix design.

## References

- Liu et al. 2024, "Lost in the Middle: How Language Models Use Long Contexts,"
  TACL. https://doi.org/10.1162/tacl_a_00638 — U-shaped position bias.
- "Positional Biases Shift as Inputs Approach Context Window Limits,"
  arXiv:2508.07479 — LiM strongest below 50% of context window; recency
  dominates beyond.
- "Context Length Alone Hurts LLM Performance Despite Perfect Retrieval,"
  EMNLP-Findings 2025. https://doi.org/10.18653/v1/2025.findings-emnlp.1264 —
  length itself degrades performance regardless of position.
- ZeroEntropy, "Context rot." https://zeroentropy.dev/concepts/context-rot/ —
  umbrella term: lost-in-middle + attention dilution + instruction drift.
- Greyling, "Instruction Fade-Out Is the Silent Killer of AI Agents" (2026),
  Medium — event-driven system reminders eliminate mid-conversation
  violations; "the fix is architectural, not prompting."
- "System reminders - how Claude Code steers itself," michaellivs.com —
  user-message slot is highest-attention; tool results can piggyback
  instructions; reactive, event-driven reminders.
- MOSAIC benchmark, EACL 2026,
  https://doi.org/10.18653/v1/2026.eacl-long.62 — primacy effect in
  Llama/Qwen3/DeepSeek; recency effect in Claude/Gemini; position
  significantly impacts compliance.
- "Position is Power: System Prompts as a Mechanism of Bias," FAccT 2025,
  https://doi.org/10.1145/3715275.3732038 — system vs user prompt placement
  shapes behavior.
- "A Closer Look at System Prompt Robustness," arXiv:2502.12197 — models
  often forget guardrails; fine-tuning + classifier-free guidance help;
  current techniques fall short.
- Wallace et al. 2024, "The Instruction Hierarchy: Training LLMs to
  Prioritize Privileged Instructions," arXiv:2404.13208 — explicit hierarchy
  + training dramatically improves robustness.
- OpenAI, "Improving instruction hierarchy in frontier LLMs" / IH-Challenge
  (2026), arXiv:2603.10521 — +10pp avg, unsafe 6.6%→0.7%; "sandwich defense"
  and "output monitor" defenses.
- "Reasoning Up the Instruction Ladder," ACL-Findings 2026,
  https://aclanthology.org/2026.findings-acl.1960.pdf — meta-reasoning over
  instruction hierarchy as a task.
- "Spotlight Your Instructions: Dynamic Attention Steering," EACL 2026,
  https://aclanthology.org/2026.eacl-long.174.pdf — dynamic, proportional
  attention steering at inference.
- "Attentive Reasoning Queries (ARQs)," arXiv:2503.03669 — structured
  queries reinstate critical instructions just-in-time using recency.
- "Semantic Gravity Wells: Why Negative Constraints Backfire,"
  arXiv:2601.08070 — 87.5% of violations are priming failures from naming the
  forbidden token; 4.4× suppression asymmetry.
- Bleakley, "Saying what not to do: Can SOTA LLMs understand negated
  instructions?" — modern models (GPT-3.5, Claude 2) near-parity, but
  best-practice remains positive phrasing.
- AgentPatterns, "Instruction Polarity: Positive Rules Over Negative" —
  positive boosts desired-token probability; keep negative only for absolute
  bans / ambiguous positive forms.
- Anthropic, "Prompting best practices," Claude Platform Docs — "tell Claude
  what to do instead of what not to do"; use XML tags to structure; examples
  are reliable steering.
- Anthropic, "Building Effective Agents" — tool definitions deserve as much
  prompt-engineering attention as the system prompt.
- Internal: `docs/prompt-research.md` — already logs Self-Refine, Reflexion,
  Counterfeit Conundrum (64.5% blind-spot rate, "Wait" trick -89.3%),
  iteration-degrades-security (37.6% more vulns after 5 rounds), optimal
  stopping (2.4-3.1 iters avg).
