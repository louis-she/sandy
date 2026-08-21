import fs from "node:fs";
import {
  configFilePath,
  expandPath,
  workDir,
  writeConfigFile,
} from "./config-io.js";
import { defaultConfigFile, type SandyConfigFile } from "./config-schema.js";
import { INIT_FIELD_GUIDES } from "./init-guides.js";
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
    console.log("Sandy 初始化");
    console.log("会逐步说明每项如何获取，并写入 config.yaml。\n");
    console.log(`目标目录: ${targetDir}`);
    console.log(`配置文件: ${outPath}`);

    if (fs.existsSync(outPath)) {
      const overwrite = await prompt.askYesNo("\n已存在 config.yaml，是否覆盖？", false);
      if (!overwrite) {
        console.log("已取消。");
        return;
      }
    }

    const cfg: SandyConfigFile = defaultConfigFile(targetDir);

    prompt.section("一、飞书应用");
    prompt.guide(INIT_FIELD_GUIDES.feishuAppHome);

    cfg.feishu.appId = await prompt.askWithGuide(
      INIT_FIELD_GUIDES.feishuAppId,
      "App ID",
      { required: true },
    );
    cfg.feishu.appSecret = await prompt.askWithGuide(
      INIT_FIELD_GUIDES.feishuAppSecret,
      "App Secret",
      { required: true },
    );

    prompt.guide(INIT_FIELD_GUIDES.feishuSetupHint);

    prompt.section("二、Cursor");
    cfg.cursor.apiKey = await prompt.askWithGuide(
      INIT_FIELD_GUIDES.cursorApiKey,
      "API Key",
      { required: true },
    );

    prompt.section("三、Agent 与工作区（可一路回车用默认）");
    cfg.agent!.name = await prompt.askWithGuide(
      INIT_FIELD_GUIDES.agentName,
      "显示名",
      { defaultValue: "Sandy" },
    );
    cfg.agent!.cwd = await prompt.askWithGuide(
      INIT_FIELD_GUIDES.agentCwd,
      "工作目录",
      { defaultValue: targetDir },
    );

    const dirsRaw = await prompt.askWithGuide(
      INIT_FIELD_GUIDES.agentDirs,
      "额外目录（逗号分隔，可留空）",
      { defaultValue: "" },
    );
    cfg.agent!.dirs = dirsRaw ? splitList(dirsRaw) : [];

    cfg.agent!.sandbox = await prompt.askYesNoWithGuide(
      INIT_FIELD_GUIDES.agentSandbox,
      "开启本地沙箱？",
      false,
    );
    cfg.cursor.model = await prompt.askWithGuide(
      INIT_FIELD_GUIDES.cursorModel,
      "模型 id",
      { defaultValue: "auto" },
    );

    writeConfigFile(outPath, cfg);

    console.log("\n✓ 已写入 " + outPath);

    if (process.platform === "darwin") {
      const { runAuthorize } = await import("./authorize.js");
      prompt.section("四、macOS 磁盘授权");
      console.log("  弹出「node 想访问…」请全部点「允许」。远程 SSH 时弹窗在本机屏幕上。\n");
      const extraDirs = [
        expandPath(cfg.agent!.cwd || targetDir, targetDir),
        ...(cfg.agent!.dirs ?? []).map((d) => expandPath(d, targetDir)),
        targetDir,
      ];
      runAuthorize({ extraDirs, openSettings: true });
    }

    console.log("\n下一步:");
    console.log(`  cd ${targetDir}`);
    console.log("  sandy");
    console.log("\n飞书后台若尚未配置长连接与权限，请按上文「飞书后台还需完成」逐项检查。");
  } finally {
    prompt.close();
  }
}
