# Prompt Research: Iteration, Refinement, Verification

Internal research log for system prompt improvements. Sources are real
implementations and academic papers, not vague advice.

## What We Have

The constitution (misul-system-prompt.ts) already has:
- "ground every factual claim in something a tool returned"
- "claims of absence need proof as much as claims of presence"
- "investigate before you answer"
- "write a short plan first, the steps and how you will confirm each"
- anti-sycophancy: "say so plainly rather than guessing", "do not fold correct positions"
- simplicity ladder (7 rungs), root-cause-fix, "never simplify away" boundaries

What it does NOT have:
- Explicit self-refinement / re-iteration instructions
- Re-reading your own diff before claiming done
- Verify-then-claim gate (run build/test, THEN report)
- Iterative refinement loop (try, check, fix, repeat)

## Key Findings From Research

### Self-Refine (Madaan et al. 2023, arxiv 2303.17651)

Three-stage loop: FEEDBACK -> REFINE -> iterate. Feedback must be:
- Actionable: concrete action that would improve output
- Specific: identify exact phrases to change

### Reflexion (Shinn et al. 2023, arxiv 2303.11366)

Agent articulates why last attempt failed, stores reflection in memory,
feeds it back for next try. 91% pass@1 on HumanEval vs GPT-4's 80%.

### verification-before-completion skill (obra/superpowers)

```
BEFORE claiming any status:
1. IDENTIFY: What command proves this claim?
2. RUN: Execute the FULL command
3. READ: Full output, check exit code, count failures
4. VERIFY: Does output confirm the claim?
5. ONLY THEN: Make the claim
```

Core: "NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE"

### Cursor agent prompt

"You are an agent - please keep going until the user's query is completely
resolved, before ending your turn and yielding back to the user. Only
terminate your turn when you are sure that the problem is solved."

### OpenAI Codex plan mode

"You work in 3 phases, and you should chat your way to a great plan before
finalizing it. A great plan is very detailed, intent- and implementation-wise,
so that it can be handed to another engineer or agent to be implemented right
away. It must be decision complete."

### Agent Zero

"- for exact outputs verify exact path filename permissions status codes
  line count bytes content and exit codes
- run representative checks and targeted tests before claiming done
- never treat timeout partial output or plausible result as verified success
- in final reports separate verified facts from assumptions and name checks
  not run"

### AGENTS.md (TheRealSeanDonahoe)

"Disagree when you disagree. If the user's premise is wrong, say so before
doing the work. Agreeing with false premises to be polite is the single
worst failure mode in coding agents."

### Is Self-Repair a Silver Bullet? (arxiv 2306.09896)

Self-repair gains are modest when cost is considered. Using a stronger model
to provide feedback significantly improves performance. Self-repair is
bottlenecked by the model's ability to provide feedback on its own code.

### Anti-pattern from system-prompts skill

"Self-critique without external feedback: detection is the bottleneck, not
correction" - meaning self-correction fails when the model can't detect its
own errors. External signals (build, tests, lint) are the reliable trigger.

## Production Agent Prompts (subagent 16cbd844)

### Claude Code
Loop tick injection for self-correction:
- Verify work by reading back changes
- Run tests or build commands
- Check for introduced errors
- If problems found, fix and re-verify BEFORE claiming done
- "Do not claim a task is done until you have verified"

### Cursor
Before making code changes:
1. Understand current state
2. Identify exactly what needs to change
3. Consider impact on other parts
4. Make changes
5. Verify by reading them back

### Devin (production)
Think tool required before:
- Critical git/GitHub decisions
- Transitioning from exploring to making changes (have you gathered ALL context?)
- Reporting completion (critically examine work, ensure all verification done)

"When struggling to pass tests, never modify the tests themselves. Always
first consider that the root cause might be in the code you are testing."

### Cline
- "Do not indicate that you will perform an action without actually doing it"
- "Always validate your answer with checking the code and running it"
- After fixing a bug, run the project's existing test suite, not just a
  reproduction script
- "When executing commands, do not assume success when expected output is
  missing or incomplete. Treat the result as unverified."

### SWE-agent
6-step workflow: analyze -> reproduce -> fix -> rerun -> edge cases -> submit
Submit review: rerun reproduction script, remove it, revert test file
changes, run submit again.

