# Advisor Compliance Enforcement — Design Investigation

Investigation of how the advisor subagent in Misul Terminal could be enhanced
to enforce model compliance with the system prompt (constitution). This is a
design + code investigation. No source files were modified.

## 1. Current Advisor Limitations

Source: `packages/terminal/src/core/advisor.ts`

The advisor is a `AdvisorLoop` class with a single entry point `maybeAdvise`,
called once per user turn from `agent-session.ts:1469`.

Limitations, concrete:

1. **Hardness-gated, not compliance-gated.** It only fires when
   `computeHardness(metrics) >= 45` (line 104) AND `MIN_TURNS = 4` (line 99)
   AND `COOLDOWN_TURNS = 6` (line 105). Hardness is a weighted blend of token
   usage (40%), tool-call count (35%), and message count (25%) (lines 189-198).
   A session can violate the constitution on turn 2 and never trigger the
   advisor because hardness is still low. Conversely, a long but compliant
   session triggers it repeatedly for no reason.

2. **Between-turn only.** `maybeAdvise` is called *after* `_runAgentPrompt`
   returns (`agent-session.ts:1456` → `1469`), i.e. after the agent's full turn
   (including all tool calls and the final assistant message) has completed and
   been shown to the user. The advice is delivered via `_queueSteer`, which
   enqueues into `agent.steeringQueue`. Steering messages are only drained at
   turn boundaries inside `runLoop` (`agent-loop.ts:309`), i.e. before the
   *next* assistant response. The advisor cannot interrupt or correct the
   current turn.

3. **Advice only, never blocks.** The advisor's only action is
   `onAdvice(result.output.trim())` (line 133), which in the session wiring
   becomes `_queueSteer("[advisor] " + advice)` (`agent-session.ts:1474`). There
   is no escalation, no blocking, no record kept. The main agent is free to
   ignore the advice entirely.

4. **Single LLM call, no structure.** One `runSubagent` call with the
   `ADVISOR_PRESET` (lines 31-53). The output is free-form text; the only
   parsing is `!result.output.trim().startsWith("No advice")` (line 132). There
   is no structured verdict (unlike `autoreview.ts` which parses
   `AUTOREVIEW: PASS|FAIL`). Violation type, severity, and target message are
   not extracted, so compliance cannot be tracked over time.

5. **No state across reviews.** `_turnsSinceLastReview` and `_lastHardness` are
   the only state. There is no compliance history, no violation counter, no
   escalation tier. Each review is independent and forgets everything.

6. **Cost.** Each fire is a full subagent run (up to 90s timeout, line 123)
   with read/bash/grep/find tools. Firing more frequently for compliance checks
   would multiply LLM cost. The design must avoid an LLM call per turn.

7. **Conversation slice is tail-only.** `serializeConversation` (lines 200-211)
   takes the last 16000 chars. It cannot see the beginning of the session
   (original task, early claims) to detect drift from the stated goal.

## 2. Constitution Rules That Can Be Checked Programmatically

Source: `packages/terminal/src/core/misul-system-prompt.ts` (the
`MISUL_CONSTITUTION` export) and the global `AGENTS.md` constitution.

The constitution has named sections. Many rules are amenable to cheap,
deterministic (non-LLM) checks against the assistant message stream and tool
history. Below, each rule is mapped to a concrete, programmatic detector.

### 2.1 `how_you_operate` — verification before claims

Rule: "ground every factual claim about the repository, the filesystem, a
command's output, a library, or an API in something a tool returned this
session. If you have not run the check, do not state the conclusion."

Programmatic check (no LLM needed):
- Maintain a set of "verified facts" from tool results this session: file
  paths returned by `read`/`find`/`grep`, command outputs from `bash`, symbol
  names from `grep`.
- Scan each assistant text block for existence claims of the form
  `there (is|are|was|were) (a|an|the)? <Noun>` / `<Noun> exists` /
  `the <Noun> (has|uses|calls) <X>` where `<Noun>` is a file path, function
  name, or config value.
- If the claim references a path/symbol not in the verified-facts set AND no
  tool call in the preceding N messages produced it → flag
  `UNVERIFIED_CLAIM`.
- Claims of absence ("there is no X") are checkable too: flag if no
  `find`/`grep`/`ls`/`test` tool call with a matching pattern ran in the
  preceding window.

