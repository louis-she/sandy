import type * as Lark from "@larksuiteoapi/node-sdk";
import {
  REACTION_QUEUED,
  REACTION_WORKING,
  reactToMessage,
  removeReaction,
} from "./feishu.js";

export type QueueJob = {
  messageId: string;
  chatId: string;
  prompt: string;
  queuedReactionId?: string;
  workingReactionId?: string;
};

export type SessionQueueManager = {
  enqueue: (sessionKey: string, job: Omit<QueueJob, "queuedReactionId" | "workingReactionId">) => void;
  clear: (sessionKey: string) => Promise<void>;
};

export function createSessionQueueManager(
  client: Lark.Client,
  runJob: (job: QueueJob) => Promise<void>,
): SessionQueueManager {
  const queues = new Map<string, QueueJob[]>();
  const running = new Set<string>();

  function getQueue(sessionKey: string): QueueJob[] {
    let queue = queues.get(sessionKey);
    if (!queue) {
      queue = [];
      queues.set(sessionKey, queue);
    }
    return queue;
  }

  async function markWorking(job: QueueJob): Promise<void> {
    if (job.queuedReactionId) {
      try {
        await removeReaction(client, job.messageId, job.queuedReactionId);
      } catch (err) {
        console.warn("[queue] failed to remove queued reaction:", err);
      }
      job.queuedReactionId = undefined;
    }

    try {
      job.workingReactionId = await reactToMessage(
        client,
        job.messageId,
        REACTION_WORKING,
      );
    } catch (err) {
      console.warn("[queue] working reaction failed:", err);
    }
  }

  async function clearWorking(job: QueueJob): Promise<void> {
    if (!job.workingReactionId) return;
    try {
      await removeReaction(client, job.messageId, job.workingReactionId);
    } catch (err) {
      console.warn("[queue] failed to remove working reaction:", err);
    }
    job.workingReactionId = undefined;
  }

  async function pump(sessionKey: string): Promise<void> {
    if (running.has(sessionKey)) return;
    running.add(sessionKey);

    try {
      while (true) {
        const queue = getQueue(sessionKey);
        const job = queue.shift();
        if (!job) break;

        await markWorking(job);
        try {
          await runJob(job);
        } finally {
          await clearWorking(job);
        }
      }
    } finally {
      running.delete(sessionKey);
      if (getQueue(sessionKey).length > 0) {
        void pump(sessionKey);
      }
    }
  }

  return {
    enqueue(sessionKey, job) {
      void (async () => {
        const queue = getQueue(sessionKey);
        const busy = running.has(sessionKey) || queue.length > 0;
        const fullJob: QueueJob = { ...job };

        if (busy) {
          try {
            fullJob.queuedReactionId = await reactToMessage(
              client,
              job.messageId,
              REACTION_QUEUED,
            );
          } catch (err) {
            console.warn("[queue] queued reaction failed:", err);
          }
          console.log(
            `[queue] enqueued session=${sessionKey} depth=${queue.length + 1}`,
          );
        }

        queue.push(fullJob);
        void pump(sessionKey);
      })().catch((err) => {
        console.error(`[queue] enqueue failed session=${sessionKey}:`, err);
      });
    },

    async clear(sessionKey) {
      const queue = queues.get(sessionKey);
      if (!queue) return;

      for (const job of queue) {
        if (!job.queuedReactionId) continue;
        try {
          await removeReaction(client, job.messageId, job.queuedReactionId);
        } catch (err) {
          console.warn("[queue] failed to clear queued reaction:", err);
        }
      }

      queue.length = 0;
      console.log(`[queue] cleared pending jobs session=${sessionKey}`);
    },
  };
}
