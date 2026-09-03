export type AskAnswer = {
  questionId: string;
  selectedOptionIds: string[];
  freeformText?: string;
};

type Waiter = {
  resolve: (answers: AskAnswer[]) => void;
  reject: (err: Error) => void;
};

const waiters = new Map<string, Waiter>();

export function hasAskWaiter(sessionKey: string): boolean {
  return waiters.has(sessionKey);
}

export function waitForAskAnswers(sessionKey: string): Promise<AskAnswer[]> {
  const existing = waiters.get(sessionKey);
  if (existing) {
    existing.reject(new Error("replaced by a new question round"));
    waiters.delete(sessionKey);
  }

  return new Promise((resolve, reject) => {
    waiters.set(sessionKey, { resolve, reject });
  });
}

export function resolveAskWaiter(sessionKey: string, answers: AskAnswer[]): boolean {
  const waiter = waiters.get(sessionKey);
  if (!waiter) return false;
  waiters.delete(sessionKey);
  waiter.resolve(answers);
  return true;
}

export function cancelAskWaiter(sessionKey: string, reason: string): boolean {
  const waiter = waiters.get(sessionKey);
  if (!waiter) return false;
  waiters.delete(sessionKey);
  waiter.reject(new Error(reason));
  return true;
}
