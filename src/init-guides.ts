import type { FieldGuide } from "./prompt.js";

const FEISHU_APP_HOME: FieldGuide = {
  title: "飞书开放平台",
  lines: ["企业自建应用的入口，下面几项都在同一个应用里配置。"],
  links: [{ label: "打开飞书开发者后台", url: "https://open.feishu.cn/app" }],
};

export const INIT_FIELD_GUIDES = {
  feishuAppId: {
    title: "飞书 App ID",
    lines: [
      "在飞书开发者后台创建「企业自建应用」后获取。",
      "路径：你的应用 → 凭证与基础信息 → App ID",
      "格式通常以 cli_ 开头。",
    ],
    links: [
      { label: "飞书开发者后台", url: "https://open.feishu.cn/app" },
      {
        label: "创建应用说明",
        url: "https://open.feishu.cn/document/home/introduction-to-custom-app-development/self-built-application-development-process",
      },
    ],
  } satisfies FieldGuide,

  feishuAppSecret: {
    title: "飞书 App Secret",
    lines: [
      "与 App ID 在同一页：凭证与基础信息 → App Secret",
      "点击「显示」或「重置」后复制；勿泄露或提交到 git。",
    ],
    links: [{ label: "飞书开发者后台", url: "https://open.feishu.cn/app" }],
  } satisfies FieldGuide,

  feishuSetupHint: {
    title: "飞书后台还需完成（init 不会替你操作）",
    lines: [
      "1. 应用能力 → 开通「机器人」",
      "2. 权限管理 → 开通消息 / 文件 / 文档等权限，并发布新版本",
      "3. 事件与回调 → 订阅方式选「长连接」",
      "   事件：im.message.receive_v1；回调：card.action.trigger",
      "4. 先在本机运行 sandy，看到 ws client ready 后再在后台保存长连接配置",
    ],
    links: [
      { label: "事件订阅（长连接）", url: "https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/event-subscription-guide/long-connection-mode" },
      { label: "机器人能力说明", url: "https://open.feishu.cn/document/uAjLw4CM/ugTN1YjL4UTN24CO1UjN/trouble-shooting/how-to-enable-bot-ability" },
    ],
  } satisfies FieldGuide,

  cursorApiKey: {
    title: "Cursor API Key",
    lines: [
      "在 Cursor 账号设置里创建，用于 @cursor/sdk 调用本地 Agent。",
      "路径：Cursor Settings → Integrations / API Keys（或 Dashboard 中的 API Keys）",
      "格式通常以 crsr_ 开头。",
    ],
    links: [
      { label: "Cursor 设置", url: "https://cursor.com/settings" },
      { label: "Cursor SDK 文档", url: "https://cursor.com/docs/sdk/typescript" },
    ],
  } satisfies FieldGuide,

  agentName: {
    title: "Agent 显示名",
    lines: [
      "仅影响日志与 Cursor 侧 Agent 标题，飞书里仍显示机器人在后台设置的名称。",
      "直接回车使用默认 Sandy 即可。",
    ],
  } satisfies FieldGuide,

  agentCwd: {
    title: "Agent 工作目录",
    lines: [
      "Agent 读写代码、加载 .cursor/rules 的根目录。",
      "建议设为你要放 config.yaml 的目录（例如 ~/treedome）。",
      "支持 ~ 与绝对路径；相对路径相对于运行 sandy 时的 cwd。",
    ],
  } satisfies FieldGuide,

  agentDirs: {
    title: "额外可访问目录（可选）",
    lines: [
      "除工作目录外，Agent 还可以访问哪些路径（多仓库 / 多项目时用）。",
      "多个目录用英文逗号分隔，例如：~/code/api,~/code/web",
      "留空表示仅使用上面的工作目录。",
    ],
  } satisfies FieldGuide,

  agentDirLinks: {
    title: "工作目录下的 symlink（可选）",
    lines: [
      "若 agent.cwd 里有 symlink（如 api → ~/code/api），填链接名以便一并放行。",
      "多个名称用英文逗号分隔；留空可跳过。",
    ],
  } satisfies FieldGuide,

  agentSandbox: {
    title: "Cursor 本地沙箱",
    lines: [
      "开启后 Agent 的 shell/文件操作走 Cursor 沙箱，默认禁止随意访问网络。",
      "需要 SSH、git push、deploy 等本机能力时选「否」。",
      "一般个人机器上建议关闭（默认）。",
    ],
    links: [
      { label: "SDK 沙箱说明", url: "https://cursor.com/docs/sdk/typescript#sandbox-options" },
    ],
  } satisfies FieldGuide,

  cursorModel: {
    title: "Cursor 模型",
    lines: [
      "传给 @cursor/sdk 的 model id。",
      "auto 表示由 Cursor 自动选择；也可填具体模型名。",
      "直接回车使用 auto。",
    ],
    links: [{ label: "Cursor 模型与 SDK", url: "https://cursor.com/docs/sdk/typescript" }],
  } satisfies FieldGuide,

  feishuDocsFolder: {
    title: "飞书文档默认文件夹（可选）",
    lines: [
      "feishu_doc_create 创建文档时默认放到哪个云空间文件夹。",
      "在飞书云文档打开目标文件夹，从 URL 或文件夹属性里复制 folder_token。",
      "不需要自动归档文档可留空。",
    ],
    links: [
      { label: "创建文档 API", url: "https://open.feishu.cn/document/server-docs/docs/docs/docx-v1/document/create" },
    ],
  } satisfies FieldGuide,

  feishuAppHome: FEISHU_APP_HOME,
} as const;
