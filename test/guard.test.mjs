import assert from "node:assert/strict";
import { apply } from "../index.js";

const guards = [];
const ctx = {
  tools: {
    guard(callback) {
      guards.push(callback);
      return () => {};
    }
  }
};

apply(ctx, {});
assert.equal(guards.length, 1, "default config registers one guard");
const guard = guards[0];
assert.match(guard({ name: "pwsh", arguments: { command: "grep -rn x ." } }), /dsh-search-guard/);
assert.equal(guard({ name: "pwsh", arguments: { command: "rg -n x src" } }), undefined);
assert.equal(guard({ name: "read", arguments: { command: "grep -rn x ." } }), undefined, "non-shell tools are untouched");
assert.equal(guard({ name: "pwsh", arguments: {} }), undefined, "missing command is ignored");

apply(ctx, { tools: ["bash"], blocked: ["find"] });
const custom = guards.at(-1);
assert.equal(custom({ name: "pwsh", arguments: { command: "find ." } }), undefined, "custom tool list is honoured");
assert.match(custom({ name: "bash", arguments: { command: "find ." } }), /find/, "custom block list is honoured");
assert.equal(custom({ name: "bash", arguments: { command: "grep x" } }), undefined, "replaced block list no longer blocks grep");

let warned = "";
const originalWrite = process.stderr.write;
process.stderr.write = (chunk) => {
  warned += String(chunk);
  return true;
};
try {
  apply({ tools: {} }, {});
} finally {
  process.stderr.write = originalWrite;
}
assert.match(warned, /guard is unavailable/, "a host without the guard seam only warns");

console.log("guard tests passed");
