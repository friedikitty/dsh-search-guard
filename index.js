/**
 * dsh-search-guard: deny slow shell searches at the DSH tool layer.
 *
 * DeepSeek Harness has no declarative per-command deny list; its documented
 * hook for this is `ctx.tools.guard()`, a monotonic synchronous guard that
 * denies a tool call by returning a reason. This plugin therefore registers
 * one guard over the shell tools and rejects `grep` / `egrep` / `fgrep` /
 * `find` before the command reaches the sandbox (so no approval prompt is
 * raised either). `git grep` stays allowed on purpose: it searches Git's own
 * index and object store rather than walking the working tree.
 *
 * Replacements: `git ls-files`, `fd -I`, the Grep tool, and `rg` scoped to a
 * deep subdirectory.
 */
import { denialMessage, findBlockedCommand } from "./matcher.js";

export const name = "dsh-search-guard";

/** The tool registry must exist before the guard can be registered. */
export const inject = ["tools"];

/** Shell tools whose `command` argument is inspected. */
const DEFAULT_TOOLS = ["pwsh", "bash"];

/** Banned command basenames. */
const DEFAULT_BLOCKED = ["grep", "egrep", "fgrep", "find"];

const DEFAULT_CONFIG = {
  tools: DEFAULT_TOOLS,
  blocked: DEFAULT_BLOCKED,
};

function normalizeList(value, fallback) {
  return Array.isArray(value) && value.length > 0 ? value.map((item) => String(item)) : fallback;
}

export function apply(ctx, config) {
  const settings = { ...DEFAULT_CONFIG, ...(config ?? {}) };
  const tools = new Set(normalizeList(settings.tools, DEFAULT_TOOLS).map((item) => item.toLowerCase()));
  const blocked = new Set(normalizeList(settings.blocked, DEFAULT_BLOCKED).map((item) => item.toLowerCase()));

  if (typeof ctx?.tools?.guard !== "function") {
    // Never break profile boot: an older/newer DSH without the guard seam only
    // loses the enforcement, it does not fail to start.
    process.stderr.write("dsh-search-guard: ctx.tools.guard is unavailable; guard not registered\n");
    return;
  }

  ctx.tools.guard((execution) => {
    try {
      const toolName = String(execution?.name ?? "").toLowerCase();
      if (!tools.has(toolName)) return undefined;

      const args = execution?.arguments;
      if (!args || typeof args !== "object") return undefined;
      const command = typeof args.command === "string" ? args.command : "";
      if (!command) return undefined;

      const hit = findBlockedCommand(command, blocked);
      return hit === null ? undefined : denialMessage(hit);
    } catch {
      // A matcher bug must never block an unrelated tool call.
      return undefined;
    }
  });
}
