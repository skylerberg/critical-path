// Dev-only, imported first by board-probe.ts (NOT shipped).
//
// The probe seeds the board's state directly and mounts the real component on
// top of it, so there is no server behind it and it needs none. Left to reach
// the network, a mutation the check drives has two ways to spoil the
// measurement, and which one it picks depends on whose machine it runs on:
// with nothing on the API port the request never gets an answer, so the outbox
// treats it as offline and queues it in IndexedDB, where it outlives the page
// and drains into the next case; with the API running — which is what
// CLAUDE.md tells everyone to do — it succeeds against a real database and the
// board resyncs to whatever that holds. Both stop measuring the board the probe
// set up, and the second one only ever happens locally, so CI cannot catch it.
//
// Answering /api here closes both. The recording is the other half: it makes
// "the board mounted without talking to a server" something the check asserts
// rather than a silence it has to trust, and it lets a drop's destination be
// read from the request the board really sent instead of from a stub standing
// in for the code that sends it.
export interface ProbeRequest {
  method: string;
  path: string;
  body: Record<string, unknown> | null;
}

// Long enough that a check can read the DOM between the request and the answer,
// short enough to stay well inside the waits those checks already do.
const REORDER_DELAY_MS = 250;

const requests: ProbeRequest[] = [];
(window as unknown as { __requests: ProbeRequest[] }).__requests = requests;

// Counts reorders that have been ANSWERED, which `requests` cannot: it records
// on arrival, so it says nothing about which side of the delay above a reader
// is standing on. A check reading the board mid-flight asserts this is still at
// the value it zeroed, otherwise "the cards moved before the answer" quietly
// becomes "the cards moved" the day something makes the read slower than 250ms.
const answered = { reorders: 0 };
(window as unknown as { __answered: typeof answered }).__answered = answered;

const realFetch = window.fetch.bind(window);

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url, location.origin);
  // Vite's own traffic — module graph, source maps — is not the probe's business.
  if (url.origin !== location.origin || !url.pathname.startsWith('/api')) {
    return realFetch(input as RequestInfo, init);
  }

  let body: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = await request.clone().json();
    if (typeof parsed === 'object' && parsed !== null) {
      body = parsed as Record<string, unknown>;
    }
  } catch {
    // A GET carries no body; that is not a problem worth reporting.
  }
  requests.push({ method: request.method, path: url.pathname, body });

  // The echo below is only harmless for a response nothing reads back. A column
  // sort reads one: `sortColumn` re-stamps the column from `moved_tasks`, so an
  // echoed `{ task_ids }` throws inside the store and the probe measures that
  // crash while looking like it reproduced whatever it was driving. The keys are
  // invented rather than fractional — `byRank` compares them as strings and this
  // is the only thing the board asks of them — but the ORDER is the caller's, so
  // what comes back is the reorder the board actually requested.
  if (request.method === 'POST' && /^\/api\/columns\/[^/]+\/reorder$/.test(url.pathname)) {
    // Answered late on purpose. Because the response repeats the caller's own
    // order, a store that sent the right request and only ordered the column
    // from the reply would render the same DOM as one that ordered it
    // optimistically — so a check reading the order after the answer cannot
    // tell the optimistic update from its absence. This window is where it can.
    await new Promise((resolve) => setTimeout(resolve, REORDER_DELAY_MS));
    const requested = body?.task_ids;
    const taskIds: string[] = Array.isArray(requested)
      ? requested.filter((id): id is string => typeof id === 'string')
      : [];
    answered.reorders += 1;
    return new Response(
      JSON.stringify({
        moved_tasks: taskIds.map((id, index) => ({
          id,
          sort_key: `a${String(index).padStart(6, '0')}`,
        })),
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }

  // Everything else is answered, including requests no case expects, because a
  // refusal is not inert: the board reports it, resyncs, and asks again, so one
  // unexpected call becomes a cascade that buries the assertion meant to catch
  // it. The check reads the recording and fails on the request itself instead.
  return new Response(JSON.stringify(body ?? {}), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};
