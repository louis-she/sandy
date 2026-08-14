import type * as Lark from "@larksuiteoapi/node-sdk";

/** Extract docx document_id from a Feishu URL or bare id. */
export function parseDocumentId(input: string): string {
  const trimmed = input.trim();
  const m = trimmed.match(/\/docx\/([A-Za-z0-9]+)/);
  if (m?.[1]) return m[1];
  if (/^[A-Za-z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  throw new Error(
    `invalid document id/url: ${input} (expect …/docx/<id> or bare document_id)`,
  );
}

export async function readDocumentText(
  client: Lark.Client,
  documentIdOrUrl: string,
): Promise<string> {
  const document_id = parseDocumentId(documentIdOrUrl);
  const res = await client.docx.v1.document.rawContent({
    path: { document_id },
  });
  if (res.code && res.code !== 0) {
    throw new Error(`read doc failed: code=${res.code} msg=${res.msg}`);
  }
  return res.data?.content ?? "";
}

export async function createDocument(
  client: Lark.Client,
  options: { title: string; folderToken?: string },
): Promise<{ documentId: string; title: string }> {
  const res = await client.docx.v1.document.create({
    data: {
      title: options.title,
      ...(options.folderToken ? { folder_token: options.folderToken } : {}),
    },
  });
  if (res.code && res.code !== 0) {
    throw new Error(`create doc failed: code=${res.code} msg=${res.msg}`);
  }
  const documentId = res.data?.document?.document_id;
  if (!documentId) {
    throw new Error(`create doc returned no document_id: ${JSON.stringify(res)}`);
  }
  return {
    documentId,
    title: res.data?.document?.title || options.title,
  };
}

/**
 * Convert markdown and insert as nested blocks under the page root
 * (block_id === document_id for docx).
 */
export async function appendMarkdownToDocument(
  client: Lark.Client,
  documentIdOrUrl: string,
  markdown: string,
): Promise<{ blockCount: number }> {
  const document_id = parseDocumentId(documentIdOrUrl);
  const md = markdown.trim();
  if (!md) throw new Error("markdown content is empty");

  const converted = await client.docx.v1.document.convert({
    data: {
      content_type: "markdown",
      content: md,
    },
  });
  if (converted.code && converted.code !== 0) {
    throw new Error(
      `convert markdown failed: code=${converted.code} msg=${converted.msg}`,
    );
  }

  const childrenId = converted.data?.first_level_block_ids ?? [];
  const descendants = converted.data?.blocks ?? [];
  if (childrenId.length === 0 || descendants.length === 0) {
    throw new Error("convert markdown produced no blocks");
  }

  // Insert in chunks of <= 1000 blocks if needed; convert already returns tree.
  const res = await client.docx.v1.documentBlockDescendant.create({
    path: {
      document_id,
      block_id: document_id,
    },
    data: {
      children_id: childrenId,
      // convert() returns a loose block tree; the create payload is generated and huge.
      descendants: descendants as never,
    },
  });
  if (res.code && res.code !== 0) {
    throw new Error(
      `append blocks failed: code=${res.code} msg=${res.msg} — 确认机器人已是文档协作者且有编辑权限`,
    );
  }

  return { blockCount: descendants.length };
}

export async function createDocumentWithMarkdown(
  client: Lark.Client,
  options: { title: string; markdown: string; folderToken?: string },
): Promise<{ documentId: string; title: string; blockCount: number }> {
  const doc = await createDocument(client, {
    title: options.title,
    folderToken: options.folderToken,
  });
  const { blockCount } = await appendMarkdownToDocument(
    client,
    doc.documentId,
    options.markdown,
  );
  return { ...doc, blockCount };
}
