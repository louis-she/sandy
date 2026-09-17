import { Cursor, type SDKModel } from "@cursor/sdk";
import { config } from "./config.js";
import { readConfigFile, writeConfigFile } from "./config-io.js";

export type ChatCommandResult = {
  handled: boolean;
  reply?: string;
};

function normalizeCommandText(text: string): string {
  return text.trim().replace(/^\uFEFF/, "");
}

/** Persist model to config.yaml and update in-memory runtime config. */
export function setCursorModel(modelId: string): void {
  const filePath = config.configPath;
  const file = readConfigFile(filePath);
  if (!file.cursor) {
    file.cursor = { apiKey: config.cursorApiKey, model: modelId };
  } else {
    file.cursor.model = modelId;
  }
  writeConfigFile(filePath, file);
  config.cursorModel = modelId;
}

async function listAvailableModels(): Promise<SDKModel[]> {
  return Cursor.models.list({ apiKey: config.cursorApiKey });
}

function formatModelsList(models: SDKModel[]): string {
  const current = config.cursorModel;
  const lines = models.map((m, i) => {
    const mark = m.id === current || m.aliases?.includes(current) ? " ← 当前" : "";
    const alias =
      m.aliases && m.aliases.length > 0 ? `  (别名: ${m.aliases.join(", ")})` : "";
    return `${i + 1}. \`${m.id}\`${alias} — ${m.displayName || m.id}${mark}`;
  });
  return [
    `当前模型：\`${current}\``,
    "",
    "可用模型：",
    ...lines,
    "",
    "切换：`/model <id>`（也可用列表序号，如 `/model 2`）",
  ].join("\n");
}

function resolveModelId(raw: string, models: SDKModel[]): string {
  const input = raw.trim();
  if (!input) {
    throw new Error("请指定模型 id，例如 `/model auto` 或 `/model 2`");
  }

  if (/^\d+$/.test(input)) {
    const idx = Number(input) - 1;
    if (idx < 0 || idx >= models.length) {
      throw new Error(`序号超出范围（1–${models.length}）`);
    }
    return models[idx]!.id;
  }

  const lower = input.toLowerCase();
  const byId = models.find((m) => m.id.toLowerCase() === lower);
  if (byId) return byId.id;

  const byAlias = models.find((m) =>
    (m.aliases ?? []).some((a) => a.toLowerCase() === lower),
  );
  if (byAlias) return byAlias.id;

  const byName = models.filter((m) =>
    (m.displayName || "").toLowerCase().includes(lower),
  );
  if (byName.length === 1) return byName[0]!.id;
  if (byName.length > 1) {
    throw new Error(
      `「${input}」匹配到多个模型：${byName.map((m) => m.id).join(", ")}。请用精确 id。`,
    );
  }

  // Still allow setting an unknown id (SDK / future models); warn in reply.
  return input;
}

function helpText(): string {
  return [
    "Sandy 可用命令：",
    "",
    "`/help` — 显示本帮助",
    "`/new` / `/reset` — 开启新对话（清空当前会话）",
    "`/models` — 列出可用模型，并显示当前模型",
    "`/model` — 同 `/models`",
    "`/model <id|序号>` — 切换模型（写入 config.yaml，立即生效）",
    "",
    `当前模型：\`${config.cursorModel}\``,
  ].join("\n");
}

/**
 * Handle Feishu slash-style commands. Returns handled=true when the message
 * should not be forwarded to the Cursor agent.
 */
export async function tryHandleChatCommand(text: string): Promise<ChatCommandResult> {
  const raw = normalizeCommandText(text);
  if (!raw) return { handled: false };

  const lower = raw.toLowerCase();
  const parts = raw.split(/\s+/);
  const cmd = parts[0]!.toLowerCase();
  const arg = parts.slice(1).join(" ").trim();

  if (cmd === "/help" || lower === "help" || lower === "帮助") {
    return { handled: true, reply: helpText() };
  }

  if (cmd === "/models" || (cmd === "/model" && !arg) || lower === "模型列表") {
    try {
      const models = await listAvailableModels();
      if (models.length === 0) {
        return {
          handled: true,
          reply: `当前模型：\`${config.cursorModel}\`\n未能从 Cursor 拉取可用模型列表。`,
        };
      }
      return { handled: true, reply: formatModelsList(models) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        handled: true,
        reply: `列出模型失败：${message}\n当前模型：\`${config.cursorModel}\``,
      };
    }
  }

  if (cmd === "/model" || cmd === "/set-model" || cmd === "/setmodel") {
    try {
      const models = await listAvailableModels();
      const nextId = resolveModelId(arg, models);
      const known = models.some(
        (m) => m.id === nextId || (m.aliases ?? []).includes(nextId),
      );
      const prev = config.cursorModel;
      setCursorModel(nextId);
      const warn = known
        ? ""
        : `\n注意：\`${nextId}\` 不在当前可用列表中，仍已写入配置；若 SDK 不认可能会报错。`;
      return {
        handled: true,
        reply: `模型已切换：\`${prev}\` → \`${nextId}\`（已写入 config.yaml）。${warn}\n下一轮对话起生效；需要干净上下文可再发 \`/new\`。`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { handled: true, reply: `切换模型失败：${message}` };
    }
  }

  return { handled: false };
}
