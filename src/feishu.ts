import * as Lark from "@larksuiteoapi/node-sdk";
import type { AskQuestion, ParsedAskQuestion } from "./ask-question.js";
import { config } from "./config.js";
import {
  buildMarkdownCard,
  buildPostMdContent,
  looksLikeMarkdown,
  splitReplyChunks,
} from "./feishu-markdown.js";

export type IncomingMessage = {
  chatId: string;
  chatType: string;
  messageId: string;
  messageType: string;
  content: string;
  senderId?: string;
  senderType?: string;
  mentions: Array<{
    key: string;
    id?: { open_id?: string; user_id?: string };
    name?: string;
  }>;
};

export function createFeishuClients(options?: {
  onWsError?: (error: unknown) => void;
}) {
  const baseConfig = {
    appId: config.feishuAppId,
    appSecret: config.feishuAppSecret,
  };

  const client = new Lark.Client(baseConfig);
  const wsClient = new Lark.WSClient({
    ...baseConfig,
    loggerLevel: Lark.LoggerLevel.info,
    handshakeTimeoutMs: 20_000,
    onError: (error: unknown) => {
      console.error("[ws] terminal error:", error);
      options?.onWsError?.(error);
    },
    onReconnecting: () => {
      console.warn("[ws] reconnecting…");
    },
    onReconnected: () => {
      console.log("[ws] reconnected");
    },
  });

  return { client, wsClient, Lark };
}

let cachedBotOpenId: string | undefined;

export async function getBotOpenId(client: Lark.Client): Promise<string> {
  if (cachedBotOpenId) return cachedBotOpenId;

  const res = await client.request({
    url: "/open-apis/bot/v3/info",
    method: "GET",
  });

  const openId = res?.bot?.open_id ?? res?.data?.bot?.open_id;
  if (!openId || typeof openId !== "string") {
    throw new Error(`Failed to resolve bot open_id: ${JSON.stringify(res)}`);
  }

  cachedBotOpenId = openId;
  return openId;
}

export function parseIncomingMessage(data: {
  message: {
    chat_id: string;
    chat_type: string;
    message_id: string;
    message_type: string;
    content: string;
    mentions?: IncomingMessage["mentions"];
  };
  sender?: {
    sender_id?: { open_id?: string };
    sender_type?: string;
  };
}): IncomingMessage {
  return {
    chatId: data.message.chat_id,
    chatType: data.message.chat_type,
    messageId: data.message.message_id,
    messageType: data.message.message_type,
    content: data.message.content,
    senderId: data.sender?.sender_id?.open_id,
    senderType: data.sender?.sender_type,
    mentions: data.message.mentions ?? [],
  };
}

/** Extract plain text and whether the bot was @mentioned. */
export function extractText(
  msg: IncomingMessage,
  botOpenId: string,
): { text: string; mentionedBot: boolean } {
  let text = "";
  try {
    const parsed = JSON.parse(msg.content) as { text?: string };
    text = typeof parsed.text === "string" ? parsed.text : "";
  } catch {
    text = msg.content;
  }

  const mentionedBot = msg.mentions.some(
    (m) => m.id?.open_id === botOpenId,
  );

  // Strip Feishu mention placeholders like @_user_1
  for (const mention of msg.mentions) {
    if (mention.key) {
      text = text.replaceAll(mention.key, "");
    }
  }

  return { text: text.replace(/\s+/g, " ").trim(), mentionedBot };
}

const HANDLE_MESSAGE_TYPES = new Set(["text", "file", "image", "media"]);

export function shouldHandleMessage(
  msg: IncomingMessage,
  mentionedBot: boolean,
): boolean {
  if (msg.senderType === "app") return false;
  if (!HANDLE_MESSAGE_TYPES.has(msg.messageType)) return false;
  // p2p: always; group/topic: only when @bot
  if (msg.chatType === "p2p") return true;
  return mentionedBot;
}

export async function replyText(
  client: Lark.Client,
  messageId: string,
  text: string,
  options?: { preferMarkdown?: boolean },
): Promise<void> {
  await sendReplyContent(client, messageId, text, options?.preferMarkdown ?? false);
}

