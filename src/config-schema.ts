/** On-disk config.yaml shape. */
export type SandyConfigFile = {
  feishu: {
    appId: string;
    appSecret: string;
  };
  cursor: {
    apiKey: string;
    model?: string;
  };
  agent?: {
    name?: string;
    cwd?: string;
    dirs?: string[];
    dirLinks?: string[];
    sandbox?: boolean;
  };
  feishuDocsFolder?: string;
};

export function defaultConfigFile(workDir: string): SandyConfigFile {
  return {
    feishu: { appId: "", appSecret: "" },
    cursor: { apiKey: "", model: "auto" },
    agent: {
      name: "Sandy",
      cwd: workDir,
      dirs: [],
      dirLinks: [],
      sandbox: false,
    },
    feishuDocsFolder: "",
  };
}
