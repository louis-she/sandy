import fs from "node:fs";
import path from "node:path";

export type SessionRecord = {
  agentId: string;
  updatedAt: string;
};

type SessionMap = Record<string, SessionRecord>;

export class SessionStore {
  private data: SessionMap = {};

  constructor(private readonly filePath: string) {
    this.load();
  }

  get(sessionKey: string): SessionRecord | undefined {
    return this.data[sessionKey];
  }

  set(sessionKey: string, agentId: string): void {
    this.data[sessionKey] = {
      agentId,
      updatedAt: new Date().toISOString(),
    };
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
      const raw = fs.readFileSync(this.filePath, "utf8");
      this.data = JSON.parse(raw) as SessionMap;
    } catch (err) {
      console.warn("[session] failed to load store, starting empty:", err);
      this.data = {};
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf8");
  }
}
