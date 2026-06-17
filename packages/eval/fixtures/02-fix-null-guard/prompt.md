The function `firstChar` in `src/strings.mjs` throws a TypeError when called with `null` or `undefined` because it indexes into the argument without checking.

Edit `src/strings.mjs` so that `firstChar(null)` and `firstChar(undefined)` return an empty string `""` instead of throwing. Calling it with a non-empty string must still return the first character. Keep the export name and signature unchanged.
