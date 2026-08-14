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
    find: '              ? await this.#boardFor(boards, op.projectId)',
    replace: "              ? await this.#boardFor(boards, 'every-project')",
    tests: ['src/lib/outbox.test.ts'],
  },
  {
    name: 'an abandoned drain writes nothing into the next account',
    testName: 'abandons a drain that resolves after the queue was reset',
    file: 'src/lib/outbox.svelte.ts',
    find: `          const outcome = await sendRequest(request);
          if (generation !== this.#generation) {
            return;
          }`,
    replace: '          const outcome = await sendRequest(request);',
    tests: ['src/lib/outbox.test.ts'],
  },
  {
    // First of the four, because deleting these three lines is not a stale
    // value: the release then puts a write the server has already accepted back
    // at the head of the queue and the loop sends it again, and again, for as
    // long as the answer stays 200.
    name: 'an accepted op is retired from the claim as well as from the queue',
    testName: 'is not sent again once the server has accepted it',
    file: 'src/lib/outbox.svelte.ts',
    find: '    if (this.#inflight !== null && ids.has(this.#inflight.id)) {\n      this.#inflight = null;\n    }\n',
    replace: '',
    tests: ['src/lib/outbox-inflight.test.ts'],
  },
  {
    name: 'a merge cannot reach the request already on the wire',
    testName: 'is sent rather than merged into the request already in flight',
    file: 'src/lib/outbox.svelte.ts',
    find: '    const existing = this.#ops.find(',
    replace: '    const existing = this.#unsent.find(',
    tests: ['src/lib/outbox-inflight.test.ts'],
  },
  {
    name: 'a release puts back only the op it claimed',
    testName: 'does not push the next account’s in-flight op back into its queue',
    file: 'src/lib/outbox.svelte.ts',
    find: '    if (this.#inflight === null || this.#inflight.id !== claimed.id) {',
    replace: '    if (this.#inflight === null) {',
    tests: ['src/lib/outbox-inflight.test.ts'],
  },
  {
    name: 'signing out takes the op on the wire with it',
    testName: 'does not come back into the next account after a reset',
    file: 'src/lib/outbox.svelte.ts',
    find: '    this.#inflight = null;\n    this.#issues = [];',
    replace: '    this.#issues = [];',
    tests: ['src/lib/outbox-inflight.test.ts'],
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
    name: 'a dropped card queues the cards it landed between',
    testName: 'queues the cards the dropped card landed between',
    file: 'src/routes/Board.svelte',
    find: '      void board.moveTask(event.detail.info.id, columnId, drop.placement, drop.intent);',
    // The regression this is aimed at is not "the argument goes away" — the type
    // refuses that now — but an append passed because it compiles, which is what
    // the missing argument used to mean and what nothing used to notice.
    replace:
      "      void board.moveTask(event.detail.info.id, columnId, drop.placement, { kind: 'append' });",
    tests: ['src/routes/Board.test.ts'],
  },
  {
    name: 'a drop that landed nowhere is not an append',
    testName: 'declines to name neighbors for a card that is not in the list',
    file: 'src/lib/ranks.ts',
    find: '  if (index === -1) {\n    return null;\n  }',
    replace: "  if (index === -1) {\n    return { kind: 'append' };\n  }",
    tests: ['src/lib/ranks.test.ts'],
  },
  {
    name: 'the move menu queues the slot it aimed at',
    testName: 'places the card at',
    file: 'src/components/QuickMoveMenu.svelte',
    find: '    void ctx.moveTask(taskId, column.id, placeAtIndex(rest, index), neighborsAtIndex(rest, index));',
    replace:
      "    void ctx.moveTask(taskId, column.id, placeAtIndex(rest, index), { kind: 'append' });",
    tests: ['src/components/QuickMoveMenu.test.ts'],
  },
  {
    name: 'a description flushed on a switch goes to the card it was typed on',
    testName:
      'sends an unsaved description to the card it was typed on, not the one that replaced it',
    file: 'src/components/TaskDetail.svelte',
    find: '      if (conflictDrafts.get(open.id) !== null || open.removing) return true;',
    replace:
      '      if (conflictDrafts.get(open.id) !== null || open.removing || open.id !== taskId)\n        return true;',
    tests: ['src/components/TaskDetail.test.ts'],
  },
  {
    name: 'a rejection is filed for the card it was aimed at, not the one on screen',
    testName: 'files a title rejected after the switch under the card that was typed on',
    file: 'src/components/TaskDetail.svelte',
    find: '    conflictDrafts.set(open.id, { mine, base: baseOf(open) });',
    replace:
      '    if (open.id !== taskId) return;\n    conflictDrafts.set(open.id, { mine, base: baseOf(open) });',
    tests: ['src/components/TaskDetail.test.ts'],
  },
  {
    name: 'a card returned to mid-conflict shows the text that was rejected',
    testName: 'shows the rejected title again when the card is returned to mid-conflict',
    file: 'src/components/TaskDetail.svelte',
    find: `      if (card.captured || loaded === undefined) return;
      card.captured = true;
      const open = sessions.for(taskId);`,
    replace: `      if (loaded === undefined) return;
      const open = sessions.for(taskId);
      if (open.baseUpdatedAt !== null) return;`,
    tests: ['src/components/TaskDetail.test.ts'],
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
    // The three below are the methods coverage found with no non-spy call site
    // anywhere in the suite, so nothing had ever run their bodies. Each guard
    // takes the optimistic half, which is the half a call-through spy asserting
    // `toHaveBeenCalledWith` still cannot see.
    name: 'setTaskAssignees applies the set to the card it names',
    testName: 'setTaskAssignees applies optimistically and PUTs the full set',
    file: 'src/lib/board.svelte.ts',
    find: '    this.tasks = patchById(this.tasks, taskId, (task) => ({ ...task, assignee_ids: userIds }));',
    replace: '    this.tasks = patchById(this.tasks, taskId, (task) => ({ ...task }));',
    tests: ['src/lib/board.test.ts'],
  },
  {
    name: 'renameColumn renames the column before the server answers',
    testName: 'renameColumn renames the column and PATCHes the new name',
    file: 'src/lib/board.svelte.ts',
    find: '    this.columns = this.columns.map((column) =>\n      column.id === columnId ? { ...column, name } : column\n    );',
    replace: '    this.columns = this.columns.map((column) => column);',
    tests: ['src/lib/board.test.ts'],
  },
  {
    name: 'toggleColumnDone flips the column before the server answers',
    testName: 'toggleColumnDone flips the flag both ways and PATCHes each new value',
    file: 'src/lib/board.svelte.ts',
    find: '    this.columns = this.columns.map((c) => (c.id === columnId ? { ...c, is_done } : c));',
    replace: '    this.columns = this.columns.map((c) => c);',
    tests: ['src/lib/board.test.ts'],
  },
  {
    // Only the checking half was ever exercised, so the decrement was free to be
    // an increment: unticking an item raised the done count past the total.
    name: 'unticking a checklist item gives the done count back',
    testName: 'setChecklistItemChecked unchecking gives the done count back and PATCHes false',
    file: 'src/lib/board-checklists.svelte.ts',
    find: '        done: checked ? done + 1 : done - 1,',
    replace: '        done: done + 1,',
    tests: ['src/lib/board.test.ts'],
  },
  {
    // 403 and 404 share one arm, and only the 404 half had a test: the card is
    // still on the board, so "no longer on the board" sends the reader looking
    // for a card they can see and cannot write.
    name: 'a refused card is reported as access, not as absence',
    testName: 'says access, not absence, when the card is refused rather than missing',
    file: 'src/lib/outbox.svelte.ts',
    find: "        reason: error.status === 404 ? 'gone' : 'forbidden',",
    replace: "        reason: 'gone',",
    tests: ['src/lib/outbox.test.ts'],
  },
  {
    // Flipped rather than deleted, and that is the finding: `null < 'V0…'` is
    // false, so removing this line falls through to the key comparison and
    // returns the same 1. Only the sign is observable.
    name: 'an unkeyed row sorts last from either side',
    testName: 'sorts an unkeyed row after a keyed one, whichever side it is on',
    file: 'src/lib/ranks.ts',
    find: '  if (a.sort_key === null) return 1;',
    replace: '  if (a.sort_key === null) return -1;',
    tests: ['src/lib/ranks.test.ts'],
  },
  {
    // Three of the twelve sites where a response can outlive the state it was
    // asked for, one per distinct consequence: rows cleared under the reader,
    // an error painted over content that has since arrived, and an entry
    // resurrected for a panel that is closed.
    name: 'a search failure that lost the race clears nobody’s rows',
    testName: 'discards a failure that lost the race with a newer query',
    file: 'src/lib/search.svelte.ts',
    find: '    } catch (error) {\n      if (token !== this.#token) {\n        return;\n      }',
    replace: '    } catch (error) {',
    tests: ['src/lib/search.test.ts'],
  },
  {
    name: 'a late archive failure does not take down a loaded archive',
    testName: 'loadArchived leaves a newer archive alone when an older failure lands after it',
    file: 'src/lib/board.svelte.ts',
    find: "    } catch (error) {\n      if (token !== this.#archivedToken) {\n        return;\n      }\n      this.archivedError = apiMessage(error, 'Failed to load the archive');",
    replace:
      "    } catch (error) {\n      this.archivedError = apiMessage(error, 'Failed to load the archive');",
    tests: ['src/lib/board.test.ts'],
  },
  {
    name: 'a forgotten task’s failure does not put its panel back',
    testName: 'writes nothing for a task forgotten while its read was failing',
    file: 'src/lib/crossProjectDeps.svelte.ts',
    find: '    } catch (error) {\n      if (this.#tokens.get(taskId) !== token) return;',
    replace: '    } catch (error) {',
    tests: ['src/lib/crossProjectDeps.test.ts'],
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