### AutoGPT
Mandated create -> dry-run -> fix loop, capped at 3 iterations.
Self-correction for truncated tool calls: detect empty args, return
guidance, let model self-correct instead of dying.

## Self-Correction Evidence (subagent 44ad29d9)

### Positive
- Self-repair universally improves pass rates (+4.9 to +17.1 pp HumanEval,
  +16 to +30 pp MBPP) with up to 5 attempts. Most gains in first 2 rounds.
- Reflexion: 91% pass@1 on HumanEval vs GPT-4's 80%
- Self-Refine: ~20% absolute improvement across 7 tasks
- Self-Planning: up to 25.4% relative improvement vs direct generation

### Negative (critical caveats)
- Self-repair is bottlenecked by feedback quality, not code generation.
  Human feedback 1.58x more effective than self-feedback.
- Models frequently misjudge their own incorrect code as correct
  ("Counterfeit Conundrum")
- 64.5% blind spot rate: models fail to correct identical errors in their
  own outputs while fixing them in user input. Appending "Wait" reduces
  blind spots by 89.3%.
- Iteration degrades security: 37.6% increase in critical vulnerabilities
  after 5 iterations. 43.7% of iteration chains contain more
  vulnerabilities than baseline after 10 rounds.
- Agent code is 2.3x more verbose and 2.0x more eroded than human repos.
- Adding SAST gates INCREASED latent degradation (agent routes around
  scanners instead of writing defensively).

### Optimal stopping
Confidence-calibrated stopping achieves 96-99% of quality with 8-iteration
cap, using only 2.4-3.1 iterations on average (60-70% compute saving).

### Anti-sycophancy
- RLHF trains models to prefer agreeable responses
- LLM code reviewers frequently issue false negatives (correct code judged
  non-compliant). Increasing prompt complexity makes it WORSE.
- Silicon Mirror: dynamic behavioral gating reduces sycophancy 9.6% -> 1.4%
- Anvil pushback protocol: enumerate explicit conditions for disagreement

## Factory/Droid, Codex CLI, OpenCode (subagent 7036fc11)

### Factory/Droid
- Phase-based: intent gate -> env sync -> diagnostic OR implementation
- "Never speculate about code you have not opened. If the user references
  a specific file, you MUST open and inspect it before explaining or
  proposing fixes."
- Implementation MUST end with a PR, only after all checks green
- Failure handling: STOP, report failing commands, do not proceed

### Codex CLI
- "You must keep going until the query or task is completely resolved"
- "Persist until the task is fully handled end-to-end within the current
  turn whenever feasible and persevere even when function calls fail"
- update_plan tool: 1-sentence steps, exactly one in_progress, mark
  completed before moving on
- AGENTS.md: read root + all directories from CWD up to root. Nested
  files take precedence. Direct instructions override AGENTS.md.

### OpenCode
- Model-specific prompts (different for GPT, Claude, Gemini, Codex, etc.)
- "MUST run the lint and typecheck commands" after completing tasks
- "Use one tool per message; after each result, decide the next step"
- Extreme verbosity constraints: "fewer than 4 lines" for CLI

## Design Principles For New Prompt Sections

1. Verification gate must be concrete: run build, run tests, THEN report.
   Not "review your work" (that's in the anti-patterns list).
2. Re-reading: re-read the diff before claiming done. The model's own
   output is not evidence of correctness.
3. Iteration: if build or tests fail, fix and retry. Don't report failure
   as success. Don't stop at the first error. Cap at 2-3 rounds (most
   gains concentrate there; more iterations degrade security).
4. Refinement: after a working version, check if it's the simplest version.
   The simplicity ladder applies to the result, not just the first attempt.
5. External signals over internal judgment: build/test/lint output is more
   reliable than self-assessment. Trust the tools, not the feeling.
6. Blind spot mitigation: treat your own output with suspicion. Re-read
   the diff as if reviewing someone else's code. The "Wait" trick
   (pause and reconsider) reduces blind spots by 89%.
7. Don't modify tests to make them pass. Root cause is in the code, not
   the test, unless explicitly told otherwise.
8. Don't assume success when expected output is missing or incomplete.
   Treat unverified results as failures.
9. Anti-sycophancy: enumerate explicit pushback conditions. Disagreeing
   with a wrong premise is more valuable than polite agreement.
10. Optimal stopping: if 2-3 refinement rounds don't fix it, stop and
    report rather than spiraling into degradation.
