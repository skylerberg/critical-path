import { registerJobHandler } from '../jobs/handlers';
import {
  SWEEP_INTERVAL_SECONDS,
  SWEEP_TIMEOUT_MS,
  TASK_SERIES_JOB_KIND,
  runSeriesSweep,
} from './materialize';

// One periodic sweep rather than a job row per occurrence: an indexed table is
// already the queue, and the sweep is self-healing after any edit, pause,
// resume or delete with no schedule to cancel and reschedule.
export function registerTaskSeriesJob(): void {
  registerJobHandler({
    kind: TASK_SERIES_JOB_KIND,
    timeoutMs: SWEEP_TIMEOUT_MS,
    intervalSeconds: SWEEP_INTERVAL_SECONDS,
    run: async () => {
      await runSeriesSweep();
    },
  });
}
