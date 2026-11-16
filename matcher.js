/**
 * Slow-search command matcher for the DSH search guard.
 *
 * A shell command is scanned token by token. A token is only treated as a
 * command when it sits in command position: the start of the string, right
 * after a pipeline/list separator (`|`, `||`, `&&`, `;`, newline), right after
 * `{`, `}`, `(` or `)`, or right after a control keyword. Arguments are never
 * matched, so `rg -n "grep -rn x" .`, `git log --grep=fix`, `git grep` and
 * here-strings that merely mention the banned tools stay allowed.
 *
 * The same first-token rule is used by shell-command audits, so the guard and
 * the audit agree on what counts as a slow search.
 */

/** Shell separators replaced by a marker token before scanning. */
const SEPARATOR = "\u0000SEP\u0000";

/** Tokens that end one command and do not themselves start one. */
const CONTROL_KEYWORDS = new Set([
  "if", "elseif", "else", "then", "do", "while", "until", "for", "foreach",
  "switch", "try", "catch", "finally", "begin", "process", "end", "function",
  "filter", "param", "return", "throw", "trap", "in",
]);

/** Commands that introduce a child command and whose own arguments must be skipped. */
const COMMAND_HINTS = new Set(["call", "invoke-expression", "iex", "start-process"]);

/** Normalize one raw token: quotes, PowerShell call operators, path, extension. */
function normalizeToken(raw) {
  let token = raw.replace(/^["'`]+|["'`]+$/g, "");
  token = token.replace(/^[&@]+/, "");
  if (!token) return "";
  const slash = Math.max(token.lastIndexOf("/"), token.lastIndexOf("\\"));
  if (slash >= 0) token = token.slice(slash + 1);
  token = token.replace(/\.exe$/i, "");
  return token;
}

function isAssignment(token) {
  return /^(\$[A-Za-z_][\w.:]*|[A-Za-z_][\w.]*)=/.test(token);
}

/**
 * Split one command string into tokens, replacing command separators with a
 * marker token. Quotes are honoured, so separators inside a pattern or a
 * quoted string (`rg "a|b"`, `node -e "...execSync('grep x')"`) stay data.
 *
 * @param {string} command - the raw shell command.
 * @returns {string[]} tokens, with {@link SEPARATOR} standing for `|`, `||`,
 *   `&&`, `;`, a newline, `{`, `}`, `(` or `)` seen outside quotes.
 */
function tokenize(command) {
  const text = String(command);
  const tokens = [];
  let current = "";
  let quote = "";

  const flush = () => {
    if (current) tokens.push(current);
    current = "";
  };
  const separate = () => {
    flush();
    tokens.push(SEPARATOR);
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      current += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "|") {
      if (text[i + 1] === "|") i += 1;
      separate();
      continue;
    }
    if (char === "&") {
      // `&&` ends a command; a single `&` is the PowerShell call operator.
      if (text[i + 1] === "&") {
        i += 1;
        separate();
        continue;
      }
      current += char;
      continue;
    }
    if (char === ";" || char === "\n" || char === "\r" || char === "{" || char === "}" || char === "(" || char === ")") {
      separate();
      continue;
    }
    if (char === " " || char === "\t") {
      flush();
      continue;
    }
    current += char;
  }
  flush();
  return tokens;
}

/**
 * Decide whether any command in `command` is a banned slow search.
 *
 * @param {string} command - the raw `command` argument of a shell tool call.
 * @param {Set<string>|string[]} blocked - banned command basenames (`grep`, `find`, ...).
 * @returns {string|null} the offending command as written (`grep`, `git grep`), or null.
 */
export function findBlockedCommand(command, blocked) {
  const banned = blocked instanceof Set ? blocked : new Set(blocked ?? []);
  if (typeof command !== "string" || !command.trim() || banned.size === 0) return null;

  const tokens = tokenize(command);
  let expectCommand = true;
  let pendingValue = 0;

  for (let i = 0; i < tokens.length; i += 1) {
    const raw = tokens[i];
    if (raw === SEPARATOR) {
      expectCommand = true;
      pendingValue = 0;
      continue;
    }
    if (pendingValue > 0) {
      pendingValue -= 1;
      continue;
    }
    if (!expectCommand) continue;

    if (isAssignment(raw)) continue;

    const lowered = raw.toLowerCase();
    if (CONTROL_KEYWORDS.has(lowered)) continue;

    if (lowered === "cd" || lowered === "set-location" || lowered === "pushd") {
      pendingValue = 1;
      continue;
    }
    if (COMMAND_HINTS.has(lowered)) {
      pendingValue = 1;
      continue;
    }

    const head = normalizeToken(raw).toLowerCase();
    if (!head) continue;

    if (banned.has(head)) return head;

    // `git grep` is deliberately NOT blocked: it searches Git's own index and
    // object store, and teams rely on it for history-scoped lookups. Only the
    // bare slow commands listed in `blocked` are denied.

    // The head is a normal command: the rest of this segment is its arguments.
    expectCommand = false;
  }

  return null;
}

/**
 * Build the model-facing denial text for one hit.
 *
 * @param {string} hit - the offending command name.
 * @returns {string} routed guidance the agent can act on immediately.
 */
export function denialMessage(hit) {
  return (
    `Blocked by dsh-search-guard: \`${hit}\` is banned for agent shell calls. Route instead: ` +
    "filenames -> `git -C <repo> ls-files \"*NAME*\"` or `fd -I NAME <dir>`; " +
    "content -> the Grep tool, `git grep` (allowed), or " +
    "`rg -n --no-messages \"PAT\" <deepest subdir>` (prefer the deepest subdir over the repo root); " +
    "small pipes and single files -> `rg -c` or `Select-String -Path <file>`."
  );
}
