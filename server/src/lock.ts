/** Runs async work one at a time per key (e.g. per rental), so concurrent requests cannot interleave. */
export function createKeyedLock() {
  const tails = new Map<string, Promise<unknown>>();
  return async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = tails.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.catch(() => undefined);
    tails.set(key, tail);
    try {
      return await run;
    } finally {
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}

export type KeyedLock = ReturnType<typeof createKeyedLock>;
