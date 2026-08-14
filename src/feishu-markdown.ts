/** Heuristic: does this look like markdown worth rendering? */
export function looksLikeMarkdown(text: string): boolean {
  if (!text || text.trim().length < 2) return false;

  const t = text.trim();
  if (/```[\s\S]*?```/.test(t)) return true;
  if (/`[^`\n]+`/.test(t)) return true;
  if (/^#{1,6}\s+/m.test(t)) return true;
  if (/\*\*[^*\n]+\*\*/.test(t)) return true;
  if (/(^|\s)\*[^*\n]+\*(\s|$)/.test(t)) return true;
  if (/^[-*+]\s+/m.test(t)) return true;
  if (/^\d+\.\s+/m.test(t)) return true;
  if (/\[[^\]]+\]\([^)]+\)/.test(t)) return true;
  if (/^\|.+\|/m.test(t)) return true;
  if (/^>\s+/m.test(t)) return true;
  if (/~~[^~]+~~/.test(t)) return true;

  // Multi-paragraph agent replies often contain markdown even if subtle
  if (t.includes("\n") && t.length > 120) return true;

  return false;
}

/** Agent replies: prefer rendered markdown whenever plausible. */
export function shouldRenderAgentReply(text: string): boolean {
  return looksLikeMarkdown(text) || text.includes("\n\n") || text.length > 400;
}

/** Feishu post message with md tag (CommonMark + GFM). */
export function buildPostMdContent(text: string): string {
  return JSON.stringify({
    zh_cn: {
      content: [[{ tag: "md", text: optimizeMarkdownForFeishu(text) }]],
    },
  });
}

/** Feishu post renders H1/H2 oversized — demote headings slightly. */
function optimizeMarkdownForFeishu(text: string): string {
  if (!/^#{1,3} /m.test(text)) return text;
  let r = text.replace(/^#{2,6} (.+)$/gm, "##### $1");
  r = r.replace(/^# (.+)$/gm, "#### $1");
  return r.replace(/\n{3,}/g, "\n\n");
}

/** Interactive card 2.0 with markdown element (fallback). */
export function buildMarkdownCard(text: string): Record<string, unknown> {
  return {
    schema: "2.0",
    config: { wide_screen_mode: true },
    body: {
      elements: [
        {
          tag: "markdown",
          content: text,
          text_align: "left",
        },
      ],
    },
  };
}

/** Split long replies; post/card limit ~30KB, keep headroom. */
export function splitReplyChunks(text: string, markdown: boolean): string[] {
  const max = markdown ? 28_000 : 3_500;
  if (text.length <= max) return [text];

  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n\n", max);
    if (cut < max * 0.4) cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.4) cut = max;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}
