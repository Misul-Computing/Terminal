# Cache-Aware Agent Design

Source: `~/Downloads/cache_aware_agent_design.pdf` (June 2026).

Prompt caching is an architectural constraint, not just a provider
discount. Agents that render prompts as deterministic layered artifacts
keep long coding loops cheap. Agents that treat prompts as unordered
strings pay full price every turn.

## Canonical prompt layer order

Stable prefix (cacheable), then dynamic suffix (never cached):

1. Provider/system invariant (global policy, no dates, no IDs)
2. Agent invariant (role, safety policy, behavior version)
3. Tool schema block (canonical JSON, sorted by stable name)
4. Project invariant (AGENTS.md excerpt, build/test commands)
5. Repo summary (deterministic pruned tree, architecture summary)
6. Session memory (compacted summary epoch, durable memory manifest)
   - cache boundary -
7. Active task (current user request, issue text)
8. Recent tool outputs (file reads, diffs, grep, terminal logs)
9. Latest user message

## Determinism rules

No timestamps in the prefix. No random IDs, UUIDs, request IDs, device
IDs. No nondeterministic object key ordering (canonical JSON, RFC 8785).
No unstable ordering of tools, MCP servers, files, commands. No absolute
temp paths in stable blocks. No dynamic token budgets before stable
content. No per-turn state inside the tool registry. No auto-summaries
that rewrite stable blocks every turn. No whitespace churn (normalize
trailing spaces, blank lines, line endings).

CI gate: render the same repo/session twice and require identical prefix
hashes.

## Tool schema caching

Tool schemas are often the largest cacheable block. A large fixed list
that stays cache-hot is cheaper than a small dynamic list that changes
each turn. Sort tools by stable name, not discovery order. Use canonical
JSON for schemas. Keep per-turn permission changes out of the tools
array (use request metadata or late policy text). Version tool schemas
semantically: additive optional args are minor, changed semantics are
major and create a cache epoch.

MCP tools: sort servers by stable namespace, defer full schemas until
needed, strip runtime paths/ports/tokens from descriptions.

## Session compaction

Compaction must be epochal, not per-turn. Rewriting a summary every turn
destroys cache locality. A compaction event creates a new cache epoch
with a manifest and stable block IDs. Split session context into: stable
session manifest, compacted summary epoch, dynamic tail (last k
messages), external trace store (full local transcript, not always sent).

## Subagents

Subagents should share a Prefix ABI (provider policy, safety rules, tool
registry, project capsule, repo summary, session epoch) and diverge late
through a compact role overlay. Target 80%+ stable prefix token sharing
across built-in subagents for the same project/session.

## Provider semantics

Anthropic: cache_control breakpoints, hierarchy tools -> system ->
messages, up to 4 breakpoints, 5 min default TTL (1h option), 1.25x
write cost for 5m / 2x for 1h, reads at 0.1x input. Place cache_control
on the last tool and on the system block.

OpenAI: automatic prefix caching on recent models, 1024+ token minimum,
prompt_cache_key for routing, retention parameter.

Gemini: implicit caching on 2.5+ models, explicit cache objects in
Generate Content API. Place large common content first.

OpenRouter: session_id for sticky routing, passes provider-specific
controls through.

## Telemetry

Log per call: call ID, session ID, cache lane, provider, model, adapter
version, input tokens, cached read tokens, uncached input tokens, cache
write tokens, output tokens, cache hit %, cacheable prefix length, stable
block hashes, TTFT, latency, cost, invalidation reason.

Alert when: hit rate below 70% for a lane with stable prefix > 10k
tokens, tool registry hash changed outside install/update, project
prefix changed while HEAD and AGENTS.md are unchanged, session summary
rewritten more often than epoch policy, dynamic block leaked into prefix.

## Cost model

Break-even for explicit cache writes: T > 1 + (cw - ci) / (ci - cr).
A cacheable prefix reused even once after the initial write pays for the
write premium when read discount is steep.

## Failure modes

Stale repo summary causes wrong edits (mitigate with capsule age score,
dirty-tree detector, changed-file retrieval). Compaction hides
constraints (summary rubric, invariant extraction, epoch rollback).
Cache-preserving prompt becomes too rigid (role overlays, quality evals).
Provider changes caching behavior (adapter capability flags, integration
tests). Context truncation breaks prefix (token-budget simulator before
send, fail closed if stable prefix would be truncated). TTL expires
mid-session (detect provider miss with stable local hash, refresh lane).

## Implementation phases

1. Observability: block hash logging, normalized telemetry, cost
   accounting, prompt-debug screen.
2. Deterministic renderer: typed PromptBlock model, canonical JSON,
   stable ordering, provider adapters, CI snapshots.
3. Project Cache Capsule: repo tree normalizer, manifest parser,
   build/test command catalog, architecture summary hasher.
4. Cache-aware session compaction: summary epochs, block-addressed
   memory, dynamic tail windows.
5. Subagent Prefix ABI: shared block set, role overlay format,
   subagent tool-permission policy.
6. Provider-specific optimization: OpenAI prompt_cache_key, Anthropic
   cache_control breakpoints, Gemini cache objects, OpenRouter stickiness.
7. Benchmark and tuning: synthetic repeated-turn, real repo coding,
   tool-heavy, multi-agent, long-session, compaction, dirty-tree,
   model-routing benchmarks.

## Recommended defaults

Prompt layout: provider/system, agent, stable tools, project capsule,
repo summary, session epoch, then active task, retrievals, tool outputs,
latest user message.

Cache-hit target: 70%+ cached-token ratio on sessions with cacheable
prefix > 10k tokens, 85%+ on mature project lanes.

## Cache aggressiveness setting

The `cacheAggressiveness` setting controls how many explicit cache
breakpoints are placed for providers that support them (Anthropic).
It is configurable via `/settings` or `settings.json`:

- `off`: no cache_control markers. Every call pays full price. Use
  only for debugging or providers that handle caching implicitly.
- `standard` (default): 3 breakpoints. System prompt, last tool
  definition, last user message. Covers the stable prefix and the
  growing conversation tail.
- `aggressive`: 4 breakpoints. Adds the second-to-last message,
  caching the conversation up to the end of the previous turn. On
  the next turn, this breakpoint hits cache, so only the new messages
  are uncached. Costs one extra cache write per turn but pays off on
  every subsequent turn.

The setting maps to `cacheAggressiveness` in `StreamOptions` and is
resolved per provider. Providers without explicit breakpoints
(OpenAI, Google) ignore it and use implicit prefix matching.

OAuth (Claude Code) sessions use 2 system prompt breakpoints, leaving
only 2 slots for tools and last message. The 4th breakpoint is skipped
for OAuth regardless of this setting.

Debug per-call cache stats with `MISUL_CACHE_DEBUG=1`, which logs
`in`, `read`, `write`, `hit%`, prefix hash, and epoch ID to stderr
on every assistant response. Set `MISUL_CACHE_LOG_FILE` to a path to
append the same per-call log to a file. Use `/cache` in the
interactive terminal to see session-level cache statistics including
hit rate, cost savings vs no-cache, prefix hash, and per-call
breakdown.
