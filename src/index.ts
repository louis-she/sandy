import path from "node:path";
import {
  formatAnswerPrompt,
  parseTextAnswer,
} from "./ask-question.js";
import {
  isResetCommand,
  resetSession,
  runCursorAgent,
  type AgentOutcome,
} from "./cursor-agent.js";
import { config } from "./config.js";
import {
  createFeishuClients,
  extractCardAction,
  extractText,
  getBotOpenId,
  parseIncomingMessage,
  replyAgentText,
  replyAskQuestionCard,
  replyText,
  shouldHandleMessage,
  type IncomingMessage,
} from "./feishu.js";
import {
  downloadMessageResource,
  parseIncomingFileContent,
} from "./feishu-files.js";
import { buildFeishuCustomTools } from "./feishu-tools.js";
import { PendingQuestionStore } from "./pending-store.js";
import { createSessionQueueManager, type QueueJob } from "./session-queue.js";
import { SessionStore } from "./session-store.js";
import { writeHookPolicy } from "./write-hook-policy.js";

const sessionStore = new SessionStore(config.sessionStorePath);
const pendingStore = new PendingQuestionStore(config.pendingStorePath);

let eventDispatcher: InstanceType<typeof Lark.EventDispatcher> | undefined;
let wsRestartTimer: ReturnType<typeof setTimeout> | undefined;

const { client, wsClient, Lark } = createFeishuClients({
  onWsError: () => {
    if (wsRestartTimer) return;
    wsRestartTimer = setTimeout(() => {
      wsRestartTimer = undefined;
      if (!eventDispatcher) return;
      console.warn("[ws] restarting long connection after terminal error");
      try {
        wsClient.start({ eventDispatcher });
      } catch (err) {
        console.error("[ws] restart failed:", err);
      }
    }, 5_000);
  },
});

