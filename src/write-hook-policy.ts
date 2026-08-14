import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

/** Write allowlist for Cursor hooks under AGENT_CWD. */
export function writeHookPolicy(): string {
  const roots = [
    config.agentCwd,
    ...config.agentDirs,
  ].map((p) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);
    }
  });

  for (const name of config.agentDirLinks) {
    const link = path.join(config.agentCwd, name);
    try {
      roots.push(fs.realpathSync(link));
    } catch {
      // ignore missing links
    }
  }

  const policyPath = path.join(config.agentCwd, ".cursor", "hooks", "policy.json");
  fs.mkdirSync(path.dirname(policyPath), { recursive: true });
  const payload = {
    updatedAt: new Date().toISOString(),
    allowedRoots: [...new Set(roots)],
  };
  fs.writeFileSync(policyPath, JSON.stringify(payload, null, 2), "utf8");
  return policyPath;
}
