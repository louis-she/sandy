import * as Lark from "@larksuiteoapi/node-sdk";
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

