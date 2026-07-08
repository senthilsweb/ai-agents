// ── POSIX shell quoting ─────────────────────────────────────────────────────
//
// Security baseline fix (see openspec/changes/add-privacy-classifier/design.md
// "Security baseline" note). `sandbox.run({ command })` executes `command`
// through a real shell (`bash -lc`), so every argument built from a tool
// input must be quoted against shell metacharacters — not just JSON-escaped.
// `JSON.stringify` neutralizes `"` and `\` but leaves `$(...)` / backtick
// command substitution live inside double quotes. Single-quoting is the only
// quoting style bash treats as fully literal (nothing inside single quotes is
// interpreted, including `$`), so it's the correct primitive here. Same
// algorithm eve uses internally for its own sandboxed tools
// (`shell-quote.js`), reimplemented locally because eve doesn't export it
// from a public entry point.

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
