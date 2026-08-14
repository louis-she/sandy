import fs from "node:fs";
import path from "node:path";
import type { AskQuestion } from "./ask-question.js";

export type PendingQuestion = {
  agentId: string;
  chatId: string;
  replyToMessageId: string;
  title?: string;
  questions: AskQuestion[];
  partialText?: string;
  createdAt: string;
};

type PendingMap = Record<string, PendingQuestion>;

export class PendingQuestionStore {
  private data: PendingMap = {};

  constructor(private readonly filePath: string) {
    this.load();
  }

  get(sessionKey: string): PendingQuestion | undefined {
    return this.data[sessionKey];
  }

  set(sessionKey: string, pending: PendingQuestion): void {
    this.data[sessionKey] = pending;
    this.save();
  }

  delete(sessionKey: string): void {
    if (!(sessionKey in this.data)) return;
    delete this.data[sessionKey];
    this.save();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.data = {};
        return;
      }
      this.data = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as PendingMap;
    } catch (err) {
      console.warn("[pending] failed to load store:", err);
      this.data = {};
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf8");
  }
}
