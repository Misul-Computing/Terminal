# Bundled Skills — Attribution

The skills in this directory are vendored, bundled default skills shipped with
Misul Terminal. They are loaded as the lowest-precedence skill root: user and
project skills with the same name always override them.

All bundled skills are distributed under the MIT License.

## ponytail

- Author: ponytail skill author
- License: MIT (declared in the skill's own frontmatter)

## system-prompts

- Source: oh-my-pi (`.omp/skills/system-prompts`, https://omp.sh)
- Copyright (c) 2025 Mario Zechner, Copyright (c) 2025-2026 Can Bölük
- License: MIT

## semantic-compression

- Source: oh-my-pi (`.omp/skills/semantic-compression`, https://omp.sh)
- Copyright (c) 2025 Mario Zechner, Copyright (c) 2025-2026 Can Bölük
- License: MIT

## frontend-design

- Source: Original Misul Terminal skill.
- License: MIT
- Aesthetic principles informed by Anthropic's `frontend-design` skill
  (Apache-2.0, claude-plugins-official). The design-token system, execution
  scaffolding, and accessibility/quality floor are original additions that make
  the guidance universal across models. No text is copied from that skill, so
  the bundle remains MIT.

## api-design

- Source: Original Misul Terminal skill.
- License: MIT
- Original synthesis of standard HTTP/REST and backend API best practice into
  universal, model-agnostic scaffolding (method/status semantics, error
  envelope, boundary validation, pagination, versioning, an auth/security floor,
  idempotency, observability).

## secure-coding

- Source: Original Misul Terminal skill.
- License: MIT
- Original synthesis of defensive secure-coding best practice into universal,
  model-agnostic scaffolding (boundary validation, injection-safe queries and
  commands, output encoding, authn/authz, secrets, vetted crypto, dependency
  hygiene, safe failure, SSRF/deserialization safety).
