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
 * `tests` are paths passed straight to vitest. Keep them narrow: the runner
 * asserts they FAIL with the mutation applied, so a broad path makes a guard pass
 * on some unrelated test's failure.
 */
export const guards = [
  {
    name: 'a move refused with 409 re-reads the board before retrying',
    file: 'src/lib/outbox.svelte.ts',
    find: "      return 'retry-fresh';",
    replace: "      return 'retry';",
    tests: ['src/lib/outbox.test.ts'],
  },
  {
    name: 'each project rekeys against its own board',
    file: 'src/lib/outbox.svelte.ts',
    find: '            ? await this.#boardFor(boards, op.projectId)',
    replace: "            ? await this.#boardFor(boards, 'every-project')",
    tests: ['src/lib/outbox.test.ts'],
  },
  {
    name: 'an abandoned drain writes nothing into the next account',
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
    file: 'src/lib/outbox.svelte.ts',
    find: '    this.#drain = null;\n  }\n}',
    replace: '  }\n}',
    tests: ['src/lib/outbox.test.ts'],
  },
  {
    name: 'deleteColumn names the column it deleted',
    file: 'src/lib/board.svelte.ts',
    find: "    const name = this.columns.find((column) => column.id === columnId)?.name ?? '';\n    this.columns = this.columns.filter((column) => column.id !== columnId);",
    replace:
      "    this.columns = this.columns.filter((column) => column.id !== columnId);\n    const name = this.columns.find((column) => column.id === columnId)?.name ?? '';",
    tests: ['src/lib/board.test.ts'],
  },
  {
    name: 'one remote blocker of two expanded hosts is one node',
    file: 'src/lib/graph.ts',
    find: '      if (!emittedRemoteIds.has(remote.task_id)) {\n        emittedRemoteIds.add(remote.task_id);',
    replace: '      if (true) {',
    tests: ['src/lib/graph.test.ts'],
  },
  {
    name: 'signing out empties the queue',
    file: 'src/App.svelte',
    find: '      outbox.reset();\n',
    replace: '',
    tests: ['src/App.test.ts'],
  },
];
