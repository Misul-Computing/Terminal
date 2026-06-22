Implement an event-processing pipeline across the stub files in `src/` and `index.mjs`.

Each input line has the form `TYPE:payload` (split on the first colon). `pipeline(lines)` should parse each line, keep only events whose type is in the allowlist `["A", "B"]`, upper-case the payload of each kept event, and return the resulting payloads in input order. Type matching must be case-insensitive, so a line like `b:yo` counts as an allowed `B` event. Malformed lines that have no colon should simply be skipped rather than causing an error.

Implement `parseEvent`, `keep`, and `transform` in `src/`, and wire them together in `pipeline`.
