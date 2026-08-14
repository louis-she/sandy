import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { SandyConfigFile } from "./config-schema.js";

export const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/** Workspace that owns `config.yaml` — usually where you run the CLI. */
export const workDir = (() => {
  const override = process.env.SANDY_CWD?.trim() || process.env.FEISHU_CURSOR_CWD?.trim();
  if (!override) return process.cwd();
  return expandPath(override, process.cwd());
})();

export function configFilePath(base = workDir): string {
  const override = process.env.SANDY_CONFIG?.trim();
  if (override) return expandPath(override, base);
  return path.join(base, "config.yaml");
}

export function expandPath(raw: string, base: string = process.cwd()): string {
  const trimmed = raw.trim();
  if (trimmed === "~") return os.homedir();
  if (trimmed.startsWith("~/")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(base, trimmed);
}

export function readConfigFile(filePath: string): SandyConfigFile {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Config not found: ${filePath}\nRun \`sandy init\` in ${workDir} to create config.yaml.`,
    );
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = parseYaml(raw) as SandyConfigFile | null;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid config.yaml: ${filePath}`);
  }
  return parsed;
}

export function writeConfigFile(filePath: string, data: SandyConfigFile): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const body = stringifyYaml(data, {
    lineWidth: 0,
    defaultStringType: "QUOTE_DOUBLE",
  });
  fs.writeFileSync(filePath, body.endsWith("\n") ? body : `${body}\n`, "utf8");
}

export function parseBool(raw: unknown, defaultValue: boolean): boolean {
  if (raw === undefined || raw === null || raw === "") return defaultValue;
  if (typeof raw === "boolean") return raw;
  const v = String(raw).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return defaultValue;
}

function requiredField(label: string, value: string | undefined, filePath: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(
      `Missing required config: ${label} (set it in ${filePath}, or run \`sandy init\`)`,
    );
  }
  return trimmed;
}

export function loadRuntimeConfig() {
  const filePath = configFilePath();
  const fileConfig = readConfigFile(filePath);
  const agentSection = fileConfig.agent ?? {};
  const agentCwdRaw = agentSection.cwd?.trim() || workDir;
  const agentDirs = Array.isArray(agentSection.dirs)
    ? [...new Set(agentSection.dirs.map((p) => expandPath(String(p), workDir)).filter(Boolean))]
    : [];
  const agentDirLinks = Array.isArray(agentSection.dirLinks)
    ? [...new Set(agentSection.dirLinks.map((s) => String(s).trim()).filter(Boolean))]
    : [];

  return {
    packageRoot,
    workDir,
    configPath: filePath,
    feishuAppId: requiredField("feishu.appId", fileConfig.feishu?.appId, filePath),
    feishuAppSecret: requiredField("feishu.appSecret", fileConfig.feishu?.appSecret, filePath),
    cursorApiKey: requiredField("cursor.apiKey", fileConfig.cursor?.apiKey, filePath),
    cursorModel: fileConfig.cursor?.model?.trim() || "auto",
    agentName: agentSection.name?.trim() || "Sandy",
    agentCwd: expandPath(String(agentCwdRaw), workDir),
    agentDirs,
    agentDirLinks,
    agentSandbox: parseBool(agentSection.sandbox, false),
    sessionStorePath: path.resolve(workDir, ".data", "sessions.json"),
    pendingStorePath: path.resolve(workDir, ".data", "pending-questions.json"),
    feishuDocsFolder: fileConfig.feishuDocsFolder?.trim() || "",
    inboxDir: path.join(expandPath(String(agentCwdRaw), workDir), ".data", "feishu-inbox"),
  };
}

export type RuntimeConfig = ReturnType<typeof loadRuntimeConfig>;
