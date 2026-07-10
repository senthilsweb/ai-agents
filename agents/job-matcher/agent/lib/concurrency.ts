/**
 * Run `fn` over `items` with at most `limit` concurrent calls in flight.
 * No dependency needed for this; a plain worker-pool is a few lines. Copied
 * locally from agents/privacy-classifier/agent/lib/concurrency.ts per this
 * repo's convention for small per-agent utilities (AGENTS.md "Monorepo
 * Conventions").
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
