import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export type GuideLink = {
  label: string;
  url: string;
};

export type FieldGuide = {
  title: string;
  lines: string[];
  links?: GuideLink[];
};

export type Prompter = {
  section: (title: string) => void;
  guide: (guide: FieldGuide) => void;
  ask: (label: string, defaultValue?: string) => Promise<string>;
  askRequired: (label: string) => Promise<string>;
  askWithGuide: (guide: FieldGuide, label: string, options?: { required?: boolean; defaultValue?: string }) => Promise<string>;
  askYesNoWithGuide: (guide: FieldGuide, label: string, defaultValue?: boolean) => Promise<boolean>;
  askYesNo: (label: string, defaultValue?: boolean) => Promise<boolean>;
  close: () => void;
};

export function createPrompter(): Prompter {
  const rl = readline.createInterface({ input, output });

  function section(title: string): void {
    console.log(`\n${title}`);
    console.log("─".repeat(Math.min(title.length + 4, 60)));
  }

  function guide(g: FieldGuide): void {
    console.log(`\n▸ ${g.title}`);
    for (const line of g.lines) {
      console.log(`  ${line}`);
    }
    if (g.links?.length) {
      for (const link of g.links) {
        console.log(`  → ${link.label}: ${link.url}`);
      }
    }
  }

  async function ask(label: string, defaultValue?: string): Promise<string> {
    const hint =
      defaultValue !== undefined && defaultValue !== ""
        ? ` [默认: ${defaultValue}]`
        : "";
    const answer = (await rl.question(`${label}${hint}: `)).trim();
    if (!answer && defaultValue !== undefined) return defaultValue;
    return answer;
  }

  async function askRequired(label: string): Promise<string> {
    while (true) {
      const answer = (await rl.question(`${label}: `)).trim();
      if (answer) return answer;
      console.log("  此项必填，请重新输入。");
    }
  }

  async function askWithGuide(
    g: FieldGuide,
    label: string,
    options?: { required?: boolean; defaultValue?: string },
  ): Promise<string> {
    guide(g);
    if (options?.required) {
      return askRequired(label);
    }
    return ask(label, options?.defaultValue);
  }

  async function askYesNo(label: string, defaultValue = false): Promise<boolean> {
    const hint = defaultValue ? "Y/n" : "y/N";
    const answer = (await rl.question(`${label} [${hint}]: `)).trim().toLowerCase();
    if (!answer) return defaultValue;
    if (["y", "yes", "是", "1", "true"].includes(answer)) return true;
    if (["n", "no", "否", "0", "false"].includes(answer)) return false;
    console.log("  请输入 y 或 n。");
    return askYesNo(label, defaultValue);
  }

  async function askYesNoWithGuide(
    g: FieldGuide,
    label: string,
    defaultValue = false,
  ): Promise<boolean> {
    guide(g);
    return askYesNo(label, defaultValue);
  }

  return {
    section,
    guide,
    ask,
    askRequired,
    askWithGuide,
    askYesNoWithGuide,
    askYesNo,
    close: () => rl.close(),
  };
}
