/**
 * Regex tester engine — pure and runnable in a Web Worker. Uses the
 * JavaScript (ECMAScript) regular-expression engine of the host, so what you
 * see is exactly what `new RegExp(pattern, flags)` does in a browser or Node.
 */

export const FLAGS: { flag: string; label: string; hint: string }[] = [
  { flag: "g", label: "global", hint: "Find every match instead of stopping at the first." },
  { flag: "i", label: "ignore case", hint: "Case-insensitive matching." },
  { flag: "m", label: "multiline", hint: "^ and $ match at line starts and ends, not only the text's." },
  { flag: "s", label: "dot all", hint: ". also matches line breaks." },
  { flag: "u", label: "unicode", hint: "Full Unicode: \\u{…} escapes, astral characters as one unit, \\p{…} classes." },
  { flag: "v", label: "unicode sets", hint: "Like u plus set operations in classes ([\\p{L}--[a-z]]) and string properties." },
  { flag: "y", label: "sticky", hint: "Match only at lastIndex — from the start of the text here." },
  { flag: "d", label: "indices", hint: "Record the start and end of every capture group." },
];

export interface GroupMatch {
  /** Group number (1-based) or name. */
  key: string;
  value: string | undefined;
  /** Start/end when the d flag is set. */
  start?: number;
  end?: number;
}

export interface Match {
  index: number;
  end: number;
  text: string;
  groups: GroupMatch[];
}

export interface RegexResult {
  ok: true;
  matches: Match[];
  /** True when more matches existed than `limit`. */
  truncated: boolean;
  /** Text with matches replaced, when a replacement was requested. */
  replaced?: string;
  /** Names of the pattern's named groups, in order. */
  groupNames: string[];
  groupCount: number;
  ms: number;
}

export interface RegexError {
  ok: false;
  error: string;
}

export function validateFlags(flags: string): string | null {
  const seen = new Set<string>();
  for (const f of flags) {
    if (!FLAGS.some((x) => x.flag === f)) return `Unknown flag "${f}".`;
    if (seen.has(f)) return `Flag "${f}" is repeated.`;
    seen.add(f);
  }
  if (seen.has("u") && seen.has("v")) return "Flags u and v can't be combined.";
  return null;
}

/** Number of capture groups and their names, from a compiled RegExp. */
export function inspectGroups(re: RegExp): { count: number; names: string[] } {
  // Match the empty string against a pattern that always succeeds to read the group layout.
  const probe = new RegExp(`(?:${re.source})|`, re.flags.replace(/[gy]/g, ""));
  const m = probe.exec("");
  const count = m ? m.length - 1 : 0;
  const names = m?.groups ? Object.keys(m.groups) : [];
  return { count, names };
}

export function runRegex(
  pattern: string,
  flags: string,
  text: string,
  replacement: string | null = null,
  limit = 5000,
): RegexResult | RegexError {
  const flagError = validateFlags(flags);
  if (flagError) return { ok: false, error: flagError };
  let re: RegExp;
  try {
    re = new RegExp(pattern, flags);
  } catch (e) {
    return { ok: false, error: (e instanceof Error ? e.message : String(e)).replace(/^Invalid regular expression: /, "") };
  }
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  const { count: groupCount, names: groupNames } = inspectGroups(re);
  const matches: Match[] = [];
  let truncated = false;
  const hasIndices = flags.includes("d");

  const toMatch = (m: RegExpExecArray): Match => {
    const groups: GroupMatch[] = [];
    const indices = hasIndices ? (m as RegExpExecArray & { indices?: Array<[number, number] | undefined> & { groups?: Record<string, [number, number] | undefined> } }).indices : undefined;
    for (let g = 1; g < m.length; g++) {
      const span = indices?.[g];
      groups.push({ key: String(g), value: m[g], start: span?.[0], end: span?.[1] });
    }
    if (m.groups) {
      for (const [name, value] of Object.entries(m.groups)) {
        const span = indices?.groups?.[name];
        groups.push({ key: name, value, start: span?.[0], end: span?.[1] });
      }
    }
    return { index: m.index, end: m.index + m[0].length, text: m[0], groups };
  };

  if (re.global || re.sticky) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      matches.push(toMatch(m));
      if (m[0] === "") re.lastIndex += text.codePointAt(re.lastIndex) !== undefined && text.codePointAt(re.lastIndex)! > 0xffff ? 2 : 1;
      if (matches.length >= limit) {
        truncated = re.exec(text) !== null;
        break;
      }
      if (re.sticky && !re.global) break;
    }
  } else {
    const m = re.exec(text);
    if (m) matches.push(toMatch(m));
  }

  let replaced: string | undefined;
  if (replacement !== null) {
    try {
      replaced = text.replace(re, replacement);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  const ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - started;
  return { ok: true, matches, truncated, replaced, groupNames, groupCount, ms };
}

/** JavaScript literal for the pattern, e.g. /a\/b/gi. */
export function toLiteral(pattern: string, flags: string): string {
  return `/${pattern.replace(/(?<!\\)\//g, "\\/")}/${flags}`;
}

export const CHEATSHEET: { group: string; items: [string, string][] }[] = [
  {
    group: "Characters",
    items: [
      [".", "any character except newline (s: including)"],
      ["\\d \\w \\s", "digit · word char [A-Za-z0-9_] · whitespace"],
      ["\\D \\W \\S", "not digit · not word · not whitespace"],
      ["\\b \\B", "word boundary · not a boundary"],
      ["\\t \\n \\r", "tab · newline · carriage return"],
      ["\\u{1F600}", "code point (needs u or v)"],
      ["\\p{L} \\p{Script=Greek}", "Unicode property (needs u or v)"],
    ],
  },
  {
    group: "Classes",
    items: [
      ["[abc] [^abc]", "one of · none of"],
      ["[a-z0-9]", "range"],
      ["[\\p{L}--[a-z]]", "set difference (v flag)"],
    ],
  },
  {
    group: "Quantifiers",
    items: [
      ["* + ?", "0 or more · 1 or more · 0 or 1"],
      ["{3} {2,} {2,5}", "exactly · at least · between"],
      ["*? +? ??", "lazy (shortest) versions"],
    ],
  },
  {
    group: "Groups",
    items: [
      ["(abc)", "capture group, $1"],
      ["(?<name>abc)", "named group, $<name> / \\k<name>"],
      ["(?:abc)", "non-capturing group"],
      ["\\1", "back-reference to group 1"],
      ["a|b", "alternation"],
    ],
  },
  {
    group: "Anchors & lookaround",
    items: [
      ["^ $", "start · end (of line with m)"],
      ["(?=x) (?!x)", "lookahead · negative lookahead"],
      ["(?<=x) (?<!x)", "lookbehind · negative lookbehind"],
    ],
  },
  {
    group: "Replacement",
    items: [
      ["$1 $<name>", "group by number · by name"],
      ["$& $` $'", "whole match · text before · text after"],
      ["$$", "a literal dollar sign"],
    ],
  },
];
