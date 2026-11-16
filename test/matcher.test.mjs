import assert from "node:assert/strict";
import { denialMessage, findBlockedCommand } from "../matcher.js";

const blocked = new Set(["grep", "egrep", "fgrep", "find"]);

const denied = [
  "grep -rn x .",
  "Get-ChildItem | grep x",
  "cd src; find . -name \"*.ts\"",
  "if ($x) { grep foo }",
  "echo ok && find . -name x",
  "C:\\tools\\grep.exe -n x ."
];
for (const command of denied) {
  assert.notEqual(findBlockedCommand(command, blocked), null, `expected a hit: ${command}`);
}

const allowed = [
  "rg -n --no-messages \"grep -rn x\" src",
  "git log --grep=fix",
  "git grep -n foo",
  "git -C repo grep -n foo",
  "fd -I name src",
  "git ls-files \"*name*\"",
  "Get-Content log | Select-String -Pattern err",
  "echo 'find .'",
  "node -e \"require('child_process').execSync('grep x')\"",
  "ls | where { $_ -match 'grep' }"
];
for (const command of allowed) {
  assert.equal(findBlockedCommand(command, blocked), null, `expected no hit: ${command}`);
}

assert.match(denialMessage("grep"), /dsh-search-guard/);
assert.match(denialMessage("grep"), /git -C <repo> ls-files/);
assert.equal(findBlockedCommand("", blocked), null, "empty command is ignored");
assert.equal(findBlockedCommand("grep x", []), null, "empty block list is ignored");

console.log("matcher tests passed");
