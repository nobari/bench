/**
 * Code editor — the pure half. The language catalogue (what the editor can highlight, which file extensions
 * mean what, which formatter and checker apply), detection from a file name or the text itself, formatting
 * through Prettier (loaded on demand, one plugin set per language) or sql-formatter, and syntax checking
 * through the same parsers. The editor component adds CodeMirror and the parse-tree checks on top.
 */

export interface PrettierSpec {
  parser: string;
  /** Plugin module names under prettier/plugins. */
  plugins: ("babel" | "estree" | "typescript" | "postcss" | "html" | "markdown" | "yaml" | "graphql" | "glimmer" | "angular")[];
}

export interface CodeLanguage {
  /** Stable id, used in the URL (`l`) and in downloads. */
  id: string;
  name: string;
  /** The @codemirror/language-data name to load; null for plain text. */
  cm: string | null;
  /** File extensions, the first one used for downloads. */
  extensions: string[];
  /** Exact file names that mean this language (Dockerfile, Makefile…). */
  filenames?: string[];
  prettier?: PrettierSpec;
  /** sql-formatter dialect. */
  sql?: string;
  /** A built-in check that needs no parser package. */
  check?: "json" | "xml";
}

const JS: PrettierSpec = { parser: "babel", plugins: ["babel", "estree"] };
const TS: PrettierSpec = { parser: "typescript", plugins: ["typescript", "estree"] };

