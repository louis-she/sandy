import { Agent, CursorAgentError, type SDKCustomTool } from "@cursor/sdk";
import { config, localAgentOptions } from "./config.js";
import type { SessionStore } from "./session-store.js";

export type AgentOutcome = {
  type: "finished";
  text: string;
  agentId: string;
  runId?: string;
  status: string;
};

export type RunCursorAgentOptions = {
  /** Per-turn Feishu tools (reply target changes each message). */
  customTools?: Record<string, SDKCustomTool>;
};

const RESET_COMMANDS = new Set(["/new", "/reset", "重置", "新对话"]);

/** SDK has no AskQuestion UI. Never offer multiple-choice; talk in Feishu. */
const FEISHU_TURN_HINT =
  "【飞书】禁止使用 AskQuestion / 选择题 / 选项卡片。拿不准时用自然语言直接写在回复里问用户，等下一轮飞书消息再继续。能合理默认的就默认，并一句话说清假设。";

export function isResetCommand(text: string): boolean {
  return RESET_COMMANDS.has(text.trim().toLowerCase()) || RESET_COMMANDS.has(text.trim());
}

function isActiveRunError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /already has active run/i.test(msg);
}

function sendOptions(
  customTools: Record<string, SDKCustomTool> | undefined,
  force = false,
) {
  if (!customTools && !force) return undefined;
  return {
    local: {
      ...(customTools ? { customTools } : {}),
      ...(force ? { force: true } : {}),
    },
  };
}

export async function runCursorAgent(
  sessionStore: SessionStore,
  sessionKey: string,
  prompt: string,
  options?: RunCursorAgentOptions,
): Promise<AgentOutcome> {
  const existing = sessionStore.get(sessionKey);
  let agent;
  const customTools = options?.customTools;
  const agentOptions = {
    apiKey: config.cursorApiKey,
    model: { id: config.cursorModel },
    name: config.agentName,
    // Built-in AskQuestion is auto-declined in the SDK and never reaches Feishu.
    disallowedTools: ["askQuestion"],
    local: {
      ...localAgentOptions(),
      ...(customTools ? { customTools } : {}),
    },
  };

  try {
    if (existing?.agentId) {
      agent = await Agent.resume(existing.agentId, agentOptions);
      console.log(`[cursor] resumed agent=${existing.agentId} session=${sessionKey}`);
    } else {
      agent = await Agent.create(agentOptions);
      sessionStore.set(sessionKey, agent.agentId);
      console.log(`[cursor] created agent=${agent.agentId} session=${sessionKey}`);
    }

    const turnPrompt = `${FEISHU_TURN_HINT}\n\n${prompt}`;

    let run;
    try {
      run = await agent.send(turnPrompt, sendOptions(customTools));
    } catch (err) {
      if (!isActiveRunError(err)) throw err;
      console.warn(
        `[cursor] stuck active run, retrying with force agent=${agent.agentId}`,
      );
      try {
        run = await agent.send(turnPrompt, sendOptions(customTools, true));
      } catch (forceErr) {
        if (!isActiveRunError(forceErr)) throw forceErr;
        console.warn(
          `[cursor] force failed, creating new agent session=${sessionKey}`,
        );
        await agent[Symbol.asyncDispose]();
        agent = undefined;
        sessionStore.delete(sessionKey);
        agent = await Agent.create(agentOptions);
        sessionStore.set(sessionKey, agent.agentId);
        run = await agent.send(turnPrompt, sendOptions(customTools));
        console.log(`[cursor] created agent=${agent.agentId} session=${sessionKey}`);
      }
    }
    console.log(`[cursor] run=${run.id} agent=${agent.agentId}`);

    let partialText = "";

    for await (const event of run.stream()) {
      if (event.type === "assistant") {
        for (const block of event.message.content) {
          if (block.type === "text" && block.text) {
            partialText += block.text;
          }
        }
      }
      if (event.type === "request") {
        console.log(`[cursor] request event request_id=${event.request_id}`);
      }
    }

    const result = await run.wait();
    const text =
      typeof result.result === "string" && result.result.trim()
        ? result.result.trim()
        : partialText.trim()
          ? partialText.trim()
          : result.status === "finished"
            ? "(agent 已完成，但没有返回文本)"
            : `agent 运行状态: ${result.status}`;

    return {
      type: "finished",
      text,
      agentId: agent.agentId,
      runId: run.id,
      status: result.status,
    };
  } catch (err) {
    if (err instanceof CursorAgentError) {
      if (existing?.agentId && !isActiveRunError(err)) {
        sessionStore.delete(sessionKey);
      }
      throw new Error(
        `Cursor agent 启动失败: ${err.message} (retryable=${err.isRetryable})`,
      );
    }
    throw err;
  } finally {
    if (agent) {
      await agent[Symbol.asyncDispose]();
    }
  }
}

export function resetSession(sessionStore: SessionStore, sessionKey: string): void {
  sessionStore.delete(sessionKey);
}
