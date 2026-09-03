# Feishu ↔ Cursor Bot

[![npm version](https://img.shields.io/npm/v/@chenglu.she/sandy)](https://www.npmjs.com/package/@chenglu.she/sandy)

<p align="center">
  <img src="assets/sandy.png" alt="Sandy" width="220" height="220" />
</p>

<p align="center"><b>Sandy</b> — 飞书长连接机器人。</p>

通用脚手架：在工作目录放一份 `config.yaml` +（可选）`.cursor/rules`，装好依赖后启动即可。

## 需要什么

- Node.js ≥ 20
- [飞书企业自建应用](https://open.feishu.cn/)（开通机器人 + 长连接事件）
- [Cursor API Key](https://cursor.com/settings)

## Setup

### 1. 安装

`npm install -g @chenglu.she/sandy`

### 2. 初始化配置

在你要运行 bot 的目录执行（例如 `~/treedome`）：

```bash
mkdir -p ~/treedome && cd ~/treedome
sandy init
```

会交互式询问飞书 / Cursor / Agent 等项，写入 `config.yaml`；在 macOS 上接着触发磁盘授权弹窗（桌面 / 文稿 / 下载等）。人设模板见 [templates/sandy.mdc](./templates/sandy.mdc)，可复制到 `.cursor/rules/`。

新机器务必在**电脑屏幕前**跑 init（不要 SSH）：弹出的「node 想访问某某文件夹」全部点「允许」，并把提示里的 Node 路径加到「完全磁盘访问权限」。以后单独补授权：

```bash
sandy authorize   # 别名：sandy diskauth
```

必填项：

| 配置项 | 说明 |
|------|------|
| `feishu.appId` | 飞书应用 App ID |
| `feishu.appSecret` | 飞书应用 Secret |
| `cursor.apiKey` | Cursor API Key |

常用可选项：

| 配置项 | 默认 | 说明 |
|------|------|------|
| `agent.name` | `Sandy` | Agent 显示名 |
| `agent.cwd` | 工作目录 | Agent 工作区（会加载这里的 `.cursor/rules`） |
| `agent.dirs` | `[]` | 额外可访问目录 |
| `agent.dirLinks` | `[]` | `agent.cwd` 下要一并放行的 symlink 名 |
| `agent.sandbox` | `false` | `true` 时开 Cursor 本地沙箱 |
| `cursor.model` | `auto` | 模型 id |
| `feishuDocsFolder` | （空） | 创建飞书文档时的默认 Drive `folder_token` |

### 3. （推荐）放项目规则

在 `agent.cwd`（默认就是运行目录）下：

```text
.cursor/rules/your-persona.mdc
.cursor/rules/your-domain.mdc
```

Agent 通过 `settingSources: ["project"]` 加载这些规则。人设、业务知识都写在这里，**不要写进 bot 源码**。

### 4. 飞书后台

1. **应用能力** → 开通 **机器人**
2. **权限**（开通后**发布新版本**才生效），至少：
   - **单聊**：`im:message.p2p_msg:readonly`（只有群聊 @ 能回、私聊没反应，通常是缺这个）
   - **群聊 @**：`im:message.group_at_msg:readonly`
   - **发消息**：`im:message`
   - 文件：上传/下载（`im:resource` 等）
   - 文档：读/写 docx（按需）
3. **版本管理**：发布；**可用范围**包含你自己
4. **事件与回调** → 长连接（先 `sandy` 在线再保存）
5. 事件 `im.message.receive_v1`：点进去确认 **单聊消息**、**群聊 @ 机器人** 子开关都已开通
6. 回调：`card.action.trigger`
7. **读写已有文档**：把机器人加为文档协作者

### 5. 启动

```bash
cd ~/treedome
sandy
```

看到 `ws client ready` 后，飞书里私聊机器人即可。远程任务卡住、回家才看到 node 访问目录的授权框，再跑一次 `sandy authorize`。

#### macOS 常驻（可选）

本仓库带了 launchd 包装，避免挂在 IDE 终端里被杀掉：

```bash
bash scripts/sandy-ctl.sh install
bash scripts/sandy-ctl.sh status
bash scripts/sandy-ctl.sh logs
```

> plist 里是本机绝对路径，换机器请改 `deploy/cn.sandy.plist` 或自己写一份 LaunchAgent。

## 行为速览

| 场景 | 行为 |
|------|------|
| 私聊 | 文本 / 文件 / 图片进 Agent |
| 群聊 | 仅当 @机器人（文件同理，需 @） |
| 同会话 | `Agent.resume` 多轮；映射在 cwd 的 `.data/sessions.json` |
| `/new` `/reset` `重置` `新对话` | 清空会话，下次新建 Agent |
| 连续消息 | 按会话排队；排队 `OneSecond`，处理中 `OnIt` |
| `askQuestion` | 走 `feishu_ask_question`：飞书先发题目正文，再发可点选卡片；点选或回编号后续跑 |
| 用户发文件/图 | 下载到 `AGENT_CWD/.data/feishu-inbox/…`，路径写入 prompt |
| Agent 发回文件 | 工具 `feishu_send_file`（本地路径 → 飞书回复） |
| 飞书文档 | `feishu_doc_read` / `feishu_doc_create` / `feishu_doc_append` |

## 开发

```bash
npm run dev        # tsx watch
npm start          # 等同 sandy（读 cwd config.yaml）
npm run typecheck
```

## License

[MIT](./LICENSE)