export const LANGUAGES: CodeLanguage[] = [
  { id: "text", name: "Plain text", cm: null, extensions: ["txt"] },
  { id: "javascript", name: "JavaScript", cm: "JavaScript", extensions: ["js", "mjs", "cjs"], prettier: JS },
  { id: "jsx", name: "JSX", cm: "JSX", extensions: ["jsx"], prettier: JS },
  { id: "typescript", name: "TypeScript", cm: "TypeScript", extensions: ["ts", "mts", "cts"], prettier: TS },
  { id: "tsx", name: "TSX", cm: "TSX", extensions: ["tsx"], prettier: TS },
  { id: "json", name: "JSON", cm: "JSON", extensions: ["json", "map", "jsonc", "json5"], prettier: { parser: "json", plugins: ["babel", "estree"] }, check: "json" },
  { id: "html", name: "HTML", cm: "HTML", extensions: ["html", "htm", "xhtml"], prettier: { parser: "html", plugins: ["html", "postcss", "babel", "estree"] } },
  { id: "vue", name: "Vue", cm: "Vue", extensions: ["vue"], prettier: { parser: "vue", plugins: ["html", "postcss", "babel", "estree", "typescript"] } },
  { id: "angular", name: "Angular template", cm: "Angular Template", extensions: ["component.html"], prettier: { parser: "angular", plugins: ["html", "angular", "postcss", "babel", "estree"] } },
  { id: "handlebars", name: "Handlebars", cm: "HTML", extensions: ["hbs", "handlebars"], prettier: { parser: "glimmer", plugins: ["glimmer"] } },
  { id: "css", name: "CSS", cm: "CSS", extensions: ["css"], prettier: { parser: "css", plugins: ["postcss"] } },
  { id: "scss", name: "SCSS", cm: "SCSS", extensions: ["scss"], prettier: { parser: "scss", plugins: ["postcss"] } },
  { id: "less", name: "Less", cm: "LESS", extensions: ["less"], prettier: { parser: "less", plugins: ["postcss"] } },
  { id: "sass", name: "Sass", cm: "Sass", extensions: ["sass"] },
  { id: "stylus", name: "Stylus", cm: "Stylus", extensions: ["styl"] },
  { id: "markdown", name: "Markdown", cm: "Markdown", extensions: ["md", "markdown", "mkd"], prettier: { parser: "markdown", plugins: ["markdown", "babel", "estree", "postcss", "html", "yaml"] } },
  { id: "mdx", name: "MDX", cm: "Markdown", extensions: ["mdx"], prettier: { parser: "mdx", plugins: ["markdown", "babel", "estree"] } },
  { id: "yaml", name: "YAML", cm: "YAML", extensions: ["yaml", "yml"], prettier: { parser: "yaml", plugins: ["yaml"] } },
  { id: "toml", name: "TOML", cm: "TOML", extensions: ["toml"] },
  { id: "xml", name: "XML", cm: "XML", extensions: ["xml", "xsl", "xsd", "svg", "rss", "wsdl", "plist"], check: "xml" },
  { id: "graphql", name: "GraphQL", cm: null, extensions: ["graphql", "gql"], prettier: { parser: "graphql", plugins: ["graphql"] } },
  { id: "sql", name: "SQL", cm: "SQL", extensions: ["sql"], sql: "sql" },
  { id: "mysql", name: "MySQL", cm: "MySQL", extensions: ["mysql"], sql: "mysql" },
  { id: "mariadb", name: "MariaDB SQL", cm: "MariaDB SQL", extensions: [], sql: "mariadb" },
  { id: "postgresql", name: "PostgreSQL", cm: "PostgreSQL", extensions: ["pgsql", "psql"], sql: "postgresql" },
  { id: "sqlite", name: "SQLite", cm: "SQLite", extensions: ["sqlite"], sql: "sqlite" },
  { id: "tsql", name: "T-SQL (SQL Server)", cm: "MS SQL", extensions: ["tsql"], sql: "transactsql" },
  { id: "plsql", name: "PL/SQL (Oracle)", cm: "PLSQL", extensions: ["pls", "plsql"], sql: "plsql" },
  { id: "bigquery", name: "BigQuery SQL", cm: "SQL", extensions: [], sql: "bigquery" },
  { id: "python", name: "Python", cm: "Python", extensions: ["py", "pyw", "pyi"] },
  { id: "go", name: "Go", cm: "Go", extensions: ["go"] },
  { id: "rust", name: "Rust", cm: "Rust", extensions: ["rs"] },
  { id: "java", name: "Java", cm: "Java", extensions: ["java"] },
  { id: "kotlin", name: "Kotlin", cm: "Kotlin", extensions: ["kt", "kts"] },
  { id: "swift", name: "Swift", cm: "Swift", extensions: ["swift"] },
  { id: "c", name: "C", cm: "C", extensions: ["c", "h"] },
  { id: "cpp", name: "C++", cm: "C++", extensions: ["cpp", "cc", "cxx", "hpp", "hh", "hxx", "ino"] },
  { id: "csharp", name: "C#", cm: "C#", extensions: ["cs"] },
  { id: "objectivec", name: "Objective-C", cm: "Objective-C", extensions: ["m", "mm"] },
  { id: "php", name: "PHP", cm: "PHP", extensions: ["php", "phtml"] },
  { id: "ruby", name: "Ruby", cm: "Ruby", extensions: ["rb", "rake", "gemspec"], filenames: ["Gemfile", "Rakefile"] },
  { id: "perl", name: "Perl", cm: "Perl", extensions: ["pl", "pm"] },
  { id: "lua", name: "Lua", cm: "Lua", extensions: ["lua"] },
  { id: "r", name: "R", cm: "R", extensions: ["r", "R"] },
  { id: "julia", name: "Julia", cm: "Julia", extensions: ["jl"] },
  { id: "dart", name: "Dart", cm: "Dart", extensions: ["dart"] },
  { id: "scala", name: "Scala", cm: "Scala", extensions: ["scala", "sc"] },
  { id: "groovy", name: "Groovy", cm: "Groovy", extensions: ["groovy", "gradle"] },
  { id: "haskell", name: "Haskell", cm: "Haskell", extensions: ["hs"] },
  { id: "elm", name: "Elm", cm: "Elm", extensions: ["elm"] },
  { id: "erlang", name: "Erlang", cm: "Erlang", extensions: ["erl", "hrl"] },
  { id: "clojure", name: "Clojure", cm: "Clojure", extensions: ["clj", "cljs", "cljc", "edn"] },
  { id: "ocaml", name: "OCaml", cm: "OCaml", extensions: ["ml", "mli"] },
  { id: "fsharp", name: "F#", cm: "F#", extensions: ["fs", "fsx"] },
  { id: "shell", name: "Shell", cm: "Shell", extensions: ["sh", "bash", "zsh", "ksh"], filenames: [".bashrc", ".zshrc", ".profile"] },
  { id: "powershell", name: "PowerShell", cm: "PowerShell", extensions: ["ps1", "psm1", "psd1"] },
  { id: "dockerfile", name: "Dockerfile", cm: "Dockerfile", extensions: ["dockerfile"], filenames: ["Dockerfile", "Containerfile"] },
  { id: "makefile", name: "Makefile", cm: null, extensions: ["mk"], filenames: ["Makefile", "makefile", "GNUmakefile"] },
  { id: "cmake", name: "CMake", cm: "CMake", extensions: ["cmake"], filenames: ["CMakeLists.txt"] },
  { id: "nginx", name: "Nginx", cm: "Nginx", extensions: [], filenames: ["nginx.conf"] },
  { id: "ini", name: "INI / properties", cm: "Properties files", extensions: ["ini", "properties", "cfg", "conf", "env"], filenames: [".env", ".gitconfig", ".editorconfig"] },
  { id: "protobuf", name: "Protocol Buffers", cm: "ProtoBuf", extensions: ["proto"] },
  { id: "diff", name: "Diff / patch", cm: "diff", extensions: ["diff", "patch"] },
  { id: "latex", name: "LaTeX", cm: "LaTeX", extensions: ["tex", "ltx", "sty"] },
  { id: "wasm", name: "WebAssembly text", cm: "WebAssembly", extensions: ["wat", "wast"] },
  { id: "liquid", name: "Liquid", cm: "Liquid", extensions: ["liquid"] },
  { id: "jinja", name: "Jinja", cm: "Jinja", extensions: ["j2", "jinja", "jinja2"] },
  { id: "pug", name: "Pug", cm: "Pug", extensions: ["pug", "jade"] },
  { id: "coffeescript", name: "CoffeeScript", cm: "CoffeeScript", extensions: ["coffee"] },
  { id: "verilog", name: "Verilog", cm: "Verilog", extensions: ["v", "sv"] },
  { id: "vhdl", name: "VHDL", cm: "VHDL", extensions: ["vhd", "vhdl"] },
  { id: "fortran", name: "Fortran", cm: "Fortran", extensions: ["f90", "f95", "f03", "f", "for"] },
  { id: "pascal", name: "Pascal", cm: "Pascal", extensions: ["pas", "pp"] },
  { id: "cobol", name: "COBOL", cm: "Cobol", extensions: ["cob", "cbl"] },
  { id: "tcl", name: "Tcl", cm: "Tcl", extensions: ["tcl"] },
  { id: "scheme", name: "Scheme", cm: "Scheme", extensions: ["scm", "ss"] },
  { id: "lisp", name: "Common Lisp", cm: "Common Lisp", extensions: ["lisp", "cl", "el"] },
  { id: "smalltalk", name: "Smalltalk", cm: "Smalltalk", extensions: ["st"] },
  { id: "crystal", name: "Crystal", cm: "Crystal", extensions: ["cr"] },
  { id: "d", name: "D", cm: "D", extensions: ["d"] },
  { id: "nim", name: "Nim", cm: null, extensions: ["nim"] },
  { id: "zig", name: "Zig", cm: null, extensions: ["zig"] },
  { id: "solidity", name: "Solidity", cm: null, extensions: ["sol"] },
  { id: "cypher", name: "Cypher", cm: "Cypher", extensions: ["cypher", "cyp"] },
  { id: "sparql", name: "SPARQL", cm: "SPARQL", extensions: ["rq", "sparql"] },
  { id: "turtle", name: "Turtle", cm: "Turtle", extensions: ["ttl"] },
  { id: "gherkin", name: "Gherkin", cm: "Gherkin", extensions: ["feature"] },
  { id: "http", name: "HTTP", cm: "HTTP", extensions: ["http"] },
  { id: "textile", name: "Textile", cm: "Textile", extensions: ["textile"] },
  { id: "vb", name: "VB.NET", cm: "VB.NET", extensions: ["vb"] },
  { id: "octave", name: "Octave / MATLAB", cm: "Octave", extensions: ["m"] },
  { id: "apl", name: "APL", cm: "APL", extensions: ["apl"] },
  { id: "brainfuck", name: "Brainfuck", cm: "Brainfuck", extensions: ["bf"] },
];

