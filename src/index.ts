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
} from "./feishu.js";
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
    const outcome = await runCursorAgent(sessionStore, sessionKey, job.prompt);
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

  if (!text) {
    await replyText(client, msg.messageId, "请发送文本消息，或发送 /new 开启新对话。");
    return;
  }

  const sessionKey = msg.chatId;

  if (isResetCommand(text)) {
    resetSession(sessionStore, sessionKey);
    pendingStore.delete(sessionKey);
    await sessionQueue.clear(sessionKey);
    await replyText(client, msg.messageId, "已开启新对话。直接发消息即可。");
    return;
  }

  const pending = pendingStore.get(sessionKey);
  if (pending) {
    const answers = parseTextAnswer(pending.questions, text);
    if (answers) {
      await continueWithAnswers(sessionKey, msg.messageId, answers);
      return;
    }
    // Not a valid answer — treat as normal new prompt, drop pending.
    console.log(`[ask] clearing pending; treating as new prompt session=${sessionKey}`);
    pendingStore.delete(sessionKey);
  }

  enqueuePrompt(sessionKey, msg.messageId, msg.chatId, text);
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
