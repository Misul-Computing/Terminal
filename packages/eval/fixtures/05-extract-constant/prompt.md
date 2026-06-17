In `src/circle.mjs`, the magic number `3.14159` is hard-coded inside `circleArea`. Extract it into a module-level constant named `PI` (declared with `const PI = 3.14159;`) and use that constant inside `circleArea` instead of the literal.

Behavior must not change: `circleArea(r)` must still return `PI * r * r`. Keep the export name and signature unchanged.