const byId = new Map(LANGUAGES.map((l) => [l.id, l]));
export const DEFAULT_LANGUAGE = "javascript";
export function getLanguage(id: string | null | undefined): CodeLanguage {
  return (id && byId.get(id)) || byId.get("text")!;
}
export const isLanguageId = (id: string): boolean => byId.has(id);

/** Languages with a formatter, for the help text. */
export const FORMATTABLE = LANGUAGES.filter((l) => l.prettier || l.sql).map((l) => l.name);

/* ------------------------------------------------------------------ detection */

/** The language a file name implies (exact names first, then the longest matching extension), or null. */
export function languageForFilename(name: string): CodeLanguage | null {
  const base = name.split(/[\\/]/).pop() ?? name;
  for (const l of LANGUAGES) if (l.filenames?.some((f) => f.toLowerCase() === base.toLowerCase())) return l;
  const lower = base.toLowerCase();
  let best: { l: CodeLanguage; len: number } | null = null;
  for (const l of LANGUAGES) {
    for (const ext of l.extensions) {
      const e = ext.toLowerCase();
      if ((lower.endsWith("." + e) || lower === e) && (!best || e.length > best.len)) best = { l, len: e.length };
    }
  }
  return best?.l ?? null;
}

/**
 * A guess at the language from the text alone: shebangs and unmistakable openings first, then a few telling
 * tokens. Returns null when nothing stands out, so the caller keeps the current choice.
 */
