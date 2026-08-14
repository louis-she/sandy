import fs from "node:fs";
import path from "node:path";
import {
  configFilePath,
  expandPath,
  workDir,
  writeConfigFile,
} from "./config-io.js";
import { defaultConfigFile, type SandyConfigFile } from "./config-schema.js";
import { createPrompter } from "./prompt.js";

function parseArgs(argv: string[]): { targetDir: string } {
  let targetDir = workDir;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dir" || arg === "-C") {
      const next = argv[i + 1];
      if (!next) throw new Error(`${arg} requires a directory path`);
      targetDir = expandPath(next, process.cwd());
      i++;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: sandy init [--dir <path>]

Create config.yaml interactively in the target directory (default: current cwd).`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { targetDir };
}

function splitList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function runInit(argv: string[] = []): Promise<void> {
  const { targetDir } = parseArgs(argv);
  const outPath = configFilePath(targetDir);
  const prompt = createPrompter();

  try {
    console.log("Sandy 初始化 — 逐步生成 config.yaml\n");
    console.log(`目标目录: ${targetDir}`);
    console.log(`配置文件: ${outPath}\n`);

    if (fs.existsSync(outPath)) {
      const overwrite = await prompt.askYesNo("已存在 config.yaml，是否覆盖？", false);
      if (!overwrite) {
        console.log("已取消。");
        return;
      }
    }

    const cfg: SandyConfigFile = defaultConfigFile(targetDir);

    console.log("【必填】飞书与 Cursor");
    cfg.feishu.appId = await prompt.askRequired("飞书 App ID (FEISHU_APP_ID)");
    cfg.feishu.appSecret = await prompt.askRequired("飞书 App Secret");
    cfg.cursor.apiKey = await prompt.askRequired("Cursor API Key");

    console.log("\n【可选】Agent 与工作区");
    cfg.agent!.name = await prompt.ask("Agent 显示名", "Sandy");
    cfg.agent!.cwd = await prompt.ask("Agent 工作目录 (AGENT_CWD)", targetDir);

    const dirsRaw = await prompt.ask("额外可访问目录，逗号分隔 (AGENT_DIRS，可留空)", "");
    cfg.agent!.dirs = dirsRaw ? splitList(dirsRaw) : [];

    const linksRaw = await prompt.ask(
      "AGENT_CWD 下要放行的 symlink 名，逗号分隔 (可留空)",
      "",
    );
    cfg.agent!.dirLinks = linksRaw ? splitList(linksRaw) : [];

    cfg.agent!.sandbox = await prompt.askYesNo("开启 Cursor 本地沙箱 (AGENT_SANDBOX)?", false);
    cfg.cursor.model = await prompt.ask("Cursor 模型 id", "auto");
    cfg.feishuDocsFolder = await prompt.ask("飞书文档默认 folder_token (可留空)", "");

    writeConfigFile(outPath, cfg);

    console.log(`\n已写入 ${outPath}`);
    console.log(`下一步: cd ${targetDir} && sandy`);
  } finally {
    prompt.close();
  }
}
