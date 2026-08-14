export type AskOption = {
  id: string;
  label: string;
};

export type AskQuestion = {
  id: string;
  prompt: string;
  options: AskOption[];
  allowMultiple: boolean;
};

export type ParsedAskQuestion = {
  title?: string;
  questions: AskQuestion[];
  callId?: string;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function parseOptions(raw: unknown): AskOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      const obj = asRecord(item);
      if (!obj) return undefined;
      const id =
        typeof obj.id === "string"
          ? obj.id
          : typeof obj.value === "string"
            ? obj.value
            : `opt_${index + 1}`;
      const label =
        typeof obj.label === "string"
          ? obj.label
          : typeof obj.text === "string"
            ? obj.text
            : typeof obj.title === "string"
              ? obj.title
              : String(id);
      return { id, label };
    })
    .filter((x): x is AskOption => Boolean(x));
}

function parseQuestions(raw: unknown): AskQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => {
      const obj = asRecord(item);
      if (!obj) return undefined;
      const id =
        typeof obj.id === "string"
          ? obj.id
          : typeof obj.questionId === "string"
            ? obj.questionId
            : `q_${index + 1}`;
      const prompt =
        typeof obj.prompt === "string"
          ? obj.prompt
          : typeof obj.question === "string"
            ? obj.question
            : typeof obj.text === "string"
              ? obj.text
              : `问题 ${index + 1}`;
      const options = parseOptions(obj.options ?? obj.choices);
      if (options.length === 0) return undefined;
      return {
        id,
        prompt,
        options,
        allowMultiple: Boolean(obj.allowMultiple ?? obj.allow_multiple ?? obj.multiSelect),
      };
    })
    .filter((x): x is AskQuestion => Boolean(x));
}

/** Defensive parse of askQuestion tool args / tool_use input. */
export function parseAskQuestionArgs(args: unknown): ParsedAskQuestion | undefined {
  const root = asRecord(args);
  if (!root) return undefined;

  const nested =
    asRecord(root.args) ??
    asRecord(root.input) ??
    asRecord(root.arguments) ??
    root;

  const questions = parseQuestions(
    nested.questions ?? nested.question_list ?? nested.items,
  );
  if (questions.length === 0) {
    // Single-question flattened shape
    const options = parseOptions(nested.options ?? nested.choices);
    if (options.length > 0) {
      questions.push({
        id: typeof nested.id === "string" ? nested.id : "q1",
        prompt:
          typeof nested.prompt === "string"
            ? nested.prompt
            : typeof nested.question === "string"
              ? nested.question
              : typeof nested.title === "string"
                ? nested.title
                : "请选择",
        options,
        allowMultiple: Boolean(nested.allowMultiple ?? nested.allow_multiple),
      });
    }
  }

  if (questions.length === 0) return undefined;

  return {
    title: typeof nested.title === "string" ? nested.title : undefined,
    questions,
  };
}

export function isAskQuestionToolName(name: string | undefined): boolean {
  if (!name) return false;
  const n = name.replace(/[_-]/g, "").toLowerCase();
  return n === "askquestion" || n.endsWith("askquestion");
}

/** Format selected answers as a follow-up user message for Agent.send. */
export function formatAnswerPrompt(
  questions: AskQuestion[],
  answers: Array<{ questionId: string; selectedOptionIds: string[]; freeformText?: string }>,
): string {
  const lines = ["【用户已完成选择题】请根据以下选择继续："];
  for (const q of questions) {
    const answer = answers.find((a) => a.questionId === q.id);
    if (!answer) {
      lines.push(`- ${q.prompt}: （未选择）`);
      continue;
    }
    if (answer.freeformText?.trim()) {
      lines.push(`- ${q.prompt}: ${answer.freeformText.trim()}`);
      continue;
    }
    const labels = answer.selectedOptionIds.map((id) => {
      const opt = q.options.find((o) => o.id === id);
      return opt ? `${opt.label} (id=${opt.id})` : id;
    });
    lines.push(`- ${q.prompt}: ${labels.join("、")}`);
  }
  return lines.join("\n");
}

/**
 * Parse a free-text reply against pending questions.
 * Supports: "1", "1,3", "选项原文", or "q1=1; q2=2".
 */
export function parseTextAnswer(
  questions: AskQuestion[],
  text: string,
): Array<{ questionId: string; selectedOptionIds: string[]; freeformText?: string }> | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;

  if (questions.length === 1) {
    const q = questions[0]!;
    const byLabel = q.options.find(
      (o) => o.label === trimmed || o.id === trimmed,
    );
    if (byLabel) {
      return [{ questionId: q.id, selectedOptionIds: [byLabel.id] }];
    }

    const nums = trimmed
      .split(/[,，\s]+/)
      .map((p) => Number.parseInt(p, 10))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= q.options.length);

    if (nums.length > 0) {
      const ids = [...new Set(nums)].map((n) => q.options[n - 1]!.id);
      if (!q.allowMultiple && ids.length > 1) return undefined;
      return [{ questionId: q.id, selectedOptionIds: ids }];
    }

    // Freeform fallback for single question
    return [{ questionId: q.id, selectedOptionIds: [], freeformText: trimmed }];
  }

  // Multi-question: expect "1:1; 2:2" or "q1=label"
  const parts = trimmed.split(/[;；\n]+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return undefined;

  const answers: Array<{ questionId: string; selectedOptionIds: string[]; freeformText?: string }> = [];
  for (const part of parts) {
    const m = part.match(/^(?:q\s*)?(\d+|[A-Za-z0-9_-]+)\s*[=:：]\s*(.+)$/);
    if (!m) return undefined;
    const key = m[1]!;
    const value = m[2]!.trim();
    const q =
      questions.find((qq) => qq.id === key) ??
      ( /^\d+$/.test(key) ? questions[Number(key) - 1] : undefined);
    if (!q) return undefined;

    const idxs = value
      .split(/[,，\s]+/)
      .map((p) => Number.parseInt(p, 10))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= q.options.length);

    if (idxs.length > 0) {
      answers.push({
        questionId: q.id,
        selectedOptionIds: [...new Set(idxs)].map((n) => q.options[n - 1]!.id),
      });
      continue;
    }

    const opt = q.options.find((o) => o.label === value || o.id === value);
    if (opt) {
      answers.push({ questionId: q.id, selectedOptionIds: [opt.id] });
      continue;
    }

    answers.push({ questionId: q.id, selectedOptionIds: [], freeformText: value });
  }

  return answers.length > 0 ? answers : undefined;
}
