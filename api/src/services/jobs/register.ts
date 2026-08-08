import { registerAssignmentDigestJob } from '../assignmentDigest';
import { registerAttachmentUnfurlHandler } from '../attachments/unfurl';
import { registerTaskSeriesJob } from '../taskSeries/job';
import type { JobKind } from './payloads';

// One registrar per kind, keyed by the table that declares the kinds, so the
// registry cannot be half-filled: a kind added to JOB_PAYLOAD_SCHEMAS with
// nothing to run it does not compile. `registeredJobKinds` is both what
// `claimDueJobs` filters on and what `syncPeriodicJobs` retires schedules by, so
// a process holding some other subset of the handlers is a process that quietly
// leaves work unclaimed.
const JOB_REGISTRARS: Record<JobKind, () => void> = {
  attachment_unfurl: registerAttachmentUnfurlHandler,
  task_series_materialize: registerTaskSeriesJob,
  assignment_digest: registerAssignmentDigestJob,
};

// Called once, beside the worker that runs what it registers — never as an
// import side effect: registerJobHandler refuses a duplicate kind, so a module
// that registers on load can only be imported once per process, and a test that
// imports the app then gets a registry no production process has.
export function registerJobHandlers(): void {
  for (const register of Object.values(JOB_REGISTRARS)) {
    register();
  }
}
