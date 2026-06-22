import assert from "node:assert/strict";
import { pipeline } from "./index.mjs";

// Core: parse "TYPE:payload", keep allowlisted types (case-insensitive),
// upper-case the payload, skip malformed lines, preserve input order.
assert.deepEqual(pipeline(["A:hi", "b:yo", "C:no", "garbage"]), ["HI", "YO"]);

// Edge cases / regression.
assert.deepEqual(pipeline([]), []);
assert.deepEqual(pipeline(["A:x"]), ["X"]);
assert.deepEqual(pipeline(["nope:1", "B:two"]), ["TWO"]);

console.log("07-event-pipeline ok");
