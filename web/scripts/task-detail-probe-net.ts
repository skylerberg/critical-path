// Dev-only, imported by task-detail-probe.ts AFTER board-probe-net (NOT shipped).
//
// board-probe-net answers /api by echoing the request body, which is the right
// default and the wrong answer for two routes here: taskActivity does
// `this.entries = data.activity` with no guard and would crash the overlay, and a
// PATCH echoed back carries no `updated_at` — the very field the baseline advance
// is keyed on, so echoing would manufacture the double-write this check exists to
// catch.
const echo = window.fetch;
const ANSWERS: Record<string, unknown> = {
  '/cross-project-dependencies': {
    blocked_by: [],
    blocking: [],
    hidden_blocked_by_count: 0,
    hidden_blocking_count: 0,
  },
  '/activity': { activity: [] },
};
let version = 1;
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const request = input instanceof Request ? input : new Request(input, init);
  const url = new URL(request.url, location.origin);
  if (request.method === 'PATCH' && /\/api\/tasks\/[^/]+$/.test(url.pathname)) {
    const body: unknown = await request.clone().json();
    version += 1;
    (window as unknown as { __requests: unknown[] }).__requests.push({
      method: 'PATCH',
      path: url.pathname,
      body,
    });
    return new Response(
      JSON.stringify({
        ...(body as Record<string, unknown>),
        id: url.pathname.split('/').pop(),
        updated_at: `2026-02-0${String(version)}T00:00:00Z`,
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }
  const key = Object.keys(ANSWERS).find((s) => url.pathname.endsWith(s));
  if (request.method === 'GET' && key !== undefined) {
    return new Response(JSON.stringify(ANSWERS[key]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }
  return echo(input as RequestInfo, init);
};
