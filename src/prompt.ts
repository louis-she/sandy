import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export type Prompter = {
  ask: (label: string, defaultValue?: string) => Promise<string>;
  askRequired: (label: string) => Promise<string>;
  askYesNo: (label: string, defaultValue?: boolean) => Promise<boolean>;
  close: () => void;
};

export function createPrompter(): Prompter {
  const rl = readline.createInterface({ input, output });

  async function ask(label: string, defaultValue?: string): Promise<string> {
    const hint =
      defaultValue !== undefined && defaultValue !== ""
        ? ` (${defaultValue})`
        : "";
    const answer = (await rl.question(`${label}${hint}: `)).trim();
    if (!answer && defaultValue !== undefined) return defaultValue;
    return answer;
  }

  async function askRequired(label: string): Promise<string> {
    while (true) {
      const answer = (await rl.question(`${label}: `)).trim();
      if (answer) return answer;
      console.log("此项必填，请重新输入。");
    }
  }

  async function askYesNo(label: string, defaultValue = false): Promise<boolean> {
    const hint = defaultValue ? "Y/n" : "y/N";
    const answer = (await rl.question(`${label} [${hint}]: `)).trim().toLowerCase();
    if (!answer) return defaultValue;
    if (["y", "yes", "是", "1", "true"].includes(answer)) return true;
    if (["n", "no", "否", "0", "false"].includes(answer)) return false;
    console.log("请输入 y 或 n。");
    return askYesNo(label, defaultValue);
  }

  return {
    ask,
    askRequired,
    askYesNo,
    close: () => rl.close(),
  };
}