This is heuristic but catches the highest-value violation class (the
constitution calls it "the most common way an agent misleads").

### 2.2 `simplicity` — over-engineering

Rules: "No unrequested abstractions," "interface with one implementation,"
"factory for one product," "shortest working diff wins," "fewest files
possible."

Programmatic check (cheap, on the edit/write tool calls):
- Track `edit`/`write` tool calls. For each new file created (`write` to a
  path that wasn't in the verified-facts set), count: new
  interfaces/abstract classes, new files, new exported symbols, diff line
  count.
- Heuristics: a new file with a single-implementation interface, a new file
  under 30 lines that could have been added to an existing neighbor, a diff
  >300 lines for a task described in <20 words, a new dependency added to
  `package.json`.
- These are *signals*, not verdicts. They feed the LLM reviewer with concrete
  evidence rather than asking it to re-derive them.

### 2.3 `iteration` — going in circles

Rule: "iterate up to three times, then stop," "change one thing at a time."

Programmatic check (deterministic):
- Track repeated tool calls: same `bash` command (normalized) run 3+ times
  with failing results, same `edit` to the same file+lines reverted and
  re-applied, same `grep` pattern run repeatedly.
- Track `build`/`test` runs: if the same test file is run 3+ times and still
  fails → flag `CIRCLING`.
- This is purely structural and needs no LLM.

### 2.4 `tone_and_formatting` / `honesty` — formatting violations

Rule: "avoid over-formatting with bold emphasis, headers, lists, and bullet
points, using the minimum formatting needed for clarity."

Programmatic check (deterministic, on assistant text):
- Count markdown tokens per assistant message: `**bold**`, `### headers`,
  `- bullet` lines, `---` rules.
- Thresholds (tunable): more than 3 `**bold**` spans in a short reply (<200
  words), headers in a reply to a simple question, bullet lists used when
  declining a task (the constitution explicitly says "never use bullet points
  when declining a task").
- Also detect sycophancy markers: leading "You're absolutely right," "Great
  question," "Good point" — a regex on the first 80 chars of each assistant
  message.

### 2.5 `verification` — completion claims without evidence

Rule: "No completion claim without fresh verification evidence."

Programmatic check (deterministic):
- Detect completion phrases in the final assistant message of a turn:
  `done`, `finished`, `complete`, `fixed`, `it works now`, `tests pass`.
- Check whether a `build`/`test`/`typecheck` tool call ran *after* the last
  `edit`/`write` in the same turn. If not → flag
  `UNVERIFIED_COMPLETION`.
- This is the single most valuable check and needs no LLM.

### 2.6 `blind_spots` — not re-reading own diff

Rule: "Re-read your own diff before claiming done."

Programmatic check: if the final assistant message contains a completion
phrase AND no `read` of a changed file occurred after the last `edit`/`write`
in the turn → flag `NO_DIFF_REVIEW`.

### 2.7 Not using available skills

Rule (from `about_misul_terminal`): "ships a set of built-in skills you should
use when they apply."

Programmatic check: load the skill registry. If the user's request matches a
skill trigger pattern (e.g. `/skill:debug` exists and the task is debugging)
and the agent did manual steps the skill would automate → flag
`SKILL_NOT_USED`. This is the weakest check and likely needs the LLM reviewer
to judge relevance.

## 3. Proposed Enhanced Advisor Design

### 3.1 Two-tier architecture: cheap deterministic layer + LLM layer

The core design principle: **do not add an LLM call per turn.** The enhanced
advisor splits work into two tiers.

**Tier 1 — Deterministic Compliance Scanner (no LLM, runs every turn).**
A pure function over the session's message history and tool-call log. It
produces a list of `ViolationSignal` objects. This runs after every assistant
turn (in the same `maybeAdvise` slot) but is synchronous and costs nothing.

**Tier 2 — LLM Compliance Reviewer (runs only when Tier 1 flags something OR
hardness is high).** The existing advisor subagent call, but restructured:
it receives the Tier 1 signals as structured input and is asked to confirm or
reject each one against the constitution, then emit a structured verdict. This
keeps the LLM cost bounded to sessions where there is actual evidence of a
problem.

### 3.2 Proposed types

```ts
// New file: packages/terminal/src/core/compliance-scanner.ts

export type ViolationKind =
  | "UNVERIFIED_CLAIM"        // claimed X exists without a tool check
  | "UNVERIFIED_ABSENCE"      // claimed X doesn't exist without searching
  | "UNVERIFIED_COMPLETION"   // said "done" without build/test after last edit
  | "NO_DIFF_REVIEW"          // claimed done without re-reading changed files
  | "CIRCLING"                // repeated failed approach 3+ times
  | "OVER_ENGINEERING"        // single-impl interface, new file for <30 lines, etc.
  | "FORMATTING_EXCESS"       // bold/headers/bullets in a simple reply
  | "SYCOPHANCY"              // "You're absolutely right" etc.
  | "SKILL_NOT_USED";         // manual steps where a skill applies

export type Severity = "low" | "medium" | "high";

export interface ViolationSignal {
  kind: ViolationKind;
  severity: Severity;
  /** Message index in the session transcript. */
  messageIndex: number;
  /** The offending text snippet or tool-call signature. */
  evidence: string;
  /** The constitution section/rule violated. */
  rule: string;
  /** Suggested correction text, if deterministic. */
  suggestion?: string;
}

export interface ScanResult {
  signals: ViolationSignal[];
  /** Rolling compliance score 0-100, updated from history. */
  complianceScore: number;
}

/**
 * Pure, synchronous scan over the session transcript + tool log.
 * No LLM call. Called every turn.
 */
export function scanCompliance(
  messages: AgentMessage[],
  toolLog: ToolCallRecord[],
  history: ComplianceHistory,
): ScanResult { ... }
```

```ts
// Enhanced advisor state
export interface ComplianceHistory {
  /** Per-kind violation counts across the session. */
  counts: Record<ViolationKind, number>;
  /** Escalation tier per kind: 0=none, 1=warn, 2=correct, 3=block. */
  tier: Record<ViolationKind, number>;
  /** Turns since last violation of each kind. */
  turnsSince: Record<ViolationKind, number>;
  /** Last N scan summaries for trend. */
  recent: ScanResult[];
}
```

### 3.3 Escalation: warn → correct → block

Each `ViolationKind` has an independent escalation counter. The tier advances
when the same kind recurs within a cooldown window (e.g. 4 turns) and resets
when the agent stops offending.

- **Tier 1 (warn):** Inject a steering message: `[compliance] <rule>: <hint>`.
  This is the current advisor behavior, just more targeted.
- **Tier 2 (correct):** Inject a steering message AND set a flag that the next
  `beforeToolCall` for the offending tool category should be gated (see §4).
  Also surface the violation in the UI as a visible warning.
- **Tier 3 (block):** The `beforeToolCall` hook blocks the offending action
  with a reason referencing the constitution rule. The agent must acknowledge
  the correction before proceeding. For output-side violations
  (formatting/sycophancy), block the *next* assistant turn's emit until a
  correction is queued (see §5).

Tier transitions are per-kind, so an agent that keeps making unverified claims
gets blocked on claims while still being allowed to run builds.

### 3.4 Enhanced advisor preset (Tier 2 LLM)

The existing `ADVISOR_PRESET` becomes a structured reviewer. Key change: it
receives the Tier 1 signals and is asked to confirm/reject, not to discover
from scratch.

```ts
const COMPLIANCE_REVIEW_PRESET: AgentPreset = {
  name: "compliance-review",
  description: "Confirms or rejects deterministic compliance signals against the constitution",
  systemPrompt:
    "You are a compliance reviewer. You are given (a) the executor's constitution, " +
    "(b) a recent conversation slice, and (c) a list of deterministic violation signals " +
    "with evidence. For EACH signal, output a JSON line: " +
    "{\"kind\":\"...\",\"verdict\":\"confirmed|rejected|uncertain\",\"reason\":\"...\"}. " +
    "Reject a signal only if the evidence does not actually violate the cited rule. " +
    "Do not invent new violations. End with COMPLIANCE: PASS or COMPLIANCE: FAIL.",
  tools: ["read", "bash", "grep", "find"],
  strategy: "single",
};
```

The verdict is parsed the same way `autoReviewVerdict` parses
`AUTOREVIEW: PASS|FAIL` (`subagent/autoreview.ts:16-22`). Confirmed signals
feed the escalation state; rejected signals decrement the per-kind counter
(false positive forgiveness).

## 4. Mid-Turn Correction via `beforeToolCall`

The agent loop already supports a `beforeToolCall` hook that can block a tool
call (`agent-loop.ts:685-708`, `types.ts:51-59`). Returning
`{ block: true, reason }` causes the loop to emit an error tool result with
that reason instead of executing the tool. The session already uses this for
capability checks and the permission gate (`agent-session.ts:521-548`).

This is the only synchronous interception point *inside* a turn. The enhanced
advisor can use it for compliance gating:

```ts
// In agent-session.ts _installAgentToolHooks, compose with existing hook
this.agent.beforeToolCall = async ({ toolCall, args, context }) => {
  // ... existing capability + permission gate ...

  // Compliance gate (Tier 2/3 only)
  const gate = this._complianceGate.check(toolCall.name, args, context);
  if (gate.block) {
    return { block: true, reason: gate.reason };
  }
  return undefined;
};
```

`ComplianceGate.check` consults the current escalation tiers:

- `UNVERIFIED_COMPLETION` at Tier 3: block `bash` calls that look like
  completion statements? No — better: block the *next* `edit`/`write` after a
  completion claim until a build/test runs. Actually the cleanest: when the
  agent says "done" without verification, block *any* further tool call and
  inject `reason: "You claimed completion but ran no build/test after the last
  edit. Run the verification first (constitution: verification)."`.
- `CIRCLING` at Tier 3: block a `bash`/`edit` call that matches a
  already-failed-3-times signature, reason citing the iteration rule.
- `OVER_ENGINEERING` at Tier 3: block `write` to a new file when a neighbor
  file exists, reason citing the simplicity ladder rung 2.

Important constraint: `beforeToolCall` runs *before* the tool, not before the
assistant text. It cannot stop the agent from *saying* something wrong; it can
only stop the agent from *acting* on a wrong plan. For text-side violations
(formatting, sycophancy, unverified claims in prose), see §5.

There is no `beforeAssistantMessage` hook in the current loop. The assistant
response is streamed directly in `streamAssistantResponse` (`agent-loop.ts:331`)
and emitted token-by-token. Adding a mid-stream intercept would require a new
loop hook.

## 5. Output Blocking Before Showing to the User

This is the hardest part and the current architecture does not support it
cleanly. Findings:

### 5.1 What exists today

- The assistant message is streamed and emitted via `message_start` /
  `message_end` events as it is produced (`agent-loop.ts:232-233`, `257`).
  There is no point where the full message is buffered and reviewable before
  emit.
- `transformContext` (`agent.ts:447`, `agent-loop.ts:340-342`) rewrites the
    *input* messages before the LLM call; it cannot gate the *output*.
- `assistantPrefill` (`agent.ts:449`) prepends text to the assistant response;
    it cannot suppress it.
- `autoreview.ts` reviews subagent output *after* it completes and appends a
  verdict section to the output string. It does not block; it annotates. The
  subagent's output is not shown to the user until the subagent finishes, so
  appending a verdict is safe. The main agent's output is streamed live to the
  user, so the same trick does not apply.

### 5.2 Option A — Post-turn review + correction steering (no new hook)

The cheapest approach that fits the current architecture: run the compliance
scan *immediately after* the assistant turn completes but *before* the next
user turn. If a text-side violation is found at Tier 2+, queue a steering
message that forces a correction turn:

```
[compliance] Your previous message violated the constitution rule "<rule>":
<evidence>. Re-state the answer correctly. Do not repeat the violation.
```

Because steering messages are drained at the start of the next inner-loop
iteration (`agent-loop.ts:309`), this triggers a new assistant turn that
supersedes the offending one. The user still saw the offending message, but
gets an immediate, forced correction. This is strictly better than the current
advisor (which only advises and lets the agent ignore it).

### 5.3 Option B — Buffer-and-gate (new loop hook, higher cost)

To truly block the offending message before the user sees it, the loop would
need a new hook, e.g. `beforeAssistantMessageEmit(message): { block, rewrite }
| undefined`, invoked between `streamAssistantResponse` returning and
`message_end` being emitted. The session would hold the message, run the
deterministic scanner (fast), and either emit, emit-with-correction-prefix, or
suppress-and-re-run.

This requires changes to `packages/agent/src/agent-loop.ts` and
`packages/agent/src/types.ts` (new config field + new event semantics). It
also breaks the streaming UX (the user would see nothing until the review
completes). Recommend Option A for the first implementation and Option B only
if post-turn correction proves insufficient.

### 5.4 Option C — `shouldStopAfterTurn` + forced re-run

`AgentLoopConfig` already has `shouldStopAfterTurn` (used in the loop at
`agent-loop.ts:297-307`). The session does not currently set it, but it could
be used to keep the loop alive after a violating turn so a correction steering
message (queued in `afterToolCall` or via a turn-end listener) gets drained on
the next inner iteration rather than waiting for the user. This is a variant of
Option A that avoids the user having to send another message to trigger the
correction.

## 6. Steering Message Mechanics (Findings)

From `agent-session.ts:1586-1598` and `agent.ts:270-272`, `agent-loop.ts:193,309`:

- `_queueSteer(text)` pushes to `_steeringMessages` (for UI) and calls
  `agent.steer(message)`, which enqueues into `steeringQueue`.
- The loop drains `steeringQueue` via `getSteeringMessages` at two points:
  1. At the start of `runLoop` (line 193) — messages queued while the agent
     was idle.
  2. At the end of each inner-loop iteration (line 309) — messages queued
     during the turn.
- Drained messages are pushed onto `currentContext.messages` as user messages
  (lines 221-228) *before* the next `streamAssistantResponse`.
- **Steering messages cannot interrupt the current streaming assistant
  response.** They are only injected between assistant responses (after a tool
  batch, or when the agent would stop). So "mid-turn correction" via steering
  is really "next-iteration correction": the agent finishes its current
  response, then sees the correction as a user message and responds again.
- `followUp` messages (`agent.followUp`) are drained only when the agent would
  otherwise stop (`agent-loop.ts:313`), so they trigger a brand new turn after
  completion. This is the right channel for post-turn compliance corrections
  that should force a re-run without user input (Option C above).

## 7. Autoreview Mechanism — Applicability to Main Agent

Source: `packages/terminal/src/core/subagent/autoreview.ts`

`runAutoReview` runs a second subagent (`AUTOREVIEW` preset) over the first
subagent's output, parses `AUTOREVIEW: PASS|FAIL`, and appends a verdict
section. It merges cost/tokens/duration into the result.

Could a similar mechanism review the main agent's output before showing it?

- **Structurally yes:** the main agent's turn produces an `AssistantMessage`
  with text content. A reviewer subagent could be run over that text.
- **But the main agent streams live to the user.** Subagents run in the
  background and their output is only shown when complete, so appending a
  verdict is invisible until done. The main agent's tokens are already on
  screen by the time a reviewer could read them.
- **Therefore autoreview-as-gate does not transfer directly.** What does
  transfer is the *verdict parsing pattern* (`autoReviewVerdict`,
  lines 16-22) and the *structured PASS/FAIL convention*. The enhanced
  compliance reviewer (§3.4) should adopt the same convention:
  `COMPLIANCE: PASS|FAIL`, parsed identically.

The autoreview preset's pass criteria (build clean, tests pass, simplest
solution, no AI tells, etc., lines 173-183) are also a ready-made checklist
for the compliance reviewer's "over-engineering" and "AI code smells"
detections — reuse the wording rather than re-deriving it.

## 8. Architecture Diagram (Enhanced Flow)

```
User message
     |
     v
agent-session.prompt() -> _runAgentPrompt()
     |
     v
agent.run() -> runLoop()  [packages/agent/src/agent-loop.ts]
     |
     |   inner loop: streamAssistantResponse -> [tool calls] -> turn_end
     |                                          ^
     |   beforeToolCall hook (per tool)         |
     |     capability check                     |
     |     permission gate                      |
     |     >>> COMPLIANCE GATE (new) <<<        |
     |       - reads ComplianceHistory.tier     |
     |       - blocks Tier-3 violations        |
     |       - reason cites constitution rule   |
     |                                          |
     v                                          |
  turn complete (assistant message emitted)     |
     |                                          |
     +---> ComplianceScanner.scanCompliance()   |
     |       (Tier 1, deterministic, no LLM)    |
     |       produces ViolationSignal[]         |
     |                                          |
     +---> if signals.length > 0 OR hardness hi |
     |       runComplianceReview() (Tier 2 LLM) |
     |       preset: COMPLIANCE_REVIEW_PRESET   |
     |       input: signals + conversation      |
     |       output: COMPLIANCE: PASS|FAIL      |
     |       + per-signal confirmed/rejected    |
     |                                          |
     +---> update ComplianceHistory             |
     |       advance tier per kind              |
     |       (warn -> correct -> block)         |
     |                                          |
     +---> escalation action:                   |
     |       Tier 1: _queueSteer("[compliance] ...")
     |       Tier 2: _queueSteer + set gate flag
     |       Tier 3: gate flag active for next beforeToolCall
     |       text-side Tier 2+: _queueFollowUp(correction)  <-- forces re-run
     |                                          |
     v                                          |
  shouldStopAfterTurn? --- no --> loop back ----+
     |
     yes
     |
     v
  agent_end -> user sees result
```

Key flows:
- **Deterministic scan** runs every turn, zero LLM cost.
- **LLM review** runs only when scan flags something or hardness is high.
- **Tool-side blocking** happens synchronously in `beforeToolCall` (Tier 3).
- **Text-side correction** uses `_queueFollowUp` to force a correction turn
  without waiting for the user (Option C, §5.4).
- **Escalation state** persists in `ComplianceHistory` across the whole
  session, so repeat offenders escalate and compliant agents cool down.

## 9. Performance Considerations

- **Tier 1 scanner:** pure functions over message arrays and a tool log. O(n)
  in message count per turn. Negligible vs. LLM cost. Runs every turn.
- **Tier 2 LLM review:** only fires when Tier 1 produces signals OR hardness
  >= threshold. Bounded to sessions with actual evidence. Same cost envelope
  as the current advisor (one subagent call), but smarter about when to fire.
- **`beforeToolCall` gate:** a hashmap lookup per tool call. Negligible.
- **ComplianceHistory:** small in-memory object, serialized with the session
  if persistence is desired. No per-turn LLM cost.
- **Net:** the design *reduces* LLM cost for compliant sessions (no advisor
  fires on long-but-clean sessions) and *redirects* cost to sessions that
  actually need correction. The deterministic layer catches the
  highest-value violations (unverified claims, unverified completion, circling)
  with zero LLM cost.

## 10. Implementation Surface (Files That Would Change)

This is a design doc; no source was modified. A future implementation would
touch:

- **New:** `packages/terminal/src/core/compliance-scanner.ts` — Tier 1
  deterministic scanner + `ViolationSignal` / `ComplianceHistory` types.
- **New:** `packages/terminal/src/core/compliance-gate.ts` —
  `beforeToolCall` gate reading `ComplianceHistory`.
- **Modified:** `packages/terminal/src/core/advisor.ts` — restructure
  `AdvisorLoop.maybeAdvise` to call the scanner first, then conditionally the
  LLM reviewer; add `ComplianceHistory` state; add escalation logic.
- **Modified:** `packages/terminal/src/core/agent-session.ts:521` — compose
  the compliance gate into the existing `beforeToolCall` hook.
- **Modified:** `packages/terminal/src/core/agent-session.ts:1469` — wire the
  enhanced advisor's correction output to `_queueFollowUp` (not just
  `_queueSteer`) for text-side Tier 2+ corrections.
