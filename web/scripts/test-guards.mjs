/**
 * The bugs the suite is asked to hold shut, and the edit that puts each one back.
 *
 * One entry per guard. `find` must occur EXACTLY once in `file` — a mutation that
 * matches nothing, or matches twice, is the failure this whole check exists to
 * catch wearing the check's own face, so the runner treats either as an error
 * rather than quietly rewriting the wrong line. (It has already happened by hand:
 * a four-space pattern matched a six-space line inside a different function, the
 * "reverted" test passed, and the pass meant nothing.)
 *
 * `tests` are paths passed straight to vitest, and `testName` is the `-t` filter
 * within them. Both want to be narrow, for the same reason: the runner asserts
 * the run FAILS with the mutation applied, so anything broader than the cases
 * that actually guard the bug lets an unrelated failure vouch for the guard.
 * A `testName` matching nothing is reported rather than counted as a pass.
 */
export const guards = [
  {
    name: 'a move refused with 409 re-reads the board before retrying',
    testName: 'reads the board again after a 409 instead of replaying the refused key',
    file: 'src/lib/outbox.svelte.ts',
    find: "      return 'retry-fresh';",
    replace: "      return 'retry';",
    tests: ['src/lib/outbox.test.ts'],
  },
  {
    name: 'each project rekeys against its own board',
    testName: 'rekeys each move against its own project',
    file: 'src/lib/outbox.svelte.ts',
    find: '            ? await this.#boardFor(boards, op.projectId)',
    replace: "            ? await this.#boardFor(boards, 'every-project')",
    tests: ['src/lib/outbox.test.ts'],
  },
  {
    name: 'an abandoned drain writes nothing into the next account',
    testName: 'abandons a drain that resolves after the queue was reset',
    file: 'src/lib/outbox.svelte.ts',
    find: `        const outcome = await sendRequest(request);
        if (generation !== this.#generation) {
          return;
        }`,
    replace: '        const outcome = await sendRequest(request);',
    tests: ['src/lib/outbox.test.ts'],
  },
  {
    name: 'a reset drops the memoized drain so the next account can start one',
    testName: 'drains the next account after a reset abandoned a run mid-flight',
    file: 'src/lib/outbox.svelte.ts',
    find: '    this.#drain = null;\n  }\n}',
    replace: '  }\n}',
    tests: ['src/lib/outbox.test.ts'],
  },
  {
    name: 'deleteColumn names the column it deleted',
    testName: 'deleteColumn names the column it deleted',
    file: 'src/lib/board.svelte.ts',
    find: "    const name = this.columns.find((column) => column.id === columnId)?.name ?? '';\n    this.columns = this.columns.filter((column) => column.id !== columnId);",
    replace:
      "    this.columns = this.columns.filter((column) => column.id !== columnId);\n    const name = this.columns.find((column) => column.id === columnId)?.name ?? '';",
    tests: ['src/lib/board.test.ts'],
  },
  {
    name: 'one remote blocker of two expanded hosts is one node',
    testName: 'emits one node for a remote task that blocks two expanded hosts',
    file: 'src/lib/graph.ts',
    find: '      if (!emittedRemoteIds.has(remote.task_id)) {\n        emittedRemoteIds.add(remote.task_id);',
    replace: '      if (true) {',
    tests: ['src/lib/graph.test.ts'],
  },
  {
    name: 'signing out empties the queue',
    testName: 'drops unsent work when the session ends',
    file: 'src/App.svelte',
    find: '      outbox.reset();\n',
    replace: '',
    tests: ['src/App.test.ts'],
  },
  {
    name: 'a socket frame proves the server is reachable',
    testName: 'counts any frame as proof, the heartbeat included',
    file: 'src/lib/realtime.svelte.ts',
    find: "    connectivity.noteReached();\n    if (typeof raw !== 'string') {",
    replace: "    if (typeof raw !== 'string') {",
    tests: ['src/lib/realtime.test.ts'],
  },
  {
    name: 'reachability returning reconnects the socket at once',
    testName: 'reconnects at once when something else reaches the server',
    file: 'src/lib/realtime.svelte.ts',
    find: `    if (this.evicted) {
      return;
    }
    if (this.#stopped || this.#socket !== null) {
      return;
    }
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = undefined;
    this.#backoff = INITIAL_BACKOFF_MS;
    this.#open();`,
    replace: '    return;',
    tests: ['src/lib/realtime.test.ts'],
  },
  {
    name: 'an evicted socket yields its slot instead of taking another',
    testName: 'does not take another of the account’s slots straight back',
    file: 'src/lib/realtime.svelte.ts',
    find: '        this.#yieldSlot();',
    replace: '        this.#scheduleReconnect();',
    tests: ['src/lib/realtime-eviction.svelte.test.ts'],
  },
  {
    name: 'an aborted request is not an outage',
    testName: 'leaves an aborted request out of it',
    file: 'src/api/client.ts',
    find: "    if (error instanceof Error && error.name === 'AbortError') {\n      return;\n    }\n",
    replace: '',
    tests: ['src/api/client.test.ts'],
  },
  {
    name: 'only the states that mean it say "Offline"',
    testName: 'never calls a state offline that only happens while the server answers',
    file: 'src/lib/sync-state.ts',
    find: "      return 'Live updates paused — reconnecting';",
    replace: "      return 'Offline — reconnecting';",
    tests: ['src/lib/sync-state.test.ts'],
  },
  {
    name: 'the reachability seed lowers but never raises',
    testName: 'does not let the interface overwrite an answer already given',
    file: 'src/lib/connectivity.svelte.ts',
    find: '    if (!navigator.onLine) {\n      this.#become(false);\n    }',
    replace: '    this.reachable = navigator.onLine;',
    tests: ['src/lib/connectivity.svelte.test.ts'],
  },
  {
    // The store flag and the pure state function are each tested alone, so this
    // one property is the whole of the wire between them: a literal here
    // typechecks and leaves every other test green.
    name: 'the eviction notice is wired to the socket that was evicted',
    testName: 'says why live updates stopped when the account is out of slots',
    file: 'src/components/SyncStatus.svelte',
    find: '          socketEvicted: realtime.evicted,',
    replace: '          socketEvicted: false,',
    tests: ['src/components/SyncStatus.test.ts'],
  },
];
