The function `divide` in `src/divide.mjs` does not handle division by zero. When the divisor is `0`, it should throw an `Error` whose message is exactly `division by zero` instead of returning `Infinity` or `NaN`.

Edit `src/divide.mjs` to throw `new Error("division by zero")` when the second argument is `0`. Normal division must keep working unchanged. Keep the export name and signature unchanged.