export function guessLanguage(text: string): CodeLanguage | null {
  const head = text.slice(0, 4000);
  const first = head.split("\n", 1)[0] ?? "";
  const shebang = first.match(/^#!\s*(?:\/usr\/bin\/env\s+)?\S*?([\w.]+)\s*$/);
  if (shebang) {
    const bin = shebang[1].toLowerCase();
    if (/^(ba|z|k|da)?sh$/.test(bin)) return byId.get("shell")!;
    if (/^python/.test(bin)) return byId.get("python")!;
    if (/^node|^deno|^bun$/.test(bin)) return byId.get("javascript")!;
    if (/^ruby/.test(bin)) return byId.get("ruby")!;
    if (/^perl/.test(bin)) return byId.get("perl")!;
    if (/^php/.test(bin)) return byId.get("php")!;
    if (/^lua/.test(bin)) return byId.get("lua")!;
  }
  const t = head.trimStart();
  if (/^<\?php/.test(t)) return byId.get("php")!;
  if (/^<!doctype html/i.test(t) || /^<html[\s>]/i.test(t)) return byId.get("html")!;
  if (/^<\?xml/.test(t) || /^<svg[\s>]/.test(t)) return byId.get("xml")!;
  if (/^[{[]/.test(t)) {
    try {
      JSON.parse(text);
      return byId.get("json")!;
    } catch {
      /* not JSON */
    }
  }
  if (/^---\n|^%YAML/.test(t) || /^[\w-]+:\s*(\S.*)?\n\s+[\w-]+:/.test(t)) return byId.get("yaml")!;
  if (/^(FROM|ARG)\s+\S+/m.test(t) && /^(RUN|CMD|COPY|ENTRYPOINT)\s/m.test(t)) return byId.get("dockerfile")!;
  if (/^\s*(SELECT|INSERT\s+INTO|CREATE\s+TABLE|UPDATE|DELETE\s+FROM|WITH\s+\w+\s+AS)\b/im.test(t) && /\b(FROM|VALUES|SET|WHERE)\b/i.test(t)) return byId.get("sql")!;
  if (/^(package\s+\w+|import\s+\(|func\s+\w+\()/m.test(t) && /\bfunc\b/.test(t)) return byId.get("go")!;
  if (/\bfn\s+\w+\s*\(|\blet\s+mut\b|\bimpl\b|\buse\s+std::/.test(t)) return byId.get("rust")!;
  if (/^\s*(def|class)\s+\w+.*:\s*$/m.test(t) || /^\s*(import\s+\w+|from\s+\w+\s+import)\s/m.test(t)) return byId.get("python")!;
  if (/^\s*(public|private)\s+(static\s+)?(class|void|int|String)\b/m.test(t) || /System\.out\.println/.test(t)) return byId.get("java")!;
  if (/^#include\s*[<"]/m.test(t)) return /\b(std::|class\s+\w+|template\s*<)/.test(t) ? byId.get("cpp")! : byId.get("c")!;
  if (/^\s*using\s+System|namespace\s+\w+\s*[{;]|Console\.WriteLine/m.test(t)) return byId.get("csharp")!;
  if (/^\s*(interface|type)\s+\w+(<[^>]*>)?\s*(=|\{)|:\s*(string|number|boolean)\b|\bas\s+const\b/m.test(t)) return /<\w+[^>]*>[\s\S]*<\/\w+>|<\/?[A-Z]\w*/.test(t) ? byId.get("tsx")! : byId.get("typescript")!;
  if (/^\s*(import\s.*from\s+['"]|export\s+(default|const|function)|const\s+\w+\s*=\s*require\()/m.test(t) || /\bfunction\s*\w*\s*\(|=>\s*[{(]/.test(t)) return /<\/?[A-Z]\w*|<\w+\s+\w+=/.test(t) ? byId.get("jsx")! : byId.get("javascript")!;
  if (/^[.#]?[\w-]+(\s*[,>+~]\s*[.#]?[\w-]+)*\s*\{[^}]*:[^}]*\}/m.test(t) && !/[;{}]\s*(function|var|let|const)\b/.test(t)) return byId.get("css")!;
  if (/^\s*#{1,6}\s+\S|^\s*[-*]\s+\S.*\n\s*[-*]\s+\S|\[[^\]]+\]\([^)]+\)/m.test(t)) return byId.get("markdown")!;
  if (/^\s*<[a-z][\w-]*[^>]*>/m.test(t) && /<\/[a-z][\w-]*>/.test(t)) return byId.get("html")!;
  return null;
}

/* ------------------------------------------------------------------ formatting */

export interface FormatOptions {
  printWidth: number;
  tabWidth: number;
  useTabs: boolean;
}

export interface Problem {
  /** 1-based. */
  line: number;
  column: number;
  message: string;
  source: "parser" | "json" | "xml" | "sql";
  /** Lines of the range when known (1-based, inclusive). */
  endLine?: number;
  endColumn?: number;
}

export type FormatResult = { ok: true; text: string; changed: boolean } | { ok: false; unsupported?: boolean; error: string; problem?: Problem };

type PrettierPlugin = unknown;
const pluginLoaders: Record<PrettierSpec["plugins"][number], () => Promise<PrettierPlugin>> = {
  babel: () => import("prettier/plugins/babel"),
  estree: () => import("prettier/plugins/estree"),
  typescript: () => import("prettier/plugins/typescript"),
  postcss: () => import("prettier/plugins/postcss"),
  html: () => import("prettier/plugins/html"),
  markdown: () => import("prettier/plugins/markdown"),
  yaml: () => import("prettier/plugins/yaml"),
  graphql: () => import("prettier/plugins/graphql"),
  glimmer: () => import("prettier/plugins/glimmer"),
  angular: () => import("prettier/plugins/angular"),
};
const loadedPlugins = new Map<string, Promise<PrettierPlugin>>();
const loadPlugin = (name: PrettierSpec["plugins"][number]) => {
  let p = loadedPlugins.get(name);
  if (!p) {
    p = pluginLoaders[name]();
    loadedPlugins.set(name, p);
  }
  return p;
};
let prettierModule: Promise<typeof import("prettier/standalone")> | null = null;
const loadPrettier = () => (prettierModule ??= import("prettier/standalone"));

/** Prettier's own error location, when it is a syntax error. */
function prettierProblem(e: unknown): Problem | undefined {
  const err = e as { loc?: { start?: { line?: number; column?: number }; end?: { line?: number; column?: number } }; message?: string; cause?: { loc?: { start?: { line?: number; column?: number } } } };
  const loc = err?.loc?.start ?? err?.cause?.loc?.start;
  if (!loc || typeof loc.line !== "number") return undefined;
  // Prettier reports 1-based columns and ends the first line with "(line:column)".
  const message = (err.message ?? "Syntax error").split("\n")[0].replace(/\s*\(\d+:\d+\)\s*$/, "").trim() || "Syntax error";
  return { line: loc.line, column: Math.max(1, loc.column ?? 1), message, source: "parser", endLine: err.loc?.end?.line, endColumn: err.loc?.end?.column };
}

/** Formats `text` as `language`; a parse error comes back as a problem with its position. */
export async function formatCode(text: string, language: CodeLanguage, opts: FormatOptions): Promise<FormatResult> {
  if (language.sql) {
    try {
      const { format } = await import("sql-formatter");
      const out = format(text, { language: language.sql as never, tabWidth: opts.tabWidth, useTabs: opts.useTabs, keywordCase: "upper", linesBetweenQueries: 2 });
      const next = out.endsWith("\n") ? out : out + "\n";
      return { ok: true, text: next, changed: next !== text };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), problem: sqlProblem(e, text) };
    }
  }
  if (!language.prettier) return { ok: false, unsupported: true, error: `No formatter for ${language.name} yet.` };
  try {
    const [prettier, ...plugins] = await Promise.all([loadPrettier(), ...language.prettier.plugins.map(loadPlugin)]);
    const out = await prettier.format(text, { parser: language.prettier.parser, plugins: plugins as never[], printWidth: opts.printWidth, tabWidth: opts.tabWidth, useTabs: opts.useTabs });
    return { ok: true, text: out, changed: out !== text };
  } catch (e) {
    const problem = prettierProblem(e);
    return { ok: false, error: problem ? `${problem.message} (line ${problem.line}, column ${problem.column})` : e instanceof Error ? e.message.split("\n")[0] : String(e), problem };
  }
}

function sqlProblem(e: unknown, text: string): Problem | undefined {
  const msg = e instanceof Error ? e.message : String(e);
  const m = msg.match(/at line (\d+) column (\d+)/i) ?? msg.match(/position (\d+)/i);
  if (!m) return undefined;
  if (m.length === 3) return { line: Number(m[1]), column: Number(m[2]), message: msg.split("\n")[0], source: "sql" };
  const pos = Number(m[1]);
  const before = text.slice(0, pos);
  return { line: before.split("\n").length, column: pos - before.lastIndexOf("\n"), message: msg.split("\n")[0], source: "sql" };
}

/* ------------------------------------------------------------------ checking */

export type CheckResult = { checked: true; problems: Problem[] } | { checked: false; reason: string };

/**
 * The first error in a JSON text, found by a small scanner of our own: browsers word JSON.parse's message
 * differently and newer ones give no position at all, so the position is worked out here.
 */
export function scanJson(text: string): { offset: number; message: string } | null {
  let i = 0;
  const n = text.length;
  const ws = () => {
    while (i < n && (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r")) i++;
  };
  const fail = (message: string, at = i): never => {
    throw { offset: Math.min(at, n), message };
  };
  const value = (): void => {
    ws();
    if (i >= n) fail("Unexpected end of input, a value was expected");
    const c = text[i];
    if (c === "{") {
      i++;
      ws();
      if (text[i] === "}") return void i++;
      for (;;) {
        ws();
        if (text[i] === "'") fail("Strings must use double quotes");
        if (text[i] !== '"') fail(i >= n ? "Unexpected end of input inside an object" : `Expected a quoted property name, found “${text[i]}”`);
        string();
        ws();
        if (text[i] !== ":") fail(i >= n ? "Unexpected end of input, “:” was expected" : `Expected “:” after the property name, found “${text[i]}”`);
        i++;
        value();
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "}") return void i++;
        fail(i >= n ? "Unexpected end of input, “}” was expected" : `Expected “,” or “}” after a property, found “${text[i]}”`);
      }
    }
    if (c === "[") {
      i++;
      ws();
      if (text[i] === "]") return void i++;
      for (;;) {
        value();
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "]") return void i++;
        fail(i >= n ? "Unexpected end of input, “]” was expected" : `Expected “,” or “]” after an item, found “${text[i]}”`);
      }
    }
    if (c === '"') return string();
    if (c === "t" || c === "f" || c === "n") {
      const word = c === "t" ? "true" : c === "f" ? "false" : "null";
      if (text.startsWith(word, i)) return void (i += word.length);
      fail(`Unexpected “${text.slice(i, i + word.length)}”, did you mean ${word}?`);
    }
    if (c === "-" || (c >= "0" && c <= "9")) {
      const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i, i + 64));
      if (!m) fail("Malformed number");
      i += m![0].length;
      if (/[\d.]/.test(text[i] ?? "")) fail("Malformed number (leading zeros and trailing dots are not allowed)");
      return;
    }
    if (c === "'") fail("Strings must use double quotes");
    fail(`Unexpected “${c}”`);
  };
  const string = (): void => {
    i++; // opening quote
    for (;;) {
      if (i >= n) fail("Unterminated string");
      const c = text[i];
      if (c === '"') return void i++;
      if (c === "\\") {
        const e = text[i + 1];
        if (e === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) fail("Bad unicode escape", i);
          i += 6;
          continue;
        }
        if (!e || !'"\\/bfnrt'.includes(e)) fail(`Bad escape “\\${e ?? ""}”`, i);
        i += 2;
        continue;
      }
      if (c === "\n") fail("Unterminated string (newline inside a string)");
      if (c < " ") fail("Control character inside a string");
      i++;
    }
  };
  try {
    value();
    ws();
    if (i < n) fail(`Unexpected “${text[i]}” after the end of the value`);
    return null;
  } catch (e) {
    return e as { offset: number; message: string };
  }
}

/** The JSON text's first problem as a line and column, or null when it parses. */
export function jsonProblem(text: string): Problem | null {
  const err = scanJson(text);
  if (!err) return null;
  const before = text.slice(0, err.offset);
  return { line: before.split("\n").length, column: err.offset - before.lastIndexOf("\n"), message: err.message, source: "json" };
}

/** The browser's XML parser error, located from its message when it says where. */
export function xmlProblem(text: string): Problem | null {
  if (typeof DOMParser === "undefined") return null;
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const err = doc.querySelector("parsererror");
  if (!err) return null;
  const raw = err.textContent ?? "XML is not well-formed";
  const m = raw.match(/line\s*(?:number)?\s*:?\s*(\d+)[^0-9]+(?:column|col)\s*:?\s*(\d+)/i) ?? raw.match(/line (\d+)/i);
  const message = raw.replace(/^This page contains the following errors:\s*/i, "").replace(/Below is a rendering.*$/i, "").replace(/\s+/g, " ").trim();
  return { line: m ? Number(m[1]) : 1, column: m && m.length === 3 ? Number(m[2]) : 1, message: message.replace(/^error on line \d+ at column \d+:\s*/i, "") || "XML is not well-formed", source: "xml" };
}

/**
 * Syntax check through the strictest parser available: JSON.parse, the XML parser, Prettier's parser for the
 * language, or sql-formatter's tokenizer. Languages with none of those are checked by the editor's own parse
 * tree instead (see the component), and `checked: false` says so.
 */
export async function checkSyntax(text: string, language: CodeLanguage): Promise<CheckResult> {
  if (!text.trim()) return { checked: true, problems: [] };
  if (language.check === "json") {
    const p = jsonProblem(text);
    return { checked: true, problems: p ? [p] : [] };
  }
  if (language.check === "xml") {
    const p = xmlProblem(text);
    return p === null && typeof DOMParser === "undefined" ? { checked: false, reason: "no XML parser here" } : { checked: true, problems: p ? [p] : [] };
  }
  if (language.prettier || language.sql) {
    const r = await formatCode(text, language, { printWidth: 80, tabWidth: 2, useTabs: false });
    if (r.ok) return { checked: true, problems: [] };
    if (r.problem) return { checked: true, problems: [r.problem] };
    return { checked: true, problems: [{ line: 1, column: 1, message: r.error, source: language.sql ? "sql" : "parser" }] };
  }
  return { checked: false, reason: `${language.name} is checked by the editor's parser only` };
}

/* ------------------------------------------------------------------ stats */

export interface CodeStats {
  lines: number;
  chars: number;
  bytes: number;
  words: number;
}
export function codeStats(text: string): CodeStats {
  return { lines: text ? text.split("\n").length : 0, chars: text.length, bytes: new TextEncoder().encode(text).length, words: (text.match(/\S+/g) ?? []).length };
}

export const SAMPLE = `// A small sample. Pick a language on the left, paste or drop a file, then Prettify.
import { readFile } from "node:fs/promises";

export async function countWords(path) {
  const text = await readFile(path, "utf8")
  const words = text.split(/\\s+/).filter(Boolean)
  return { path, words: words.length, longest: words.reduce((a, b) => a.length >= b.length ? a : b, "") }
}

countWords("README.md").then(console.log)
`;
