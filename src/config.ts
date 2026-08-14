import type { RuntimeConfig } from "./config-io.js";
import { loadRuntimeConfig } from "./config-io.js";

export { expandPath, workDir } from "./config-io.js";
export type { RuntimeConfig };

export const config: RuntimeConfig = loadRuntimeConfig();

export function localAgentOptions() {
  return {
    cwd: config.agentCwd,
    ...(config.agentDirs.length > 0 ? { dirs: config.agentDirs } : {}),
    ...(config.agentSandbox ? { sandboxOptions: { enabled: true as const } } : {}),
    settingSources: ["project" as const],
  };
}
