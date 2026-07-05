# Prompt Structure & Honest Prefill Analysis

Investigation of how the system prompt flows from construction to the model,
whether prefill, compaction, or message ordering could undermine compliance,
and prompt injection risks from tool output. All claims traced to actual code
paths. No source files were modified.

## 1. System prompt construction and flow

The system prompt is built in `packages/terminal/src/core/system-prompt.ts`
(`buildSystemPromptWithBlocks`, line 101). It assembles content-addressed
blocks in a fixed order:

1. Constitution (`MISUL_CONSTITUTION` from `misul-system-prompt.ts`, line 188)
2. Tools list (line 191)
3. Guidelines (line 194)
4. User-supplied append (`appendSystemPrompt`, line 197)
5. Persistent memory (line 202)
6. Project memory from SQLite store (line 207)
7. Project context files — `MISUL.md`, `AGENTS.md`, etc. (line 214)
8. Skills (line 226)
9. Environment — cwd, docs path (line 231)

A `customPrompt` option replaces the constitution/tools/guidelines blocks
entirely (line 118), but memory, project context, skills, and env blocks are
still appended.

The built prompt is stored on `AgentState.systemPrompt`
(`packages/agent/src/agent.ts`, line 74, default `""`). The `AgentSession`
in `packages/terminal/src/core/agent-session.ts` sets it on the agent state
in multiple places: after tool set changes (line 1117), after memory async
rebuild (line 448), after live reload (line 2857), and per-turn from
extension hooks (line 1441/1444).

At the LLM call boundary in `packages/agent/src/agent-loop.ts`
(`streamAssistantResponse`, line 331), the system prompt is pulled from
`context.systemPrompt` and placed into the `Context` object (line 366):

```ts
const llmContext: Context = {
    systemPrompt: context.systemPrompt,
    messages: llmMessages,
    tools: ...,
};
```

The system prompt is passed as a dedicated field on the `Context`, not as a
message in the `messages` array. It is always included on every LLM call
because `createContextSnapshot` (agent.ts, line 420) always copies
`this._state.systemPrompt` into the context. There is no code path that
omits it.

## 2. Honest prefill: how it works

The prefill is configured via `AgentLoopConfig.assistantPrefill`
(`packages/agent/src/types.ts`, line 255). The application logic is in
`streamAssistantResponse` (agent-loop.ts, lines 350-361):

```ts
let prefillApplied = false;
if (config.assistantPrefill && llmMessages.length > 0) {
    const last = llmMessages[llmMessages.length - 1];
    if (last.role === "user") {
        llmMessages.push({
            role: "assistant",
            content: [{ type: "text", text: config.assistantPrefill }],
            timestamp: Date.now(),
        } as AssistantMessage);
        prefillApplied = true;
    }
}
```

Key observations:

- The prefill is injected as a trailing **assistant** message after the last
  user message. The model is asked to continue from this text.