function safeFileName(name: string | undefined, fallback: string): string {
  const base = (name || fallback).replace(/[/\\?%*:|"<>]/g, "_").trim();
  return base.slice(0, 120) || fallback;
}

/** Download file/image/media attachments into AGENT_CWD inbox; return prompt text. */
async function materializeIncomingAttachment(
  msg: IncomingMessage,
): Promise<string | undefined> {
  if (!["file", "image", "media"].includes(msg.messageType)) {
    return undefined;
  }

  const parsed = parseIncomingFileContent(msg.content);
  const fileKey =
    msg.messageType === "image"
      ? parsed.imageKey || parsed.fileKey
      : parsed.fileKey || parsed.imageKey;

  if (!fileKey) {
    throw new Error(
      `无法解析附件 key（message_type=${msg.messageType}）: ${msg.content.slice(0, 200)}`,
    );
  }

  const resourceType =
    msg.messageType === "image"
      ? "image"
      : msg.messageType === "media"
        ? "media"
        : "file";

  const extGuess =
    resourceType === "image"
      ? ".png"
      : resourceType === "media"
        ? ".mp4"
        : "";
  const fileName = safeFileName(
    parsed.fileName,
    `${resourceType}-${Date.now()}${extGuess}`,
  );
  const dest = path.join(
    config.inboxDir,
    msg.chatId,
    `${Date.now()}-${fileName}`,
  );

  await downloadMessageResource(
    client,
    msg.messageId,
    fileKey,
    resourceType,
    dest,
  );
  console.log(`[file] saved ${resourceType} -> ${dest}`);

  return [
    `用户在飞书里发送了${resourceType === "image" ? "图片" : resourceType === "media" ? "媒体" : "文件"}。`,
    `已下载到本地路径（可用 Read / 处理后再用 feishu_send_file 发回）：`,
    dest,
    parsed.fileName ? `原始文件名：${parsed.fileName}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function deliverOutcome(
  sessionKey: string,
  replyToMessageId: string,
  chatId: string,
  outcome: AgentOutcome,
): Promise<void> {
  if (outcome.type === "needs_input") {
    pendingStore.set(sessionKey, {
      agentId: outcome.agentId,
      chatId,
      replyToMessageId,
      title: outcome.ask.title,
      questions: outcome.ask.questions,
      partialText: outcome.partialText,
      createdAt: new Date().toISOString(),
    });

    if (outcome.partialText) {
      await replyAgentText(client, replyToMessageId, outcome.partialText);
    }

    await replyAskQuestionCard(client, replyToMessageId, sessionKey, outcome.ask);
    console.log(
      `[ask] waiting for selection session=${sessionKey} questions=${outcome.ask.questions.length}`,
    );
    return;
  }

  pendingStore.delete(sessionKey);
  await replyAgentText(client, replyToMessageId, outcome.text);
}

const sessionQueue = createSessionQueueManager(client, async (job: QueueJob) => {
  const sessionKey = job.chatId;
  try {
    const customTools = buildFeishuCustomTools({
      client,
      replyToMessageId: job.messageId,
      chatId: job.chatId,
    });
    const outcome = await runCursorAgent(sessionStore, sessionKey, job.prompt, {
      customTools,
    });
    await deliverOutcome(sessionKey, job.messageId, job.chatId, outcome);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[handle] agent failed:", err);
    await replyText(client, job.messageId, `处理失败：${message}`);
  }
});

function enqueuePrompt(
  sessionKey: string,
  replyToMessageId: string,
  chatId: string,
  prompt: string,
): void {
  sessionQueue.enqueue(sessionKey, {
    messageId: replyToMessageId,
    chatId,
    prompt,
  });
}

async function continueWithAnswers(
  sessionKey: string,
  replyToMessageId: string,
  answers: Array<{ questionId: string; selectedOptionIds: string[]; freeformText?: string }>,
): Promise<void> {
  const pending = pendingStore.get(sessionKey);
  if (!pending) {
    await replyText(client, replyToMessageId, "没有待回答的选择题，直接发消息即可。");
    return;
  }

  const prompt = formatAnswerPrompt(pending.questions, answers);
  pendingStore.delete(sessionKey);
  enqueuePrompt(sessionKey, replyToMessageId, pending.chatId, prompt);
}

async function handleMessage(raw: Parameters<typeof parseIncomingMessage>[0]) {
  const msg = parseIncomingMessage(raw);

  let botOpenId: string | undefined;
  try {
    botOpenId = await getBotOpenId(client);
  } catch (err) {
    if (msg.chatType !== "p2p") {
      console.warn("[handle] skip group message; bot open_id unavailable:", err);
      return;
    }
    console.warn("[handle] bot open_id unavailable; p2p continues without mention strip");
  }

  const { text, mentionedBot } = extractText(msg, botOpenId ?? "");

  if (!shouldHandleMessage(msg, mentionedBot)) {
    return;
  }

  const sessionKey = msg.chatId;

  let attachmentPrompt: string | undefined;
  try {
    attachmentPrompt = await materializeIncomingAttachment(msg);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[file] download failed:", err);
    await replyText(client, msg.messageId, `下载附件失败：${message}`);
    return;
  }

  const promptParts = [attachmentPrompt, text].filter(Boolean);
  const prompt = promptParts.join("\n\n").trim();

  if (!prompt) {
    await replyText(
      client,
      msg.messageId,
      "请发送文本、文件或图片；或发送 /new 开启新对话。",
    );
    return;
  }

  if (isResetCommand(text)) {
    resetSession(sessionStore, sessionKey);
    pendingStore.delete(sessionKey);
    await sessionQueue.clear(sessionKey);
    await replyText(client, msg.messageId, "已开启新对话。直接发消息即可。");
    return;
  }

  const pending = pendingStore.get(sessionKey);
  if (pending && text && !attachmentPrompt) {
    const answers = parseTextAnswer(pending.questions, text);
    if (answers) {
      await continueWithAnswers(sessionKey, msg.messageId, answers);
      return;
    }
    // Not a valid answer — treat as normal new prompt, drop pending.
    console.log(`[ask] clearing pending; treating as new prompt session=${sessionKey}`);
    pendingStore.delete(sessionKey);
  }

  enqueuePrompt(sessionKey, msg.messageId, msg.chatId, prompt);
}

async function handleCardAction(data: unknown) {
  const { value, chatId, messageId } = extractCardAction(data);
  if (!value) {
    console.warn("[card] ignore non-askq action", JSON.stringify(data)?.slice(0, 400));
    return;
  }

  const sessionKey = value.sk;
  const pending = pendingStore.get(sessionKey);
  if (!pending) {
    console.warn(`[card] no pending for session=${sessionKey}`);
    return;
  }

  const replyTo = messageId || pending.replyToMessageId;
  const q = pending.questions.find((qq) => qq.id === value.qid);
  if (!q || !q.options.some((o) => o.id === value.oid)) {
    await replyText(client, replyTo, "选项无效或已过期，请重新提问。");
    pendingStore.delete(sessionKey);
    return;
  }

  // Button path is for single-question single-select cards.
  await continueWithAnswers(sessionKey, replyTo, [
    { questionId: value.qid, selectedOptionIds: [value.oid] },
  ]);
}

async function main() {
  console.log("[boot] feishu-cursor-bot starting");
  console.log(`[boot] agent cwd=${config.agentCwd}`);
  console.log(`[boot] agent dirs=${config.agentDirs.join(", ") || "(none)"}`);
  console.log(`[boot] sandbox=${config.agentSandbox}`);
  console.log(`[boot] model=${config.cursorModel}`);
  console.log(`[boot] inbox=${config.inboxDir}`);
  if (config.feishuDocsFolder) {
    console.log(`[boot] docs folder=${config.feishuDocsFolder}`);
  }

  try {
    const policyPath = writeHookPolicy();
    console.log(`[boot] hook policy=${policyPath}`);
  } catch (err) {
    console.warn("[boot] failed to write hook policy:", err);
  }

  try {
    const botOpenId = await getBotOpenId(client);
    console.log(`[boot] bot open_id=${botOpenId}`);
  } catch (err) {
    console.warn("[boot] could not resolve bot open_id yet:", err);
  }

  eventDispatcher = new Lark.EventDispatcher({}).register({
    // Feishu SDK callback typings are loose; annotate explicitly.
    "im.message.receive_v1": async (data: Parameters<typeof parseIncomingMessage>[0]) => {
      void handleMessage(data).catch((err: unknown) => {
        console.error("[ws] unhandled message error:", err);
      });
    },
    "card.action.trigger": async (data: Record<string, unknown>) => {
      // Must return within ~3s; agent continue runs in background.
      void handleCardAction(data).catch((err: unknown) => {
        console.error("[ws] unhandled card action error:", err);
      });
      return {
        toast: {
          type: "info",
          content: "已收到选择，继续处理…",
        },
      };
    },
  } as Record<string, (data: never) => Promise<unknown>>);

  wsClient.start({ eventDispatcher });

  console.log("[boot] Feishu WebSocket long connection started");
  console.log(
    "[boot] Events: im.message.receive_v1 | Callbacks: card.action.trigger (long connection)",
  );
}

main().catch((err) => {
  console.error("[boot] fatal:", err);
  process.exit(1);
});
