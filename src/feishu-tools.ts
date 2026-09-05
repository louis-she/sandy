import fs from "node:fs";
import path from "node:path";
import type * as Lark from "@larksuiteoapi/node-sdk";
import type { SDKCustomTool, SDKJsonValue } from "@cursor/sdk";
import { config } from "./config.js";
import {
  fallbackAskFromRaw,
  parseAskQuestionArgs,
  type ParsedAskQuestion,
} from "./ask-question.js";
import type { AskAnswer } from "./ask-waiters.js";
import {
  appendMarkdownToDocument,
  createDocument,
  createDocumentWithMarkdown,
  readDocumentText,
} from "./feishu-docs.js";
import { replyLocalPath } from "./feishu-files.js";

function asString(v: SDKJsonValue | undefined, name: string): string {
  if (typeof v !== "string" || !v.trim()) {
    throw new Error(`missing string arg: ${name}`);
  }
  return v.trim();
}

function resolveAgentPath(raw: string): string {
  const expanded = raw.startsWith("~/")
    ? path.join(process.env.HOME || "", raw.slice(2))
    : raw;
  const abs = path.isAbsolute(expanded)
    ? expanded
    : path.resolve(config.agentCwd, expanded);
  if (!fs.existsSync(abs)) {
    throw new Error(`file not found: ${abs}`);
  }
  return abs;
}

export type FeishuToolContext = {
  client: Lark.Client;
  replyToMessageId: string;
  chatId: string;
  onAskQuestion?: (ask: ParsedAskQuestion) => Promise<AskAnswer[]>;
};

/** In-process tools exposed to the Cursor agent as custom-user-tools. */
export function buildFeishuCustomTools(
  ctx: FeishuToolContext,
): Record<string, SDKCustomTool> {
  return {
    feishu_ask_question: {
      description:
        "Ask the Feishu user blocking questions in a SINGLE round and wait for their reply. " +
        "Put every decision you need into this one call (max 4 questions). " +
        "The user cannot see Cursor's AskQuestion UI — never write “等你回上面的题” without this tool. " +
        "Do NOT call this tool again in the same turn after they answer. " +
        "If you can pick a reasonable default, skip asking, state the assumption in one line, and proceed.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Optional card title" },
          questions: {
            type: "array",
            description: "Questions to show in Feishu",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                prompt: { type: "string", description: "Question text shown to the user" },
                options: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      id: { type: "string" },
                      label: { type: "string" },
                    },
                  },
                },
                allowMultiple: { type: "boolean" },
              },
              required: ["prompt"],
            },
          },
        },
        required: ["questions"],
      },
      async execute(args) {
        try {
          if (!ctx.onAskQuestion) {
            throw new Error("onAskQuestion is not configured");
          }
          const parsed =
            parseAskQuestionArgs(args) ?? fallbackAskFromRaw(args);
          const answers = await ctx.onAskQuestion(parsed);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: true,
                  answers,
                  instruction:
                    "User answered. Finish this turn with those choices. Do not ask another round.",
                }),
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: `feishu_ask_question cancelled: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      },
    },
    feishu_send_file: {
      description:
        "Send a local file or image to the current Feishu chat as a reply. " +
        "Pass an absolute path or a path relative to AGENT_CWD. Images (.png/.jpg/…) " +
        "are sent as image messages; other types as file messages.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Local file path to send",
          },
        },
        required: ["path"],
      },
      async execute(args) {
        try {
          const filePath = resolveAgentPath(asString(args.path, "path"));
          const result = await replyLocalPath(
            ctx.client,
            ctx.replyToMessageId,
            filePath,
          );
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: true,
                  kind: result.kind,
                  fileName: result.fileName,
                  path: filePath,
                }),
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: `feishu_send_file failed: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      },
    },

    feishu_doc_read: {
      description:
        "Read a Feishu docx document as plain text. Pass a document_id or a full " +
        "https://…/docx/<id> URL. The bot must be a collaborator with read access.",
      inputSchema: {
        type: "object",
        properties: {
          document: {
            type: "string",
            description: "Document id or Feishu docx URL",
          },
        },
        required: ["document"],
      },
      async execute(args) {
        try {
          const content = await readDocumentText(
            ctx.client,
            asString(args.document, "document"),
          );
          return {
            content: [{ type: "text", text: content || "(empty document)" }],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: `feishu_doc_read failed: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      },
    },

    feishu_doc_create: {
      description:
        "Create a new Feishu docx with a title and optional markdown body. " +
        "Optional folder_token places it in a Drive folder (or set FEISHU_DOCS_FOLDER). " +
        "Returns document_id. Bot must have create permission and folder access.",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Document title" },
          markdown: {
            type: "string",
            description: "Initial markdown content (optional)",
          },
          folder_token: {
            type: "string",
            description: "Optional Drive folder token",
          },
        },
        required: ["title"],
      },
      async execute(args) {
        try {
          const title = asString(args.title, "title");
          const markdown =
            typeof args.markdown === "string" ? args.markdown : "";
          const folderToken =
            (typeof args.folder_token === "string" && args.folder_token.trim()) ||
            config.feishuDocsFolder ||
            undefined;

          if (!markdown.trim()) {
            const doc = await createDocument(ctx.client, {
              title,
              folderToken,
            });
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    ok: true,
                    documentId: doc.documentId,
                    title: doc.title,
                    urlHint: `docx/${doc.documentId}`,
                  }),
                },
              ],
            };
          }

          const doc = await createDocumentWithMarkdown(ctx.client, {
            title,
            markdown,
            folderToken,
          });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ok: true,
                  documentId: doc.documentId,
                  title: doc.title,
                  blockCount: doc.blockCount,
                  urlHint: `docx/${doc.documentId}`,
                }),
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: `feishu_doc_create failed: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      },
    },

    feishu_doc_append: {
      description:
        "Append markdown content to an existing Feishu docx. Pass document_id or URL. " +
        "Bot must be a collaborator with edit permission.",
      inputSchema: {
        type: "object",
        properties: {
          document: {
            type: "string",
            description: "Document id or Feishu docx URL",
          },
          markdown: {
            type: "string",
            description: "Markdown to append",
          },
        },
        required: ["document", "markdown"],
      },
      async execute(args) {
        try {
          const result = await appendMarkdownToDocument(
            ctx.client,
            asString(args.document, "document"),
            asString(args.markdown, "markdown"),
          );
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ ok: true, ...result }),
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: `feishu_doc_append failed: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
            isError: true,
          };
        }
      },
    },
  };
}