- **Optionally modified:** `packages/agent/src/agent-loop.ts` and
  `packages/agent/src/types.ts` — add `beforeAssistantMessageEmit` hook only
  if Option B (§5.3) is pursued.
- **New tests:** `packages/terminal/test/compliance-scanner.test.ts` —
  deterministic checks for each `ViolationKind` with fixture transcripts.

## 11. Summary

The current advisor is a between-turn, advice-only, hardness-gated reviewer
with no state. The enhanced design adds:

1. A **deterministic Tier 1 scanner** that runs every turn at zero LLM cost and
   catches the highest-value constitution violations (unverified claims,
   unverified completion, circling, formatting, sycophancy).
2. A **structured Tier 2 LLM reviewer** that fires only on evidence, confirms
   or rejects signals, and emits a `COMPLIANCE: PASS|FAIL` verdict (mirroring
   the autoreview convention).
3. **Escalation state** (`warn → correct → block`) per violation kind, so
   repeat offenders are blocked and compliant agents are left alone.
4. **Mid-turn tool blocking** via the existing `beforeToolCall` hook (Tier 3).
5. **Post-turn text correction** via `_queueFollowUp` to force a correction
   turn without user input (Option C). True pre-emit output blocking (Option
   B) requires a new loop hook and is recommended only if Option C is
   insufficient.
6. **Lower net LLM cost** than today for clean sessions, by replacing
   hardness-only gating with evidence-based gating.