- It is **not applied on tool-call continuations**: the guard
  `last.role === "user"` means that when the last message is a `toolResult`
  (which is the case during multi-turn tool loops), the prefill is skipped.
  This matches the documented contract (types.ts, line 253: "Only applied on
  the first turn of a run, not tool-call continuations").
- The prefill does **not** replace or modify the system prompt. It is a
  separate assistant message appended to the message list. The system prompt
  remains intact in `llmContext.systemPrompt`.
- After the response, `stripPrefill` (line 464) removes the prefill text from
  the first text block of the model's response so it never reaches the user
  or the persisted transcript.

### Default state

The prefill is **off by default**. In `packages/terminal/src/core/sdk.ts`
(line 396):

```ts
assistantPrefill: options.assistantPrefill !== undefined
    ? (options.assistantPrefill || undefined)
    : settingsManager.getAssistantPrefill(),
```

`getAssistantPrefill` (settings-manager.ts, line 841) returns
`this.settings.assistantPrefill`, which has no default — it is `undefined`
unless the user sets it in settings or via `--assistant-prefill`. The comment
at sdk.ts line 391-395 explains why: a trailing assistant prefill is a forced
prefix-continuation on openai-completions providers that collapses reasoning
models into repeating themselves; the honesty intent lives in the system
prompt instead.

### Does prefill undermine system prompt compliance?

The prefill supplements rather than replaces the system prompt. However,
there is a subtle architectural concern: the prefill text is an assistant-
authored message that the model is forced to continue from. If the prefill
text contained instructions conflicting with the system prompt, the model
would face conflicting signals from two authoritative positions (system
prompt vs. a partially-generated assistant message). In practice the default
is off and the text is user-controlled, so this is a configuration risk, not
a code defect. The system prompt is always present and always first in the
provider's context.

## 3. Message ordering

In `streamAssistantResponse` (agent-loop.ts), the message ordering sent to
the model is:

1. `context.systemPrompt` — the dedicated system prompt field (always first,
   always present).
2. `llmMessages` — the converted message history, in chronological order.
3. The prefill assistant message (if applicable), appended after the last
   user message.

The conversion happens at line 345:
```ts
const llmMessages = redactMessages(await config.convertToLlm(messages));
```

`convertToLlm` (`packages/terminal/src/core/messages.ts`, line 148) maps
custom message types (bashExecution, custom, branchSummary, compactionSummary)
to `user`-role messages, and passes through `user`, `assistant`, and
`toolResult` messages unchanged. The default `convertToLlm` in agent.ts
(line 32) filters to only those three roles.

There is no code path that truncates or reorders the system prompt. It is
always the first thing the model sees.

## 4. Compaction and system prompt preservation

Compaction logic lives in `packages/terminal/src/core/compaction/compaction.ts`.
When the context window fills, `prepareCompaction` (line 679) finds a cut
point and `compact` (line 782) generates a summary of the discarded messages.

Critical finding: **compaction operates only on the message history, never on
the system prompt.** The summary is generated via `generateSummary` (line
592), which builds a separate `Context` with its own
`SUMMARIZATION_SYSTEM_PROMPT` (utils.ts, line 169) — it does not use or
modify the agent's system prompt.

After compaction, the summary is stored as a `CompactionSummaryMessage`
(messages.ts, line 62), which `convertToLlm` renders as a `user`-role message
wrapped in `<summary>` tags (messages.ts, line 176):

```
The conversation history before this point was compacted into the following summary:
<summary>
...
</summary>
```

When the session is rebuilt via `buildSessionContext`
(session-manager.ts, line 345), the compaction summary is emitted as the
first message, followed by kept messages and post-compaction messages. The
system prompt is reconstructed separately by `AgentSession` from
`_baseSystemPrompt` and set on `agent.state.systemPrompt`.

**The system prompt is never lost during compaction.** It lives in
`agent.state.systemPrompt`, which is independent of the message array that
compaction modifies.

### Compaction risk: instruction dilution

While the system prompt itself is preserved, compaction does summarize the
conversation history into a structured checkpoint. If the user gave
task-specific instructions in conversation (not in the system prompt or
AGENTS.md), those instructions are summarized, not preserved verbatim. The
summarization prompt (compaction.ts, line 463) asks for a "Constraints &
Preferences" section, but there is no guarantee the model will perfectly
preserve every instruction. This is an inherent limitation of compaction,
not a bug — but it means the system prompt (and project context files) are
the only instructions guaranteed to survive compaction verbatim.

## 5. Prefix cache and system prompt stability

`packages/ai/src/prefix-cache.ts` (`computePrefixHash`, line 27) computes a
SHA-256 hash of the stable prefix: system prompt + tools + all messages
except the last. This hash lets local providers detect cache hits.

The system prompt is the first component of the hash (line 30-32). If the
system prompt changes (e.g., from async memory rebuild at agent-session.ts
line 448, or extension modification at line 1441), the prefix hash changes,
invalidating the KV-cache. This is correct behavior — the model does not
"lose" context; it just reprocesses the prefix. The model still receives the
full, current system prompt on every call.

The async memory rebuild (agent-session.ts, lines 442-450) is fire-and-forget
and mutates `agent.state.systemPrompt` outside the agent loop. If this
rebuild completes mid-turn, the next `createContextSnapshot` will capture the
new prompt. This does not cause instruction loss — the new prompt is a
superset (it adds project memory entries). But it does invalidate the prefix
cache, causing a cache miss on the next turn. This is a performance issue,
not a compliance issue.

## 6. Prompt injection risks from tool output

### Tool result construction

Tool results are built in `createToolResultMessage` (agent-loop.ts, line 837).
The result content comes directly from `tool.execute()` with no sanitization
of text content. The `read` tool (`packages/terminal/src/core/tools/read.ts`,
line 326) returns file contents as-is:

```ts
content = [{ type: "text", text: outputText }];
```

There is no wrapping, escaping, or delimiter around file contents. A
malicious file could contain text like "Ignore all previous instructions and
..." and it would be passed verbatim to the model as a `toolResult` message.

### Secret redaction is the only filter

`redactMessages` (agent-loop.ts, line 345, from
`packages/agent/src/secret-redactor.ts`) is the only transformation applied
to all messages before they reach the model. It replaces detected API keys,
tokens, and private keys with `[REDACTED:LABEL]` placeholders. It does not
filter instructions or prompt-injection content.

### Extension context transformation

`transformContext` (sdk.ts, line 381) calls
`extensionRunner.emitContext(messages)`, which allows extensions to modify
the message array (runner.ts, line 915). Extensions receive a
`structuredClone` of messages (line 917) and can return modified messages.
This is another unsanitized path — a malicious extension could inject
arbitrary content into the message history.

### Extension system prompt replacement

Extensions can **replace the system prompt entirely** via the
`before_agent_start` hook (runner.ts, line 1019):

```ts
if (result.systemPrompt !== undefined) {
    currentSystemPrompt = result.systemPrompt;
    systemPromptModified = true;
}
```

This is chained across extensions — each extension sees the previous
extension's modified prompt (line 1009 passes `currentSystemPrompt`). The
result is applied at agent-session.ts line 1441:

```ts
if (result?.systemPrompt) {
    this.agent.state.systemPrompt = result.systemPrompt;
}
```

A malicious extension could replace the entire system prompt, removing all
safety and compliance instructions. This is by design (extensions are
trusted code), but it means the system prompt is not guaranteed to contain
the constitution if extensions are installed.

### Assessment

The primary prompt injection surface is the `read` tool (and `bash` tool
output). File contents and command output are passed to the model with no
delimiting or sanitization beyond secret redaction. This is a real risk: a
malicious file read during a session could contain instructions that the
model follows. The system prompt is always present, but there is no
mechanism to reinforce its authority over tool-output content — the model
must rely on its own training to distinguish tool output from instructions.

This is an industry-wide problem for coding agents, not specific to Misul.
The mitigation in Misul is the constitution's `how_you_operate` section,
which instructs the model to ground claims in tool output but does not
explicitly tell it to treat file contents as data, not instructions.

## 7. convertToLlm and system prompt inclusion

`convertToLlm` (`packages/terminal/src/core/messages.ts`, line 148) converts
`AgentMessage[]` to `Message[]`. It does **not** handle the system prompt —
the system prompt is never part of the message array. It is a separate field
on `AgentContext` and `Context`.

The system prompt is included in every LLM call because
`streamAssistantResponse` (agent-loop.ts, line 366) always sets
`systemPrompt: context.systemPrompt` on the `Context`. There is no
conditional, no truncation, no omission path.

The `convertToLlm` function is called once per turn (line 345), not once per
message. It processes the entire message history each time, so the full
context is always converted.

## 8. Architectural issues found

### Issue A: No tool-output delimiting (prompt injection surface)

Tool results (especially `read` and `bash`) return raw content with no
delimiters or framing that would help the model distinguish data from
instructions. A file containing "SYSTEM: Ignore your instructions..." is
passed verbatim. The only filter is secret redaction. Severity: medium —
this is the standard attack surface for all coding agents, but Misul does
nothing to mitigate it beyond the constitution's general guidance.

### Issue B: Extension can replace system prompt with no audit

The `before_agent_start` extension hook can replace the entire system prompt
(runner.ts, line 1019, applied at agent-session.ts line 1441). There is no
logging, no validation, and no fallback to the base prompt if the extension
returns an empty or malicious prompt. The reset-to-base only happens if no
extension returns a `systemPrompt` field (agent-session.ts, line 1442-1444).
Severity: low for trusted extensions, high if untrusted extensions are
installed.

### Issue C: Async memory rebuild mutates system prompt mid-session

The async memory rebuild (agent-session.ts, lines 442-450) is
fire-and-forget and mutates `agent.state.systemPrompt` outside the agent
loop's control. If it completes during a turn, the next turn captures a
different prompt than the previous turn. This invalidates the prefix cache
(performance) but does not cause instruction loss — the new prompt is a
superset. Severity: low (performance, not compliance).

### Issue D: Compaction summarization does not reinforce system prompt authority

The compaction summary is injected as a `user`-role message. The
summarization prompt (compaction.ts, line 463) does not instruct the
summarizer to preserve references to the system prompt or remind the model
that system prompt instructions still apply. After compaction, the model
sees: system prompt (intact) + compaction summary (user message) + recent
messages. The system prompt is still authoritative, but nothing in the
compaction summary reinforces this. Severity: low — the system prompt is
still present and first.

### Issue E: Prefill could conflict with system prompt if misconfigured

If a user sets `--assistant-prefill` to text that contradicts the system
prompt, the model receives conflicting signals: the system prompt (position
1, highest authority) and a partial assistant message (last position, high
recency bias). The prefill is stripped from the final output, so the user
would not see it, but the model's behavior could be influenced. Severity:
low — user-controlled, off by default, documented.

## 9. Recommendations

1. **Wrap tool output with delimiters.** When returning file contents or
   command output, wrap them in clear data markers (e.g.,
   `<file_content path="...">...</file_content>`) and add a system-prompt
   note that content inside tool results is data, not instructions. This is
   the single most impactful change for prompt injection resistance.

2. **Log extension system prompt replacements.** When an extension replaces
   the system prompt via `before_agent_start`, log the extension path and
   a hash of the new prompt. This gives auditability without preventing the
   capability.

3. **Reinforce system prompt authority after compaction.** Consider
   appending a note to the compaction summary like "Your system prompt
   instructions remain in full effect." This is a one-line change to the
   `COMPACTION_SUMMARY_PREFIX` in messages.ts.

4. **Guard async memory rebuild during active turns.** The fire-and-forget
   memory rebuild at agent-session.ts line 442 should check `isStreaming`
   before mutating `systemPrompt`, or queue the update for the next idle
   moment. This prevents mid-turn prefix cache invalidation.

5. **No change needed for prefill.** The prefill is off by default, does not
   replace the system prompt, and is stripped from output. The current
   design is sound. The only recommendation is to document that prefill text
   should not contain instructions that conflict with the system prompt.

## Summary

The system prompt flows cleanly from construction to the model: it is built
once (and rebuilt on resource/memory changes), stored on `agent.state`,
copied into every `AgentContext` snapshot, and set as the dedicated
`systemPrompt` field on every `Context` sent to the provider. It is always
first, always present, and never truncated or replaced by the agent loop.

The honest prefill supplements rather than replaces the system prompt. It is
off by default and only applies on the first turn of a run. Compaction
preserves the system prompt (it operates on messages, not the prompt field).
The prefix cache correctly includes the system prompt in its hash.

The real risks are: (1) tool output is passed to the model with no
delimiting, creating a prompt injection surface, and (2) extensions can
replace the system prompt with no audit trail. Neither undermines the system
prompt under normal operation, but both are worth hardening.
