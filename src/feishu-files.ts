import fs from "node:fs";
import path from "node:path";
import type * as Lark from "@larksuiteoapi/node-sdk";

export type FeishuUploadFileType =
  | "opus"
  | "mp4"
  | "pdf"
  | "doc"
  | "xls"
  | "ppt"
  | "stream";

const EXT_TO_TYPE: Record<string, FeishuUploadFileType> = {
  ".opus": "opus",
  ".mp4": "mp4",
  ".pdf": "pdf",
  ".doc": "doc",
  ".docx": "doc",
  ".xls": "xls",
  ".xlsx": "xls",
  ".ppt": "ppt",
  ".pptx": "ppt",
};

export function guessFileType(fileName: string): FeishuUploadFileType {
  return EXT_TO_TYPE[path.extname(fileName).toLowerCase()] ?? "stream";
}

/** Upload a local file; returns file_key for sending as a message. */
export async function uploadFile(
  client: Lark.Client,
  filePath: string,
  options?: { fileName?: string; fileType?: FeishuUploadFileType },
): Promise<{ fileKey: string; fileName: string }> {
  const fileName = options?.fileName || path.basename(filePath);
  const fileType = options?.fileType || guessFileType(fileName);
  const buf = fs.readFileSync(filePath);
  if (buf.length === 0) throw new Error(`empty file: ${filePath}`);
  if (buf.length > 30 * 1024 * 1024) {
    throw new Error(`file too large (>30MB): ${filePath}`);
  }

  const res = await client.im.v1.file.create({
    data: {
      file_type: fileType,
      file_name: fileName,
      file: buf,
    },
  });

  const fileKey = res?.file_key;
  if (!fileKey) {
    throw new Error(`upload file failed: ${JSON.stringify(res)}`);
  }
  return { fileKey, fileName };
}

/** Upload a local image; returns image_key. */
export async function uploadImage(
  client: Lark.Client,
  filePath: string,
): Promise<string> {
  const buf = fs.readFileSync(filePath);
  if (buf.length === 0) throw new Error(`empty image: ${filePath}`);
  if (buf.length > 10 * 1024 * 1024) {
    throw new Error(`image too large (>10MB): ${filePath}`);
  }

  const res = await client.im.v1.image.create({
    data: {
      image_type: "message",
      image: buf,
    },
  });

  const imageKey = res?.image_key;
  if (!imageKey) {
    throw new Error(`upload image failed: ${JSON.stringify(res)}`);
  }
  return imageKey;
}

/** Reply with a file message. */
export async function replyFile(
  client: Lark.Client,
  messageId: string,
  filePath: string,
): Promise<void> {
  const { fileKey } = await uploadFile(client, filePath);
  await client.im.v1.message.reply({
    path: { message_id: messageId },
    data: {
      msg_type: "file",
      content: JSON.stringify({ file_key: fileKey }),
    },
  });
}

/** Reply with an image message. */
export async function replyImage(
  client: Lark.Client,
  messageId: string,
  filePath: string,
): Promise<void> {
  const imageKey = await uploadImage(client, filePath);
  await client.im.v1.message.reply({
    path: { message_id: messageId },
    data: {
      msg_type: "image",
      content: JSON.stringify({ image_key: imageKey }),
    },
  });
}

const IMAGE_EXTS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
]);

export function isImagePath(filePath: string): boolean {
  return IMAGE_EXTS.has(path.extname(filePath).toLowerCase());
}

export async function replyLocalPath(
  client: Lark.Client,
  messageId: string,
  filePath: string,
): Promise<{ kind: "file" | "image"; fileName: string }> {
  const fileName = path.basename(filePath);
  if (isImagePath(filePath)) {
    await replyImage(client, messageId, filePath);
    return { kind: "image", fileName };
  }
  await replyFile(client, messageId, filePath);
  return { kind: "file", fileName };
}

/** Download a resource attached to an incoming Feishu message. */
export async function downloadMessageResource(
  client: Lark.Client,
  messageId: string,
  fileKey: string,
  type: "file" | "image" | "media",
  destPath: string,
): Promise<string> {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const resp = await client.im.v1.messageResource.get({
    path: { message_id: messageId, file_key: fileKey },
    params: { type },
  });
  await resp.writeFile(destPath);
  return destPath;
}

export function parseIncomingFileContent(content: string): {
  fileKey?: string;
  imageKey?: string;
  fileName?: string;
} {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return {
      fileKey: typeof parsed.file_key === "string" ? parsed.file_key : undefined,
      imageKey:
        typeof parsed.image_key === "string" ? parsed.image_key : undefined,
      fileName:
        typeof parsed.file_name === "string"
          ? parsed.file_name
          : typeof parsed.name === "string"
            ? parsed.name
            : undefined,
    };
  } catch {
    return {};
  }
}
