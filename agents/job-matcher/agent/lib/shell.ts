// ── POSIX shell quoting ─────────────────────────────────────────────────────
//
// Security baseline note (see openspec/changes/add-job-matcher/design.md
// "Security baseline"). `sandbox.run({ command })` executes `command`
// through a real shell, so every argument built from a tool input must be
// quoted against shell metacharacters — not just JSON-escaped. Single-
// quoting is the only quoting style bash treats as fully literal (nothing
// inside single quotes is interpreted, including `$`). Same algorithm as
// agents/privacy-classifier/agent/lib/shell.ts — copied locally per this
// repo's convention that small per-agent utilities live in each agent's own
// lib/, not shared/ (see AGENTS.md "Monorepo Conventions").

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
