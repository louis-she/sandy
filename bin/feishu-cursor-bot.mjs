#!/usr/bin/env node
/**
 * CLI entry: run from any directory; loads `.env` from cwd (see src/config.ts).
 *
 *   npx feishu-cursor-bot
 *   npm i -g . && feishu-cursor-bot
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const entry = path.join(packageRoot, "src", "index.ts");
const require = createRequire(import.meta.url);

let tsxCli;
try {
  tsxCli = require.resolve("tsx/cli");
} catch {
  console.error("Missing dependency `tsx`. Run npm install in the package root.");
  process.exit(1);
}

const child = spawn(process.execPath, [tsxCli, entry, ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
