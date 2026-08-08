import { logger } from '../utils/logger';
import { errorText } from '../utils/errors';

export interface WorkerOptions {
  name: string;
  tickMs: number;
  // A tick that never finishes would hold the no-overlap latch and silently
  // stop this replica for good. Overrunning the budget only overlaps ticks,
  // which the SKIP LOCKED lease already tolerates across replicas.
  budgetMs: number;
  tick: () => Promise<void>;
}

export function startWorker(options: WorkerOptions): { close: () => void } {
  let running = false;

  const logFailure = (err: unknown): void => {
    logger.error({
      msg: `${options.name} worker tick failed`,
      error: errorText(err),
    });
  };

  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void (async () => {
      const tick = (async () => {
        await options.tick();
      })().catch(logFailure);
      let budget: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          tick,
          new Promise<never>((_, reject) => {
            budget = setTimeout(
              () => reject(new Error(`Tick exceeded ${String(options.budgetMs)}ms`)),
              options.budgetMs
            );
          }),
        ]);
      } catch (err) {
        logFailure(err);
      } finally {
        clearTimeout(budget);
        running = false;
      }
    })();
  }, options.tickMs);
  timer.unref();

  return {
    close: () => clearInterval(timer),
  };
}
