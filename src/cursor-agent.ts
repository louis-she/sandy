import { Agent, CursorAgentError } from "@cursor/sdk";
import {
  isAskQuestionToolName,
  parseAskQuestionArgs,
  type ParsedAskQuestion,
} from "./ask-question.js";
import { config, localAgentOptions } from "./config.js";
import type { SessionStore } from "./session-store.js";

export type AgentFinished = {
  type: "finished";
  text: string;
  agentId: string;
  runId?: string;
  status: string;
};

export type AgentNeedsInput = {
  type: "needs_input";
  agentId: string;
  runId?: string;
  ask: ParsedAskQuestion;
  partialText?: string;
};

export type AgentOutcome = AgentFinished | AgentNeedsInput;

const RESET_COMMANDS = new Set(["/new", "/reset", "重置", "新对话"]);

export function isResetCommand(text: string): boolean {
  return RESET_COMMANDS.has(text.trim().toLowerCase()) || RESET_COMMANDS.has(text.trim());
}

export async function runCursorAgent(
  sessionStore: SessionStore,
  sessionKey: string,
  prompt: string,
): Promise<AgentOutcome> {
  const existing = sessionStore.get(sessionKey);
  let agent;

  try {
    if (existing?.agentId) {
      agent = await Agent.resume(existing.agentId, {
        apiKey: config.cursorApiKey,
        model: { id: config.cursorModel },
        name: config.agentName,
        local: localAgentOptions(),
      });
      console.log(`[cursor] resumed agent=${existing.agentId} session=${sessionKey}`);
    } else {
      agent = await Agent.create({
        apiKey: config.cursorApiKey,
        model: { id: config.cursorModel },
        name: config.agentName,
        local: localAgentOptions(),
      });
      sessionStore.set(sessionKey, agent.agentId);
      console.log(`[cursor] created agent=${agent.agentId} session=${sessionKey}`);
    }

    const run = await agent.send(prompt);
    console.log(`[cursor] run=${run.id} agent=${agent.agentId}`);

    let partialText = "";
    let pendingAsk: ParsedAskQuestion | undefined;
    let sawAskQuestion = false;

    for await (const event of run.stream()) {
      if (event.type === "assistant") {
        for (const block of event.message.content) {
          if (block.type === "text" && block.text) {
            partialText += block.text;
          }
          if (block.type === "tool_use" && isAskQuestionToolName(block.name)) {
            const parsed = parseAskQuestionArgs(block.input);
            if (parsed) {
              pendingAsk = parsed;
              sawAskQuestion = true;
              console.log(
                `[cursor] askQuestion via tool_use questions=${parsed.questions.length}`,
              );
            }
          }
        }
      }

      if (event.type === "tool_call" && isAskQuestionToolName(event.name)) {
        const parsed = parseAskQuestionArgs(event.args);
        if (parsed) {
          pendingAsk = parsed;
          sawAskQuestion = true;
          console.log(
            `[cursor] askQuestion tool_call status=${event.status} questions=${parsed.questions.length}`,
          );
        } else {
          console.warn(
            "[cursor] askQuestion tool_call with unparsable args:",
            JSON.stringify(event.args)?.slice(0, 500),
          );
        }

        // Plan A: stop this run and wait for Feishu selection as the next turn.
        if (event.status === "running" && pendingAsk) {
          if (run.supports("cancel")) {
            await run.cancel();
          }
          break;
        }
      }

      if (event.type === "request") {
        console.log(`[cursor] request event request_id=${event.request_id}`);
        // If we already parsed askQuestion args, cancel & hand off to Feishu.
        if (pendingAsk && run.supports("cancel")) {
          await run.cancel();
          break;
        }
      }
    }

    if (sawAskQuestion && pendingAsk) {
      // Ensure run settles if cancel didn't already.
      try {
        await run.wait();
      } catch {
        // cancelled runs may reject; ignore
      }

      return {
        type: "needs_input",
        agentId: agent.agentId,
        runId: run.id,
        ask: pendingAsk,
        partialText: partialText.trim() || undefined,
      };
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
      if (existing?.agentId) {
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
