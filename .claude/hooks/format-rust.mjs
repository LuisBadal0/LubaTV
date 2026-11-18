// Claude Code hook (PostToolUse on Edit and Write): formats a Rust file right after an agent
// edits it, so `cargo fmt --check` in CI doesn't fail on layout.
//
// It never blocks: when rustfmt isn't installed or fails, it says so on stderr and exits 0.

import { spawnSync } from "node:child_process";

let input = "";
for await (const chunk of process.stdin) input += chunk;

let file;
try {
  file = JSON.parse(input).tool_input?.file_path;
} catch {
  process.exit(0);
}
if (typeof file !== "string" || !file.endsWith(".rs")) process.exit(0);

const result = spawnSync("rustfmt", ["--edition", "2024", file], { encoding: "utf8" });
if (result.error) {
  // rustfmt isn't on PATH: CI still checks formatting.
  process.exit(0);
}
if (result.status !== 0) {
  process.stderr.write(`rustfmt could not format ${file}:\n${result.stderr}`);
}
process.exit(0);
