# @misul/eval

Quality-per-dollar (QpD) eval meter for the Misul agent.

## What and why

The meter measures how much task quality you get per dollar of model spend for a
given **harness configuration** (model + tool allowlist + prompt), and does a
statistically honest A/B between two configurations. Its purpose is comparing
harness configs — most often the *same* model with *different* tools or prompt —
so the primary A/B lever is `--variant-tools` differing from the baseline
`--tools`.

For each fixture it clones the input into an isolated temp dir, drives the agent
headlessly, then grades with a deterministic Tier-1 oracle (the fixture's
`testCommand`; exit 0 = pass). Per-run cost and tokens come from the SDK's
authoritative `getSessionStats()`, cross-checked against an independent
per-message collector.

The `compare` command runs baseline vs variant over the **same fixtures and
trial indices** (matched pairs) and applies a significance gate:

- **McNemar** paired test on pass/fail outcomes (`p < 0.05`), and
- a **bootstrap 95% CI on the per-fixture QpD delta** that must exclude 0.

The CI is built on quality-per-dollar (`mean(score)/mean(cost)` per fixture),
not on pass-rate, so a variant that improves pass-rate while ballooning cost is
*not* flagged as a significant win.

## Trial semantics ("seed")

The `seed` field is a **trial index, not an RNG seed**. pi-ai exposes no RNG
seed, so the meter cannot make runs reproducible. Variation across trials comes
solely from provider sampling nondeterminism. With a deterministic model and no
temperature, repeated trials are identical and the meter correctly reports no
signal. Pass a non-zero `--temperature` (when supported by the provider/model)
if you want trial-to-trial variation; with no temperature the provider default
applies. The field name `seed` is kept only to limit churn.

## Build

```sh
npm run build            # tsgo -p tsconfig.build.json -> dist/
npx tsc --noEmit         # type-check src + test via tsconfig.json
```

## Run

```sh
# One config:
misul-eval run --seeds 3 --fixtures 01-add-return-type --tools read,write

# A/B two harness configs (same model, different tools is the primary case):
misul-eval compare \
  --seeds 3 \
  --tools read,write \
  --variant-tools read,write,bash \
  --variant-label with-bash

# Optionally compare a different variant model (resolved via the SDK registry;
# qualify as provider/id if the bare id is ambiguous):
misul-eval compare --variant-model anthropic/claude-opus-4-5
```

Flags: `--seeds N`, `--fixtures a,b`, `--label name`, `--tools a,b`,
`--variant-tools a,b`, `--variant-model id`, `--variant-label name`.

## Tests

```sh
npx vitest run
```

Offline tests use the pi-ai faux provider (zero API cost). The live smoke test is
gated behind `MISUL_EVAL_LIVE` and skipped by default.
