# dsh-search-guard

A DeepSeek Harness (DSH) bundle that **denies slow shell searches** instead of
asking the agent to avoid them: `grep`, `egrep`, `fgrep` and `find` are rejected
by a tool guard before the command reaches the sandbox, so the call never runs
and no approval prompt is raised. `git grep` is allowed on purpose: it searches
Git's index and object store instead of walking the working tree.

## Why a plugin

DSH has no declarative per-command deny list. Its documented policy seam is
`ctx.tools.guard()` (`@deepseek-ai/dsh-tools`): a monotonic synchronous guard
whose return value denies the call with a model-facing reason. A bundle is the
unit that mounts it: this package declares `dsh.bundle.patch`, its
`cordis.patch.yml` inserts the guard at the profile root, and the profile's
`dsh.profile.bundles` list is what makes DSH load it at boot.

## What it denies, and what it does not

The matcher (`matcher.js`) uses a **first-token rule**: a command is split on
`|`, `||`, `&&`, `;` and newlines (quotes are honoured), a segment's leading
`&`, variable assignments, `cd <path>` and control keywords are skipped, and
only a `grep` / `find` (or `git [opts] grep`) sitting in command position
counts.

* Denied: `grep -rn x .`, `Get-ChildItem | grep x`,
  `cd src; find . -name "*.ts"`, `if ($x) { grep foo }`.
* Allowed: `rg -n --no-messages "grep -rn x" src`, `git log --grep=fix`,
  `fd -I name src`, `git ls-files "*name*"`,
  `Get-Content log | Select-String -Pattern err`, here-strings and quoted
  mentions.
* Out of scope: recursive `Select-String` tree scans, PTC `run_code`,
  `cmd /c grep`, `Start-Process`, and shell tools provided by MCP servers.

The denial text routes the agent to faster paths (`git ls-files`, `fd -I`, the
Grep tool, `rg` scoped to the deepest subdirectory, `rg -c` / `Select-String`
for small pipes).

## Install / verify

Install this package into a DSH profile from GitHub:

```powershell
dsh plugin --profile <name> add github:friedikitty/dsh-search-guard#v0.1.0
dsh --profile <name> --dump-config | Select-String search-guard
```

The package is a DSH bundle; `dsh plugin add` records it in the profile's
`dependencies` and `dsh.profile.bundles`, and the loader applies its
`cordis.patch.yml` at boot. The guard registers at boot, so **restart DSH (or
start a new session)** before expecting a denial; sessions that were already
running keep their old tool pipeline.

To remove it:

```powershell
dsh plugin --profile <name> remove dsh-search-guard
```

## Configuration

Override in the profile's `cordis.patch.yml` (the profile layer is applied
after bundle layers):

```yaml
- id: search-guard
  config:
    blocked: [grep, egrep, fgrep, find]   # default
    tools: [pwsh, bash]                   # default
```

## Tests

```powershell
npm test
# or run the files directly:
node test/matcher.test.mjs
node test/guard.test.mjs
```

The runner uses plain `node:test` and exits non-zero on the first failure. Run
the files directly when `node --test test/` cannot spawn child processes in a
confined shell.
