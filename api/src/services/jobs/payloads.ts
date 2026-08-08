import { type } from 'arktype';

// Every job kind and the shape of its payload, one row each. This table is what
// declares a kind exists: registerJobHandler and enqueueJob are generic over its
// keys, so a kind with no row here cannot be registered or enqueued, and a
// payload that disagrees with its row is a type error at the enqueue site rather
// than a hand-written re-parse inside the handler.
//
// Ids only, never contact details — see assertJobPayload in ./queue.
export const JOB_PAYLOAD_SCHEMAS = {
  attachment_unfurl: type({ attachment_id: 'string' }),
  // Periodic kinds carry nothing: syncPeriodicJobs seeds their schedule row with
  // an empty payload, so their row has to accept one.
  task_series_materialize: type({}),
  assignment_digest: type({}),
};

export type JobKind = keyof typeof JOB_PAYLOAD_SCHEMAS;

export type JobPayloads = {
  [K in JobKind]: (typeof JOB_PAYLOAD_SCHEMAS)[K]['infer'];
};