/** Agent replies: always try Feishu post(md) first — plain text still renders fine. */
export async function replyAgentText(
  client: Lark.Client,
  messageId: string,
  text: string,
): Promise<void> {
  await sendReplyContent(client, messageId, text, true);
}

async function sendReplyContent(
  client: Lark.Client,
  messageId: string,
  text: string,
  preferMarkdown: boolean,
): Promise<void> {
  const useMarkdown = preferMarkdown || looksLikeMarkdown(text);
  const chunks = splitReplyChunks(text, useMarkdown);

  for (const chunk of chunks) {
    const chunkMarkdown = useMarkdown || looksLikeMarkdown(chunk);
    if (chunkMarkdown) {
      try {
        await client.im.v1.message.reply({
          path: { message_id: messageId },
          data: {
            content: buildPostMdContent(chunk),
            msg_type: "post",
          },
        });
        continue;
      } catch (err) {
        console.warn("[feishu] post(md) failed, try interactive card:", err);
      }

      try {
        await client.im.v1.message.reply({
          path: { message_id: messageId },
          data: {
            content: JSON.stringify(buildMarkdownCard(chunk)),
            msg_type: "interactive",
          },
        });
        continue;
      } catch (err) {
        console.warn("[feishu] interactive markdown failed, fallback text:", err);
      }
    }

    for (const plain of splitFeishuText(chunk)) {
      await client.im.v1.message.reply({
        path: { message_id: messageId },
        data: {
          content: JSON.stringify({ text: plain }),
          msg_type: "text",
        },
      });
    }
  }
}

/** Ack a user message with a reaction emoji (no chat spam). Returns reaction_id if created. */
export async function reactToMessage(
  client: Lark.Client,
  messageId: string,
  emojiType = "OnIt",
): Promise<string | undefined> {
  const res = await client.im.v1.messageReaction.create({
    path: { message_id: messageId },
    data: {
      reaction_type: { emoji_type: emojiType },
    },
  });
  return res?.data?.reaction_id;
}

/** Remove a reaction the bot previously added (requires reaction_id from create). */
export async function removeReaction(
  client: Lark.Client,
  messageId: string,
  reactionId: string,
): Promise<void> {
  await client.im.v1.messageReaction.delete({
    path: { message_id: messageId, reaction_id: reactionId },
  });
}

export const REACTION_QUEUED = "OneSecond";
export const REACTION_WORKING = "OnIt";

/** Feishu text messages are safest under ~4k chars; keep headroom. */
function splitFeishuText(text: string, max = 3500): string[] {
  if (text.length <= max) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = max;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

export type CardActionValue = {
  kind: "askq";
  sk: string; // sessionKey
  qid: string;
  oid: string;
};

export function buildAskQuestionCard(
  sessionKey: string,
  ask: ParsedAskQuestion,
): Record<string, unknown> {
  const title = ask.title?.trim() || "需要你的选择";
  const elements: unknown[] = [];

  const useButtons =
    ask.questions.length === 1 && !ask.questions[0]!.allowMultiple;

  for (const [qi, q] of ask.questions.entries()) {
    elements.push({
      tag: "markdown",
      content: `**${qi + 1}. ${q.prompt}**${q.allowMultiple ? "（可多选）" : ""}`,
    });

    if (useButtons) {
      elements.push({
        tag: "action",
        actions: q.options.map((opt, oi) => ({
          tag: "button",
          text: { tag: "plain_text", content: truncate(opt.label, 40) },
          type: oi === 0 ? "primary" : "default",
          value: {
            kind: "askq",
            sk: sessionKey,
            qid: q.id,
            oid: opt.id,
          } satisfies CardActionValue,
        })),
      });
    } else if (q.options.length > 0) {
      const lines = q.options.map((opt, oi) => `${oi + 1}. ${opt.label}`);
      elements.push({
        tag: "markdown",
        content: lines.join("\n"),
      });
    }
  }

  if (!useButtons) {
    const hasOptions = ask.questions.some((q) => q.options.length > 0);
    elements.push({
      tag: "markdown",
      content: hasOptions
        ? ask.questions.length === 1
          ? "请直接回复选项编号（多选如 `1,3`），或回复选项原文。"
          : "请按题号回复，例如：`1:2; 2:1`（题号:选项编号）。也可直接用文字说明。"
        : "请直接回复本题答案。",
    });
  }

  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    header: {
      template: "blue",
      title: { tag: "plain_text", content: truncate(title, 50) },
    },
    body: { elements },
  };
}

