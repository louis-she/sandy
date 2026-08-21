import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  configFilePath,
  expandPath,
  readConfigFile,
  workDir,
} from "./config-io.js";

export type AuthorizeOptions = {
  extraDirs?: string[];
  /** Open System Settings → Full Disk Access after probing. Default true. */
  openSettings?: boolean;
};

type ProbeResult = {
  dir: string;
  status: "ok" | "missing" | "denied";
  detail?: string;
};

function nodeBinary(): string {
  try {
    return fs.realpathSync(process.execPath);
  } catch {
    return process.execPath;
  }
}

function isRemoteSession(): boolean {
  return Boolean(process.env.SSH_CONNECTION || process.env.SSH_CLIENT || process.env.SSH_TTY);
}

function extraDirsFromConfig(): string[] {
  try {
    const filePath = configFilePath();
    if (!fs.existsSync(filePath)) return [workDir];
    const file = readConfigFile(filePath);
    const cwdRaw = file.agent?.cwd?.trim() || workDir;
    const dirs = Array.isArray(file.agent?.dirs) ? file.agent.dirs : [];
    return [
      expandPath(String(cwdRaw), workDir),
      ...dirs.map((d) => expandPath(String(d), workDir)),
    ];
  } catch {
    return [workDir];
  }
}

function listSubdirs(root: string): string[] {
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() || d.isSymbolicLink())
      .map((d) => path.resolve(root, d.name));
  } catch {
    return [];
  }
}

function standardTargets(home: string): string[] {
  return [
    home,
    path.join(home, "Desktop"),
    path.join(home, "Documents"),
    path.join(home, "Downloads"),
    path.join(home, "Pictures"),
    path.join(home, "Movies"),
    path.join(home, "Music"),
    path.join(home, "Library"),
    path.join(home, "Library", "CloudStorage"),
    path.join(home, "Library", "Mobile Documents"),
    path.join(home, "Library", "Mobile Documents", "com~apple~CloudDocs"),
  ];
}

function uniqueExistingOrder(dirs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of dirs) {
    const resolved = path.resolve(raw);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(resolved);
  }
  return out;
}

function probe(dir: string): ProbeResult {
  try {
    fs.accessSync(dir, fs.constants.R_OK);
    const st = fs.statSync(dir);
    if (st.isDirectory()) {
      const dh = fs.opendirSync(dir);
      dh.closeSync();
    }
    return { dir, status: "ok" };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return { dir, status: "missing" };
    return { dir, status: "denied", detail: err.code || err.message };
  }
}

function displayPath(dir: string, home: string): string {
  if (dir === home) return "~";
  if (dir.startsWith(home + path.sep)) return "~" + dir.slice(home.length);
  return dir;
}

function openFullDiskAccessSettings(): void {
  spawn(
    "open",
    [
      "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles",
    ],
    { detached: true, stdio: "ignore" },
  ).unref();
}

/**
 * Touch macOS TCC-protected folders so this Node binary gets Files and Folders
 * prompts. Must be run at the Mac (GUI session); SSH will hang on unread dialogs.
 */
export function runAuthorize(options: AuthorizeOptions = {}): void {
  if (process.platform !== "darwin") {
    console.log("非 macOS，无需磁盘授权。");
    return;
  }

  const home = os.homedir();
  const nodePath = nodeBinary();
  const extra = options.extraDirs?.length ? options.extraDirs : extraDirsFromConfig();
  const cloudRoot = path.resolve(path.join(home, "Library", "CloudStorage"));
  const targets = uniqueExistingOrder([...standardTargets(home), ...extra]);
  const openSettings = options.openSettings !== false;

  console.log("macOS 磁盘授权");
  console.log("会逐个访问受保护目录；弹出「node 想访问…」请全部点「允许」。");
  console.log(`当前 Node: ${nodePath}`);
  if (isRemoteSession()) {
    console.log("检测到 SSH：弹窗会出现在这台 Mac 的屏幕上，没人点就会卡住。请在电脑前执行。");
  }
  console.log("");

  const results: ProbeResult[] = [];
  const seen = new Set(targets);
  for (let i = 0; i < targets.length; i++) {
    const dir = targets[i]!;
    const label = displayPath(dir, home);
    process.stdout.write(`  ${label} … `);
    const result = probe(dir);
    results.push(result);
    if (result.status === "ok") console.log("ok");
    else if (result.status === "missing") console.log("（目录不存在，跳过）");
    else console.log(`拒绝 (${result.detail})`);

    if (result.status === "ok" && dir === cloudRoot) {
      for (const child of listSubdirs(dir)) {
        if (seen.has(child)) continue;
        seen.add(child);
        targets.push(child);
      }
    }
  }

  const denied = results.filter((r) => r.status === "denied");
  const ok = results.filter((r) => r.status === "ok");
  console.log("");
  console.log(`完成：允许 ${ok.length}，拒绝 ${denied.length}，其余目录不存在。`);
  if (denied.length) {
    console.log("被拒绝的目录远程访问仍会卡住。再跑一次 sandy authorize，或到「文件和文件夹」里打开开关。");
  }

  console.log("");
  console.log("建议再把这份 Node 加到「完全磁盘访问权限」（升级 Node 后要重新加）：");
  console.log(`  ${nodePath}`);

  if (openSettings) {
    openFullDiskAccessSettings();
    console.log("已打开系统设置 → 隐私与安全性 → 完全磁盘访问权限。");
  }
}
