import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** Workspace that owns `.env` / agent cwd — usually where you run the CLI. */
export const workDir = (() => {
  const override = process.env.FEISHU_CURSOR_CWD?.trim();
  if (!override) return process.cwd();
  return expandPath(override, process.cwd());
})();

// Prefer cwd `.env`, then package-local `.env` as fallback (no override).
dotenv.config({ path: path.join(workDir, ".env") });
dotenv.config({ path: path.join(packageRoot, ".env") });

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Missing required env: ${name} (put it in ${path.join(workDir, ".env")})`,
    );
  }
  return value;
}

function expandPath(raw: string, base = workDir): string {
  const trimmed = raw.trim();
  if (trimmed === "~") return os.homedir();
  if (trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(base, trimmed);
}

function parseBool(raw: string | undefined, defaultValue: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return defaultValue;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return defaultValue;
}

const agentCwdRaw = process.env.AGENT_CWD?.trim() || workDir;
const agentDirsRaw = process.env.AGENT_DIRS?.trim() || "";
const agentDirs = agentDirsRaw
  ? [...new Set(agentDirsRaw.split(",").map((p) => expandPath(p)).filter(Boolean))]
  : [];

/** Optional symlink names under AGENT_CWD to also allow (comma-separated). */
const agentDirLinksRaw = process.env.AGENT_DIR_LINKS?.trim() || "";
export const agentDirLinks = agentDirLinksRaw
  ? [...new Set(agentDirLinksRaw.split(",").map((s) => s.trim()).filter(Boolean))]
  : [];

export const config = {
  packageRoot,
  workDir,
  feishuAppId: required("FEISHU_APP_ID"),
  feishuAppSecret: required("FEISHU_APP_SECRET"),
  cursorApiKey: required("CURSOR_API_KEY"),
  cursorModel: process.env.CURSOR_MODEL?.trim() || "auto",
  /** Display name for the Cursor agent / bot persona. */
  agentName: process.env.AGENT_NAME?.trim() || "Sandy",
  /** Primary workspace root for the agent. Defaults to cwd. */
  agentCwd: expandPath(String(agentCwdRaw)),
  /** Optional extra workspace roots (multi-root). */
  agentDirs,
  agentDirLinks,
  /** Enable Cursor local sandbox (FS + shell + default deny network for shell). */
  agentSandbox: parseBool(process.env.AGENT_SANDBOX, false),
  sessionStorePath: path.resolve(workDir, ".data", "sessions.json"),
  pendingStorePath: path.resolve(workDir, ".data", "pending-questions.json"),
};

export function localAgentOptions() {
  return {
    cwd: config.agentCwd,
    ...(config.agentDirs.length > 0 ? { dirs: config.agentDirs } : {}),
    ...(config.agentSandbox ? { sandboxOptions: { enabled: true as const } } : {}),
    // Load AGENTS.md / .cursor/rules from AGENT_CWD.
    settingSources: ["project" as const],
  };
}