export function formatAskQuestionFallbackText(ask: ParsedAskQuestion): string {
  const lines = [`【需要你选择】${ask.title?.trim() || ""}`.trim()];
  for (const [qi, q] of ask.questions.entries()) {
    lines.push("");
    lines.push(`${qi + 1}. ${q.prompt}${q.allowMultiple ? "（可多选）" : ""}`);
    if (q.options.length === 0) {
      lines.push("   （请直接回复）");
      continue;
    }
    for (const [oi, opt] of q.options.entries()) {
      lines.push(`   ${oi + 1}) ${opt.label}`);
    }
  }
  lines.push("");
  const hasOptions = ask.questions.some((q) => q.options.length > 0);
  lines.push(
    hasOptions
      ? ask.questions.length === 1
        ? "回复编号继续（多选如 1,3），也可点卡片按钮。"
        : "回复格式如 1:2; 2:1，或直接用文字说明。"
      : "请直接回复答案。",
  );
  return lines.join("\n");
}

export async function replyAskQuestionCard(
  client: Lark.Client,
  messageId: string,
  sessionKey: string,
  ask: ParsedAskQuestion,
): Promise<void> {
  const card = buildAskQuestionCard(sessionKey, ask);
  try {
    await client.im.v1.message.reply({
      path: { message_id: messageId },
      data: {
        content: JSON.stringify(card),
        msg_type: "interactive",
      },
    });
  } catch (err) {
    console.warn("[feishu] interactive ask card failed, falling back to text:", err);
    await replyText(client, messageId, formatAskQuestionFallbackText(ask), {
      preferMarkdown: true,
    });
  }
}

export function parseCardActionValue(raw: unknown): CardActionValue | undefined {
  const obj =
    typeof raw === "string"
      ? (JSON.parse(raw) as Record<string, unknown>)
      : raw && typeof raw === "object"
        ? (raw as Record<string, unknown>)
        : undefined;
  if (!obj || obj.kind !== "askq") return undefined;
  if (
    typeof obj.sk !== "string" ||
    typeof obj.qid !== "string" ||
    typeof obj.oid !== "string"
  ) {
    return undefined;
  }
  return { kind: "askq", sk: obj.sk, qid: obj.qid, oid: obj.oid };
}

export function extractCardAction(data: unknown): {
  value?: CardActionValue;
  chatId?: string;
  messageId?: string;
  openId?: string;
} {
  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const event =
    root.event && typeof root.event === "object"
      ? (root.event as Record<string, unknown>)
      : root;
  const action =
    event.action && typeof event.action === "object"
      ? (event.action as Record<string, unknown>)
      : undefined;
  const context =
    event.context && typeof event.context === "object"
      ? (event.context as Record<string, unknown>)
      : undefined;
  const operator =
    event.operator && typeof event.operator === "object"
      ? (event.operator as Record<string, unknown>)
      : undefined;

  let value: CardActionValue | undefined;
  try {
    value = parseCardActionValue(action?.value);
  } catch {
    value = undefined;
  }

  return {
    value,
    chatId:
      (typeof context?.open_chat_id === "string" && context.open_chat_id) ||
      (typeof event.open_chat_id === "string" && event.open_chat_id) ||
      undefined,
    messageId:
      (typeof context?.open_message_id === "string" && context.open_message_id) ||
      undefined,
    openId:
      (typeof operator?.open_id === "string" && operator.open_id) || undefined,
  };
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function listOptionsText(questions: AskQuestion[]): string {
  return questions
    .map((q, qi) => {
      const opts = q.options.map((o, oi) => `  ${oi + 1}. ${o.label}`).join("\n");
      return `${qi + 1}) ${q.prompt}\n${opts}`;
    })
    .join("\n\n");
}
