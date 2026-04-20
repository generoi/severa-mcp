const MIN_INTERVAL_MS = 120;

let lastRequestAt = 0;
let gate: Promise<void> = Promise.resolve();

export function acquireRateLimit(): Promise<void> {
  const next = gate.then(async () => {
    const now = Date.now();
    const delta = now - lastRequestAt;
    if (delta < MIN_INTERVAL_MS) {
      await new Promise((r) => setTimeout(r, MIN_INTERVAL_MS - delta));
    }
    lastRequestAt = Date.now();
  });
  gate = next.catch(() => undefined);
  return next;
}
