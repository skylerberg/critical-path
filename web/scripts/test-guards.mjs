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
  {
    // The mutation is the shipped code as it stood: the effect runs *after* the
    // rows changed, by which point the focused row is gone and focus is on
    // <body>, so a containment check can only be false and the recovery below it
    // was unreachable for the whole life of a mounted picker.
    name: 'a search result that removes the focused row hands focus back',
    testName: 'puts focus back in the search field when the row holding it disappears',
    file: 'src/components/MemberPicker.svelte',
    find: '    if (document.activeElement === null || document.activeElement === document.body) {',
    replace:
      '    if (listEl !== undefined && !listEl.contains(document.activeElement)) {\n      return;\n    }\n    if (document.activeElement === document.body) {',
    tests: ['src/components/MemberPicker.test.ts'],
  },
  {
    // Adding someone clears the query, which re-expands the list and puts the
    // highlight back on row 0 — so the repeats land on a different person, and
    // the dedupe in `add` is not what holds this shut.
    name: 'a held Enter grants board access to one person, not to the list',
    testName: 'grants access once when Enter is held down',
    file: 'src/components/MemberPicker.svelte',
    find: '      if (event.repeat) {\n        return;\n      }\n',
    replace: '',
    tests: ['src/components/MemberPicker.test.ts'],
  },
  {
    name: 'an invitation survives a session that could not be checked at launch',
    testName: 'reports an unreachable server rather than dropping an unchecked session',
    file: 'src/routes/Invite.svelte',
    find: '    if (!isSignedIn(session.status)) {',
    replace: "    if (session.status !== 'authed') {",
    tests: ['src/routes/Invite.test.ts'],
  },
  {
    name: 'an unchecked session is settled before the invitation is spent on it',
    testName: 'sends a visitor whose stored token has been revoked to log in',
    file: 'src/routes/Invite.svelte',
    find: "    if (session.status === 'offline') {\n      await session.revalidate();\n    }\n",
    replace: '',
    tests: ['src/routes/Invite.test.ts'],
  },
  {
    // `loaded` is set once and never reset, so the gate this puts back hides
    // every load after the first — including the refetch that follows a failed
    // revoke, leaving the row gone from the list with nothing said.
    name: 'a token list that fails to reload says so',
    testName: 'says why the list is short when the refetch after a failed revoke also fails',
    file: 'src/components/PersonalAccessTokens.svelte',
    find: '{#if loadError !== null}',
    replace: '{#if !loaded && loadError !== null}',
    tests: ['src/components/PersonalAccessTokens.test.ts'],
  },
  {
    // The stale answer carries the *pre-stamp* marker as well as the dot, and
    // `markChanged` refuses to light a dot for a board with no marker — so
    // dropping the stamp here silences the board that was just opened for the
    // rest of the session, which is the opposite of what the guard above it does.
    name: 'a stamp that outran the list read keeps its marker, not just its cleared dot',
    testName: 'keeps the marker the in-flight list read does not carry',
    file: 'src/lib/projects.svelte.ts',
    find: '          : { ...p, has_unseen_changes: false, last_seen_at: stamped };',
    replace: '          : { ...p, has_unseen_changes: false };',
    tests: ['src/lib/projects.test.ts'],
  },
  {
    // The trigger is `bind:this` on an always-rendered button, so an unguarded
    // window handler moves focus onto the header kebab on every Escape — the
    // ones that cancel a selection, a drag, or the filter dropdown included.
    name: 'Escape with the header menu closed leaves focus where the user put it',
    testName: 'leaves focus alone when Escape dismisses something else on the screen',
    file: 'src/components/ProjectHeader.svelte',
    find: "    if (event.key === 'Escape' && menuOpen) closeMenu({ restoreFocus: true });",
    replace: "    if (event.key === 'Escape') closeMenu({ restoreFocus: true });",
    tests: ['src/components/ProjectHeader.test.ts'],
  },
  {
    // Same shape on the projects list, where `openTrigger` outlives the menu it
    // was captured from: focus lands on whichever card's kebab was opened last.
    name: 'Escape with every card menu closed leaves focus where the user put it',
    testName: 'leaves focus where it is when Escape arrives with no menu open',
    file: 'src/routes/Projects.svelte',
    find: "    if (event.key === 'Escape' && openMenuId !== null) closeMenu({ restoreFocus: true });",
    replace: "    if (event.key === 'Escape') closeMenu({ restoreFocus: true });",
    tests: ['src/routes/Projects.test.ts'],
  },
  {
    // use:link sits on whole containers, so each of the next four lines is what
    // keeps an anchor that was never an in-app navigation from becoming one. This
    // one covers the card menu's "Open in new tab", which is an anchor inside a
    // use:link container on every card.
    name: 'a new-tab link is left to the browser',
    testName: 'leaves a new-tab link to the browser',
    file: 'src/lib/router.svelte.ts',
    find: "    if (anchor.target !== '' && anchor.target !== '_self') return;\n",
    replace: '',
    tests: ['src/lib/router.test.ts'],
  },
  {
    name: 'a click an inner handler already took is not navigated again',
    testName: 'leaves a click an inner handler already took',
    file: 'src/lib/router.svelte.ts',
    find: '    if (event.defaultPrevented || event.button !== 0) return;',
    replace: '    if (event.button !== 0) return;',
    tests: ['src/lib/router.test.ts'],
  },
  {
    name: 'a download link is left to the browser',
    testName: 'leaves a download link to the browser',
    file: 'src/lib/router.svelte.ts',
    find: "    if (anchor.hasAttribute('download')) return;\n",
    replace: '',
    tests: ['src/lib/router.test.ts'],
  },
  {
    name: 'an anchor with no href is left alone rather than routed to the current path',
    testName: 'leaves an anchor with no href to the browser',
    file: 'src/lib/router.svelte.ts',
    find: "    if (!anchor.getAttribute('href')) return;\n",
    replace: '',
    tests: ['src/lib/router.test.ts'],
  },
  {
    // Without it the SPA swallows a link off this origin and preventDefaults it
    // into doing nothing at all.
    name: 'a cross-origin link is left to the browser',
    testName: 'leaves a cross-origin link to the browser',
    file: 'src/lib/router.svelte.ts',
    find: '    if (anchor.origin !== window.location.origin) return;\n',
    replace: '',
    tests: ['src/lib/router.test.ts'],
  },
  {
    // The mutation is a popstate listener that applies the route directly, which
    // is the shape that skips the auth guard: Back then walks a signed-out
    // visitor onto the screen they were bounced off, with no /login and no
    // remembered path.
    name: 'the Back button goes through the auth guard',
    testName: 'runs the auth guard on a popped history entry',
    file: 'src/lib/router.svelte.ts',
    find: `        this.#apply(window.location.pathname + window.location.search + window.location.hash, {
          replace: true,
        });`,
    replace: `        this.current = matchRoute(window.location.pathname, window.location.search);
        this.path = window.location.pathname + window.location.search + window.location.hash;`,
    tests: ['src/lib/router.test.ts'],
  },
  {
    // beforeNavigate does not run on the first page load, so this is the only
    // thing standing between a bookmarked /login and a signed-in visitor. The
    // anon half of it has a second caller in the effect below; this half has none.
    name: 'the first page load is guarded once the session is known',
    testName: 'sends a signed-in visitor off the login page on first load',
    file: 'src/App.svelte',
    find: `  void session.init().then(() => {
    const redirected = session.guardRoute(router.current, router.path);
    if (typeof redirected === 'string') {
      router.redirect(redirected);
    }
  });`,
    replace: '  void session.init();',
    tests: ['src/App.test.ts'],
  },
  {
    name: 'the sidebar Log out button signs out',
    testName: 'signs out from the sidebar',
    file: 'src/components/Nav.svelte',
    find: '      onclick={logout}\n      class="flex min-h-11 cursor-pointer',
    replace: '      class="flex min-h-11 cursor-pointer',
    tests: ['src/components/Nav.test.ts'],
  },
  {
    // The phone-sized bar is a second copy of the same button, and the only way
    // out of the app on a phone.
    name: 'the bottom bar Log out button signs out',
    testName: 'signs out from the bottom bar',
    file: 'src/components/Nav.svelte',
    find: '    onclick={logout}\n    class="flex min-h-14 flex-1 cursor-pointer',
    replace: '    class="flex min-h-14 flex-1 cursor-pointer',
    tests: ['src/components/Nav.test.ts'],
  },
  {
    // A takeover reloading the document on its own discards whatever was typed;
    // the toast is what makes it the user's choice. Every other case in that file
    // injects a spy past this function, so this is the one that runs it.
    name: 'a service-worker takeover is offered rather than taken',
    testName: 'puts the takeover in a toast whose Reload button is the only thing that reloads',
    file: 'src/lib/appUpdate.ts',
    find: `  toasts.action(\`A new version of \${APP_NAME} is available.\`, {
    label: 'Reload',
    run: () => window.location.reload(),
  });`,
    replace: '  window.location.reload();',
    tests: ['src/lib/appUpdate.test.ts'],
  },
  {
    // The mutated file is a test file, deliberately: `vi.unstubAllGlobals()` in a
    // case takes testUtils' fetch, Request and storage stubs down with the one
    // the case installed, so every case after it runs against a different
    // environment than the file started in. The afterEach assertion is the guard,
    // and it is armed by the case's own afterEach — so it bites under `-t` too.
    name: 'the members modal keeps the file-wide stubs after stubbing navigator',
    testName: 'copies the link to the clipboard',
    file: 'src/components/ProjectMembersModal.test.ts',
    find: '    expect(writeText).toHaveBeenCalledWith(`${location.origin}${publicBoardHref(PROJECT_ID)}`);',
    replace:
      '    expect(writeText).toHaveBeenCalledWith(`${location.origin}${publicBoardHref(PROJECT_ID)}`);\n    vi.unstubAllGlobals();',
    tests: ['src/components/ProjectMembersModal.test.ts'],
  },
  {
    name: 'the header chrome block keeps the file-wide stubs after stubbing getComputedStyle',
    testName: 'restores the app default when the color is taken off the board',
    file: 'src/components/ProjectHeader.test.ts',
    find: "    vi.stubGlobal('getComputedStyle', realGetComputedStyle);",
    replace: '    vi.unstubAllGlobals();',
    tests: ['src/components/ProjectHeader.test.ts'],
  },
  {
    // The card arms singularise and the column arms did not, and the counted
    // form is reached by any burst holding more than one clause — so one column
    // added beside one card added spoke "added 1 columns" to a screen reader.
    name: 'the column clause singularises like the card one',
    testName: 'counts one column change beside a card change without pluralising it',
    file: 'src/lib/board-announcer.svelte.ts',
    find: '      return `added ${columns(group.length)}`;',
    replace: '      return `added ${String(group.length)} columns`;',
    tests: ['src/lib/board-announcer.test.ts'],
  },
  {
    // `columns` is rank-ordered by contract and Board.svelte renders straight
    // off it, so this trailing sort is the only thing re-establishing that after
    // a drop. Nothing called moveColumn until now, so deleting it was green.
    name: 'a dropped column lands in rank order, not at the end of the array',
    testName: 'moveColumn re-orders the columns before the response and PATCHes the new rank',
    file: 'src/lib/board.svelte.ts',
    find: '      .map((column) => (column.id === columnId ? { ...column, ...placement } : column))\n      .sort(byRank);',
    replace:
      '      .map((column) => (column.id === columnId ? { ...column, ...placement } : column));',
    tests: ['src/lib/board.test.ts'],
  },
  {
    // Clearing it only on the centering path leaves it set for every drag that
    // centered nothing, and the flag then forces a slide on the next drop or
    // reveal — one the user asked for nothing about.
    name: 'a drag that scrolled and centered nothing still clears the flag',
    testName: 'forgets the scroll when the drag ends over no zone at all',
    file: 'src/routes/Board.svelte',
    find: '    const scrolled = dragScrolled;\n    dragScrolled = false;\n    if (target === null) {\n      return;\n    }',
    replace:
      '    if (target === null) {\n      return;\n    }\n    const scrolled = dragScrolled;\n    dragScrolled = false;',
    tests: ['src/routes/Board.test.ts'],
  },
  {
    // The drop that commits nothing is exactly the one that skipped the landing:
    // snap came back with the board parked wherever the edge scroll stopped, free
    // to resolve onto a neighbouring column.
    name: 'a drop that commits no move still lands a scrolled board on a snap position',
    testName: 'slides onto the column even when the card is dropped where it was picked up',
    file: 'src/routes/Board.svelte',
    find: '      if (event.detail.info.source === SOURCES.POINTER && (drop !== null || dragScrolled)) {\n        centeringTarget = columnId;',
    replace:
      '      if (event.detail.info.source === SOURCES.POINTER && drop !== null) {\n        centeringTarget = columnId;',
    tests: ['src/routes/Board.test.ts'],
  },
  {
    // A keyboard drag finalizes on every arrow press, so this reads as the end of
    // the drag and is not one. Dropping the flag there lets realtime board edits
    // and shortcuts land underneath a gesture still in progress.
    name: 'a card keyboard drag keeps the drag flag up between arrows',
    testName: 'reorders task cards with Enter and arrows, committing each move',
    file: 'src/routes/Board.svelte',
    find: '      taskDragging = event.detail.info.source === SOURCES.KEYBOARD;',
    replace: '      taskDragging = false;',
    tests: ['src/routes/Board.test.ts'],
  },
  {
    name: 'a column keyboard drag keeps the drag flag up between arrows',
    testName: 'reorders columns by keyboard via the drag handle',
    file: 'src/routes/Board.svelte',
    find: '    columnDragging = event.detail.info.source === SOURCES.KEYBOARD;',
    replace: '    columnDragging = false;',
    tests: ['src/routes/Board.test.ts'],
  },
  {
    // Re-syncing the rendered lists mid-gesture rewrites the very arrays
    // svelte-dnd-action is mutating, and a realtime arrival is what does it at an
    // arbitrary moment. Both freezes read as redundant until one is deleted.
    name: 'the card list is frozen for the length of a drag',
    testName: 'ignores a card that arrives over the wire mid-drag',
    file: 'src/routes/Board.svelte',
    find: '    if (!taskDragging) {\n      syncLocalTasks();\n    }',
    replace: '    syncLocalTasks();',
    tests: ['src/routes/Board.test.ts'],
  },
  {
    name: 'the column list is frozen for the length of a drag',
    testName: 'ignores a column that arrives over the wire mid-drag',
    file: 'src/routes/Board.svelte',
    find: '    if (!columnDragging) {\n      localColumns = [...board.columns];\n    }',
    replace: '    localColumns = [...board.columns];',
    tests: ['src/routes/Board.test.ts'],
  },
  {
    // The routing sets decide by membership alone, so a type dropped from one
    // reaches no branch and is discarded in silence — no error, no toast, just a
    // board that stops hearing about renames.
    name: 'every event type the API publishes is routed somewhere',
    testName: 'lands every type the API publishes where its set says, and nowhere else',
    file: 'src/lib/realtime.svelte.ts',
    find: "  'task_updated',\n",
    replace: '',
    tests: ['src/lib/realtime.test.ts'],
  },
  {
    name: 'the reconnect wait doubles rather than repeating',
    testName: 'doubles each wait and then holds at thirty seconds',
    file: 'src/lib/realtime.svelte.ts',
    find: '    this.#backoff = Math.min(this.#backoff * 2, MAX_BACKOFF_MS);',
    replace: '    this.#backoff = Math.min(this.#backoff, MAX_BACKOFF_MS);',
    tests: ['src/lib/realtime.test.ts'],
  },
  {
    // Otherwise one bad afternoon leaves the tab waiting half a minute after
    // every drop for the rest of the session.
    name: 'a connection that succeeds puts the wait back to one second',
    testName: 'starts over at one second once a retry re-authenticates',
    file: 'src/lib/realtime.svelte.ts',
    find: '    this.#clearOfflineNotice();\n    this.#backoff = INITIAL_BACKOFF_MS;',
    replace: '    this.#clearOfflineNotice();',
    tests: ['src/lib/realtime.test.ts'],
  },
  {
    // disconnect() nulls the handlers before closing, so #onClose never runs and
    // this end() is the only one on the path. Left out, coverage keeps answering
    // for a board no socket is feeding and the revalidating read is skipped.
    name: 'disconnecting stops the coverage token as well as the socket',
    testName: 'stops carrying the project it was covering',
    file: 'src/lib/realtime.svelte.ts',
    find: '    this.#needsBoardRefetch = false;\n    realtimeCoverage.end();',
    replace: '    this.#needsBoardRefetch = false;',
    tests: ['src/lib/realtime.test.ts'],
  },
  {
    name: 'a reconnect mid-drag waits for the drag before replacing the board',
    testName: 'defers the reconnect refetch past the drag, then discards what queued behind it',
    file: 'src/lib/realtime.svelte.ts',
    find: '      if (board.dragBusy) {\n        this.#needsBoardRefetch = true;\n      } else {\n        void board.resync();\n      }',
    replace: '      void board.resync();',
    tests: ['src/lib/realtime.test.ts'],
  },
  {
    // The other half of the same mechanism: the deferred refetch has to throw
    // the batch away, because those events describe changes the reload carries.
    name: 'the deferred refetch discards the batch that queued behind the drag',
    testName: 'defers the reconnect refetch past the drag, then discards what queued behind it',
    file: 'src/lib/realtime.svelte.ts',
    find: '    if (this.#needsBoardRefetch) {\n      this.#needsBoardRefetch = false;\n      // This branch discards the whole queued batch, archive events included, so\n      // it has to reload the archive as well as the board.\n      boardAnnouncer.reset();\n      void board.resync();\n      return;\n    }\n',
    replace: '',
    tests: ['src/lib/realtime.test.ts'],
  },
  {
    name: 'a frame that is not JSON is dropped rather than thrown out of onmessage',
    testName: 'drops a frame that is not JSON and keeps applying the next good event',
    file: 'src/lib/realtime.svelte.ts',
    find: '    let message: { type?: unknown; project_id?: unknown; data?: unknown };\n    try {\n      message = JSON.parse(raw);\n    } catch {\n      return;\n    }',
    replace:
      '    const message: { type?: unknown; project_id?: unknown; data?: unknown } = JSON.parse(raw);',
    tests: ['src/lib/realtime.test.ts'],
  },
  {
    // Ahead of the guards, not after them: while the socket is up the reads that
    // would otherwise answer the reachability question are being skipped, so a
    // frame this client cannot parse is still the only evidence there is.
    name: 'a frame counts as reachability before anything tries to understand it',
    testName: 'counts a frame it could not parse at all',
    file: 'src/lib/realtime.svelte.ts',
    find: "    connectivity.noteReached();\n    if (typeof raw !== 'string') {\n      return;\n    }\n    let message: { type?: unknown; project_id?: unknown; data?: unknown };\n    try {\n      message = JSON.parse(raw);\n    } catch {\n      return;\n    }",
    replace:
      "    if (typeof raw !== 'string') {\n      return;\n    }\n    let message: { type?: unknown; project_id?: unknown; data?: unknown };\n    try {\n      message = JSON.parse(raw);\n    } catch {\n      return;\n    }\n    connectivity.noteReached();",
    tests: ['src/lib/realtime.test.ts'],
  },
  {
    // The column handler's own copy of the arm two guards above. Two copies means
    // two mutations: the card test never fires a column drag, so the card guard
    // says nothing about this line and it could be deleted with the suite green.
    name: 'a column drop that commits no move still lands a scrolled board',
    testName: 'slides onto the column even when a column is dropped where it was picked up',
    file: 'src/routes/Board.svelte',
    find: '      if (event.detail.info.source === SOURCES.POINTER && (drop !== null || dragScrolled)) {\n        centeringTarget = event.detail.info.id;',
    replace:
      '      if (event.detail.info.source === SOURCES.POINTER && drop !== null) {\n        centeringTarget = event.detail.info.id;',
    tests: ['src/routes/Board.test.ts'],
  },
  {
    // #adoptHandoff re-checks the project, so dropping this filter is invisible
    // from the board being loaded — the entry simply sits in the map until the
    // project it names is opened, and is then adopted for a navigation that ended
    // several screens ago.
    name: 'a handoff for another project does not outlive the load that passed it by',
    testName: 'drops a payload handed over for a board other than the one being loaded',
    file: 'src/lib/board.svelte.ts',
    find: '        ([, entry]) => entry.detail.project_id === projectId',
    replace: '        () => true',
    tests: ['src/lib/board.test.ts'],
  },
  {
    // Not a malformed frame: a known type from a pod that predates the payload it
    // now carries. #dispatch destructures event.data, so the throw escapes
    // onmessage and the socket stops applying anything that frame was carrying.
    name: 'a frame with no payload is dropped rather than thrown out of onmessage',
    testName: 'drops a known type that carries no payload',
    file: 'src/lib/realtime.svelte.ts',
    find: "    if (typeof message.data !== 'object' || message.data === null) {\n      return;\n    }\n",
    replace: '',
    tests: ['src/lib/realtime.test.ts'],
  },
  {
    // A repeat is not a doubled row here: the keyed each throws each_key_duplicate
    // and takes the screen down.
    name: 'a card served on two pages of My Tasks is held once',
    testName: 'keeps a card that arrives on two pages once',
    file: 'src/lib/myTaskGroups.ts',
    find: '  const byId = new Map(existing.map((task) => [task.id, task]));',
    replace: '  const byId = new Map();',
    tests: ['src/lib/myTasks.test.ts'],
  },
  {
    // The server files the row as blocked on these counts, so dropping them
    // leaves a row nothing can start looking exactly like a ready one.
    name: 'blockers the caller cannot read still count on the row',
    testName: 'counts the blockers it cannot name into the badge',
    file: 'src/components/MyTaskRow.svelte',
    find: 'task.blocked_by.length + (task.hidden_blocked_by_count ?? 0)',
    replace: 'task.blocked_by.length',
    tests: ['src/routes/MyTasks.test.ts'],
  },
  {
    // The mutation is the whole of the original bug: the POST was built on the
    // select's change, before the field asking for this had ever been shown.
    name: 'a series starts on the date the panel asked for',
    testName: 'starts the series on the date typed into Starts on',
    file: 'src/components/DatesPanel.svelte',
    find: '          start_date: startDate,',
    replace: '          start_date: todayISO(),',
    tests: ['src/components/DatesPanel.test.ts'],
  },
  {
    // Without this the menu goes on displaying a rule the card does not have.
    name: 'a refused rule change falls back to the rule the card still has',
    testName: 'falls back to the rule the card still has when the change is refused',
    file: 'src/components/DatesPanel.svelte',
    find: '    if (!saved) {',
    replace: '    if (false) {',
    tests: ['src/components/DatesPanel.test.ts'],
  },
  {
    // remove() reports a refused delete by returning false rather than throwing.
    name: 'a refused delete leaves the recurrence named on the card',
    testName: 'keeps the recurrence on the card when the delete is refused',
    file: 'src/components/DatesPanel.svelte',
    find: '      if (await taskSeries.remove(id)) {',
    replace: '      if ((await taskSeries.remove(id)) || true) {',
    tests: ['src/components/DatesPanel.test.ts'],
  },
  {
    // Not an Invalid Date: Number('') is 0, so the menu names 30 November 1899
    // at every keystroke of a half-typed start date.
    name: 'the recurrence menu quotes no day it was not given',
    testName: 'quotes no day for a start date of',
    file: 'src/lib/recurrence.ts',
    find: '  if (!isCalendarDate(startDate)) {\n    return UNANCHORED_LABELS[preset];\n  }\n',
    replace: '',
    tests: ['src/lib/recurrence.test.ts'],
  },
  {
    // Both creates go through #append for this: a create outlives the modal it
    // was submitted from, and the next project's list is what it lands in.
    name: 'a create that outlives its modal cannot land under the next board',
    testName: 'keeps a new series out of the list the store has moved on to',
    file: 'src/lib/taskSeries.svelte.ts',
    find: '    if (this.loaded && row.project_id === this.currentProjectId) {',
    replace: '    if (true) {',
    tests: ['src/lib/taskSeries.test.ts'],
  },
  {
    // Indexing code units splits a surrogate pair, and the half renders as a
    // replacement glyph on every card the person is assigned to.
    name: 'an avatar abbreviates a name by code point',
    testName: 'takes a whole first character, not half of a surrogate pair',
    file: 'src/components/ui/Avatar.svelte',
    find: ".map((word) => [...word][0]?.toUpperCase() ?? '')",
    replace: ".map((word) => word[0]?.toUpperCase() ?? '')",
    tests: ['src/components/ui/Avatar.test.ts'],
  },
  {
    // toLowerCase is not length-preserving, and the scan indexes the folded text
    // and the original with the same j: a whole-string fold walks the boundary
    // test off the end of a name holding 'İ' and throws out of a derived.
    name: 'fuzzy matching folds case one character at a time',
    testName: 'keeps its two indexes aligned when lowercasing lengthens a character',
    file: 'src/lib/fuzzy.ts',
    find: '  const lower = foldCase(text);',
    replace: '  const lower = text.toLowerCase();',
    tests: ['src/lib/fuzzy.test.ts'],
  },
  {
    // Without the bail the board view swallows Cmd+←/Alt+← (Back), Cmd+→
    // (Forward), Cmd+N and Cmd+O.
    name: 'the board selection keys leave a modified press to the browser',
    testName: 'leaves modified selection keys to the browser',
    file: 'src/lib/shortcuts.svelte.ts',
    find: '    if (event.metaKey || event.ctrlKey || event.altKey) {\n      return false;\n    }\n    const cursorId = selection.cursorTaskId;',
    replace: '    const cursorId = selection.cursorTaskId;',
    tests: ['src/lib/shortcuts.test.ts'],
  },
  {
    // Cmd+G/Ctrl+G is find-next: claiming it also armed the chord, so the next
    // key navigated off the board.
    name: 'a modified g is find-next and arms no chord',
    testName: 'leaves a modified g to the browser and arms nothing',
    file: 'src/lib/shortcuts.svelte.ts',
    find: '        if (event.metaKey || event.ctrlKey || event.altKey) {\n          return;\n        }\n        this.#armChord();',
    replace: '        this.#armChord();',
    tests: ['src/lib/shortcuts.test.ts'],
  },
  {
    // `undefined === 0` is false, so a pod that predates the field made every
    // task sprout a placeholder reading "Show undefined blocking tasks".
    name: 'a missing cross-project count reads as none, not as a placeholder',
    testName: 'emits nothing for a task whose payload carries no count at all',
    file: 'src/lib/graph.ts',
    find: '    const count = task.open_cross_project_blocker_count ?? 0;',
    replace: '    const count = task.open_cross_project_blocker_count;',
    tests: ['src/lib/graph.test.ts'],
  },
  {
    // A synthetic node's id is not a task id: accepting a drop on one links the
    // card optimistically and POSTs a blocker id the server cannot resolve.
    name: 'a connect drop is refused unless it lands on a real task node',
    testName: 'refuses a connect drop onto',
    file: 'src/routes/Graph.svelte',
    find: "    const id =\n      group?.getAttribute('data-node-kind') === 'task'\n        ? (group.getAttribute('data-node-id') ?? null)\n        : null;\n    connectTarget = id !== null && id !== connectSource ? id : null;\n  }\n\n  async function onConnectEnd",
    replace:
      "    const id = group?.getAttribute('data-node-id') ?? null;\n    connectTarget = id !== null && id !== connectSource ? id : null;\n  }\n\n  async function onConnectEnd",
    tests: ['src/routes/Graph.test.ts'],
  },
  {
    // Unreachable until DB_VERSION is bumped, and unrecoverable once it is: the
    // second create aborts the upgrade, `withDb` swallows the abort, and every
    // user who already had the old database silently stops remembering anything.
    name: 'a bumped database version does not re-create the stores it already has',
    testName: 'keeps what version 1 stored when it is opened at a bumped version',
    file: 'src/lib/offline-db.ts',
    find: '  if (oldVersion < 1) {',
    replace: '  if (oldVersion < 2) {',
    tests: ['src/lib/offline-db.test.ts'],
  },
  {
    name: 'a refused IndexedDB costs the caller nothing',
    testName: 'resolves rather than rejects when opening the database is refused',
    file: 'src/lib/offline-db.ts',
    find: '  } catch {\n    return fallback;\n  } finally {',
    replace: '  } finally {',
    tests: ['src/lib/offline-db.test.ts'],
  },
  {
    // The other half of the same promise, and the worse one: a storage layer
    // that never answers leaves every caller waiting forever rather than
    // rejecting once.
    name: 'a storage layer that stops answering is given up on',
    testName: 'stops waiting on a database that never answers',
    file: 'src/lib/offline-db.ts',
    find: '    return await Promise.race([work, guard]);',
    replace: '    return await work;',
    tests: ['src/lib/offline-db.test.ts'],
  },
  {
    // One board is read for a project and reused for every move it has queued,
    // so a landing that is not applied to it leaves the next move ranked against
    // the card's old position — under the card it was dropped on top of.
    name: 'a replayed move is ranked against where the move before it landed',
    testName: 'rekeys a move against where the move before it just landed',
    file: 'src/lib/outbox.svelte.ts',
    find: '              applyMoveLocally(board, op.entityId, op.move.columnId, request);\n',
    replace: '',
    tests: ['src/lib/outbox.test.ts'],
  },
  {
    name: 'a failed mutation resolves only once the resync it ordered has',
    testName: 'resolves only once the re-read has',
    file: 'src/lib/store-sync.ts',
    find: '    await store.load(store.currentProjectId);',
    replace: '    void store.load(store.currentProjectId);',
    tests: ['src/lib/store-sync.test.ts'],
  },
  {
    // The menu is fixed to viewport coordinates while the board scrolls beneath
    // it, so without this it stays put and names a card that has moved on.
    name: 'a scroll of the board takes the card menu with it',
    testName: 'closes when the board is scrolled out from under it',
    file: 'src/components/CardMenu.svelte',
    find: ' onwheel={closeOnOutside}',
    replace: '',
    tests: ['src/components/CardMenu.test.ts'],
  },
  {
    // Both halves of the same escape hatch: an OS chord must neither be swallowed
    // nor fire the row that happens to advertise its letter.
    name: 'a chord carrying a modifier is not read as a card-menu shortcut',
    testName: 'leaves a chord carrying a modifier to the browser',
    file: 'src/components/CardMenu.svelte',
    find: "if (event.key === 'Enter' || event.metaKey || event.ctrlKey || event.altKey) {",
    replace: "if (event.key === 'Enter') {",
    tests: ['src/components/CardMenu.test.ts'],
  },
  {
    // A column named '' has no label to click, so the rename that emptied it is
    // also the last one the header can offer.
    name: 'a column name blanked to whitespace is discarded, not sent',
    testName: 'discards a name blanked to whitespace and keeps the old one',
    file: 'src/components/ColumnHeader.svelte',
    find: "if (name !== '' && name !== column.name) {",
    replace: 'if (name !== column.name) {',
    tests: ['src/components/ColumnHeader.test.ts'],
  },
  {
    // Without the default the Move button never leaves `disabled`, and the dialog
    // can move nothing at all.
    name: 'the move dialog opens with a target already chosen',
    testName: 'moves to the first target when the user picks nothing',
    file: 'src/components/ColumnMoveTasksDialog.svelte',
    find: "targetId = targets[0]?.id ?? '';",
    replace: "targetId = '';",
    tests: ['src/components/ColumnMoveTasksDialog.test.ts'],
  },
  {
    name: 'dismissing the delete dialog deletes nothing',
    testName: 'deletes nothing when the dialog is cancelled',
    file: 'src/components/ColumnDeleteDialog.svelte',
    find: '<Button variant="secondary" onclick={onclose}>Cancel</Button>',
    replace: '<Button variant="secondary" onclick={confirm}>Cancel</Button>',
    tests: ['src/components/ColumnDeleteDialog.test.ts'],
  },
  {
    // The sole guard between a failed archive check on a one-column board and a
    // delete with no `move_tasks_to`, which drops whatever the archive was hiding.
    name: 'an unchecked archive counts as cards the last column may still hold',
    testName: 'blocks deleting the last column when the archive could not be checked',
    file: 'src/components/ColumnDeleteDialog.svelte',
    find: 'const mayHoldCards = $derived(liveCount > 0 || !archivedKnown || archivedCount > 0);',
    replace: 'const mayHoldCards = $derived(liveCount > 0 || archivedCount > 0);',
    tests: ['src/components/ColumnDeleteDialog.test.ts'],
  },
  {
    // Board order cuts the run's last ids, and a run grown upward ends at its
    // anchor: the set then slides a card per press away from where the user
    // started, count pinned at 100 and the one-shot toast long since spent.
    name: 'the selection cap counts outward from the anchor, not from the top of the board',
    testName: 'keeps the anchor when a run overflows upward',
    file: 'src/lib/selection.svelte.ts',
    find: '    const anchor = this.#anchorId === null ? -1 : live.indexOf(this.#anchorId);',
    replace: '    const anchor = -1;',
    tests: ['src/lib/selection.test.ts'],
  },
  {
    name: 'a click that overflows the cap keeps the card it landed on',
    testName: 'keeps the card whose click overflowed',
    file: 'src/lib/selection.svelte.ts',
    find: '    this.#anchorId = taskId;\n    this.#capped();',
    replace: '    this.#capped();\n    this.#anchorId = taskId;',
    tests: ['src/lib/selection.test.ts'],
  },
  {
    // `board.tasks` is insertion-ordered — a card created mid-session sits at the
    // end — and `bulkMoveTasks` appends in the order it is sent, so a set read
    // off it reshuffles the cards on arrival.
    name: 'the selected ids come out in board order, column by column',
    testName: 'reports rank order even when the board rows are not in it',
    file: 'src/lib/selection.svelte.ts',
    find: `    for (const column of board.columns) {
      for (const task of board.tasksInColumn(column.id)) {
        if (this.#picked.has(task.id)) {
          ids.push(task.id);
        }
      }
    }`,
    replace: `    for (const task of board.tasks) {
      if (this.#picked.has(task.id)) {
        ids.push(task.id);
      }
    }`,
    tests: ['src/lib/selection.test.ts'],
  },
  {
    // Accumulating instead: the second shift-click then only ever grows the run,
    // so a user correcting an overshoot cannot get back to what they meant.
    name: 'shift-click ranges are recomputed from a fixed anchor',
    testName: 'keeps the anchor fixed across a second shift-click',
    file: 'src/lib/selection.svelte.ts',
    find: '    this.#selectRun(columnId, anchor, taskId);\n    this.cursorTaskId = taskId;',
    replace:
      '    this.#selectRun(columnId, anchor, taskId);\n    this.cursorTaskId = taskId;\n    this.#anchorId = taskId;\n    this.#rangeBase = new Set(this.#picked);',
    tests: ['src/lib/selection.test.ts'],
  },
  {
    name: 'a bulk menu leaves with the edit rights that opened it',
    testName: 'closes itself when the set outlives the edit rights that made it',
    file: 'src/components/BulkActions.svelte',
    find: 'if (selection.count === 0 || !board.canEdit) {',
    replace: 'if (selection.count === 0) {',
    tests: ['src/components/BulkActions.test.ts'],
  },
  {
    // Enter here moves every selected card, so the neighbour that slid under the
    // highlight is the worst possible guess.
    name: 'a deleted column leaves the move menu’s Enter inert',
    testName: 'leaves Enter inert when the highlighted column is deleted under it',
    file: 'src/components/BulkMoveMenu.svelte',
    find: "    missing: 'inert',",
    replace: "    missing: 'first',",
    tests: ['src/components/BulkMoveMenu.test.ts'],
  },
  {
    name: 'a departed member leaves the assignee menu’s Enter inert',
    testName: 'leaves Enter inert when the highlighted person leaves the project',
    file: 'src/components/BulkAssigneeMenu.svelte',
    find: "    missing: 'inert',",
    replace: "    missing: 'first',",
    tests: ['src/components/BulkAssigneeMenu.test.ts'],
  },
  {
    // Without the exclusion the dialog counts the set against itself: archiving a
    // chain of three warns about cards that are going with it.
    name: 'the archive warning counts only the cards left behind',
    testName: 'says nothing when the only dependent card is itself being archived',
    file: 'src/components/BulkConfirmDialog.svelte',
    find: '      (task) => !chosen.has(task.id) && task.blocker_ids.some((id) => chosen.has(id))',
    replace: '      (task) => task.blocker_ids.some((id) => chosen.has(id))',
    tests: ['src/components/BulkConfirmDialog.test.ts'],
  },
  {
    // Both halves of one rule: the arrow belongs to the list while there are rows
    // to walk, and to the caret when there are none.
    name: 'the move menu’s arrows are consumed while rows match',
    testName: 'takes the arrow keys only while rows match the filter',
    file: 'src/components/BulkMoveMenu.svelte',
    find: `      if (nav.move(event.key === 'ArrowDown' ? 1 : -1)) {
        event.preventDefault();
      }`,
    replace: "      nav.move(event.key === 'ArrowDown' ? 1 : -1);",
    tests: ['src/components/BulkMoveMenu.test.ts'],
  },
  {
    name: 'the assignee menu’s arrows are consumed while rows match',
    testName: 'takes the arrow keys only while rows match the filter',
    file: 'src/components/BulkAssigneeMenu.svelte',
    find: `      if (nav.move(event.key === 'ArrowDown' ? 1 : -1)) {
        event.preventDefault();
      }`,
    replace: "      nav.move(event.key === 'ArrowDown' ? 1 : -1);",
    tests: ['src/components/BulkAssigneeMenu.test.ts'],
  },
  {
    // The only feedback a screen-reader user gets that the set changed at all.
    name: 'the selection announces its new size, singular and plural',
    testName: 'speaks the size a click leaves behind',
    file: 'src/lib/selection.svelte.ts',
    find: "count === 1 ? '' : 's'",
    replace: "count === 1 ? 's' : ''",
    tests: ['src/lib/selection.test.ts'],
  },
  {
    // The board store's first act on a cached board is `payload.project.id`, so a
    // record that satisfies the rest of the validator and has no project crashes
    // the board it was meant to restore rather than missing the cache.
    name: 'a cached board with no project is refused rather than restored',
    testName: 'refuses a board that names no project',
    file: 'src/lib/offline-cache.ts',
    find: `  typeof (payload as BoardSnapshot).project === 'object' &&
  (payload as BoardSnapshot).project !== null &&
`,
    replace: '',
    tests: ['src/lib/offline-cache.test.ts'],
  },
  {
    // The third of the three bulk menus, on the same two lines as the other two:
    // Enter here toggles a label across every selected card.
    name: 'a deleted label leaves the label menu’s Enter inert',
    testName: 'leaves Enter inert when the highlighted label is deleted under it',
    file: 'src/components/BulkLabelMenu.svelte',
    find: "    missing: 'inert',",
    replace: "    missing: 'first',",
    tests: ['src/components/BulkLabelMenu.test.ts'],
  },
  {
    name: 'the label menu’s arrows are consumed while rows match',
    testName: 'takes the arrow keys only while rows match the filter',
    file: 'src/components/BulkLabelMenu.svelte',
    find: `      if (nav.move(event.key === 'ArrowDown' ? 1 : -1)) {
        event.preventDefault();
      }`,
    replace: "      nav.move(event.key === 'ArrowDown' ? 1 : -1);",
    tests: ['src/components/BulkLabelMenu.test.ts'],
  },
  {
    // reset() clears the caches but cannot reach a read already on the wire, and
    // that read writes a whole card — the departing account's — into the next
    // session's task cache and hands it to the board.
    name: 'a task lookup that outlives the session writes into nobody',
    testName: 'drops a lookup that lands after the session ended',
    file: 'src/lib/task-route.svelte.ts',
    find: '      if (generation !== this.#generation) return;\n      this.#byTask = { ...this.#byTask, [taskId]: detail.project_id };',
    replace: '      this.#byTask = { ...this.#byTask, [taskId]: detail.project_id };',
    tests: ['src/lib/task-route.test.ts'],
  },
  {
    // Emphasis delimiters used to go outside the whitespace, which CommonMark
    // reads as no emphasis at all — and `* text*` at the start of a paragraph is
    // a bullet marker, so the copied markdown came back as a list item.
    name: 'an emphasis run keeps its whitespace outside the delimiters',
    testName: 'moves whitespace at the edge of an emphasis run outside its delimiters',
    file: 'src/lib/tiptap.ts',
    find: '        : markRun(mark, inlineFrom(run, depth + 1, lineBreak));',
    replace: '        : wrapMark(mark, inlineFrom(run, depth + 1, lineBreak));',
    tests: ['src/lib/tiptap.test.ts'],
  },
  {
    // Tiptap's isEmpty is whitespace-blind, so a paragraph of spaces was a real
    // document: the composer offered to post a comment the API rejects, and a
    // description of nothing but spaces was stored as text.
    name: 'one definition of an empty document for the whole app',
    testName: 'calls a document of nothing but whitespace empty',
    file: 'src/components/RichTextEditor.svelte',
    find: '    const doc = e.getJSON() as TiptapDoc;\n    return isEmptyDoc(doc) ? null : doc;',
    replace: '    return e.isEmpty ? null : (e.getJSON() as TiptapDoc);',
    tests: ['src/components/RichTextEditor.test.ts'],
  },
  {
    // A plain $effect assigns the draft after the textarea has mounted, so the
    // action's select() ran against an empty field and the rename opened with the
    // caret at the end — typing appended to the title instead of replacing it.
    name: 'the rename editor opens with the whole title selected',
    testName: 'swaps the title for an editor and takes the overlay link out of the way',
    file: 'src/components/TaskCard.svelte',
    find: '  $effect.pre(() => {\n    if (renaming) {',
    replace: '  $effect(() => {\n    if (renaming) {',
    tests: ['src/components/TaskCard.test.ts'],
  },
  {
    // A failed cross-project read leaves `deps` null for good, so a "still
    // loading" derived from that alone never ends: the Blocked by list stayed
    // aria-busy and its skeleton rows pulsed under the failure notice forever.
    name: 'a failed cross-project read stops the panel waiting',
    testName: 'stops waiting on cross-project blockers that failed to load',
    file: 'src/components/TaskDependencies.svelte',
    find: '  const crossPending = $derived(cross === null && !anonymous && entry?.error !== true);',
    replace: '  const crossPending = $derived(cross === null && !anonymous);',
    tests: ['src/components/TaskDependencies.test.ts'],
  },
  {
    // board.removeBlocker rewrites the tasks optimistically, so the row unmounts
    // under the button that was just pressed and focus falls back to the task
    // dialog's body — several tab stops from the list being worked in.
    name: 'removing a dependency row leaves focus in the list',
    testName: 'hands focus to the next row when a row is removed',
    file: 'src/components/DependencyList.svelte',
    find: "    const row = (event.currentTarget as HTMLElement).closest('li');\n    if (row !== null) {\n      focusNeighborOf(row);\n    }\n",
    replace: '',
    tests: ['src/components/DependencyList.test.ts'],
  },
  {
    // The pointer highlights a row without focusing it, so a highlight and a
    // focused row can name different rows; stepping from the highlight then skips
    // the row between them, and the row after the last suggestion is Create.
    name: 'an arrow from a focused row steps from that row, not the pointer’s',
    testName: 'arrows from the focused row even when the pointer highlights another',
    file: 'src/components/DependencyPicker.svelte',
    find: '      const from = rowIndex === undefined ? undefined : rows[rowIndex];\n      if (from !== undefined) {\n        nav.highlight(rowKey(from));\n      }\n',
    replace: '',
    tests: ['src/components/DependencyPicker.test.ts'],
  },
  {
    // The typed path is capped by the field's maxlength; the pasted one was not,
    // and /api/tasks/batch is all-or-nothing, so one long line 422s every card
    // pasted with it.
    name: 'a pasted line is capped at the same bound typing is',
    testName: 'caps a pasted line at the length the typed field allows',
    file: 'src/components/QuickAddTask.svelte',
    find: '    const lines = raw.map(cap);',
    replace: '    const lines = raw;',
    tests: ['src/components/QuickAddTask.test.ts'],
  },
  {
    // The cut is the same one maxlength makes to typing, but typing shows itself
    // happening and a paste does not, so without the count a card just ends
    // mid-sentence and nothing anywhere says a word about it.
    name: 'a paste that had to shorten a line says so',
    testName: 'says how many pasted lines it shortened',
    file: 'src/components/QuickAddTask.svelte',
    find: '          : `Added ${lines.length} tasks (${shortened} shortened to fit)`',
    replace: '          : `Added ${lines.length} tasks`',
    tests: ['src/components/QuickAddTask.test.ts'],
  },
  {
    // Slicing at the bound lands between the halves of a surrogate pair, and the
    // half left behind is not a character: the request body carries it as U+FFFD.
    name: 'a capped title never ends in half a character',
    testName: 'does not cut a pasted line through a surrogate pair',
    file: 'src/components/QuickAddTask.svelte',
    find: '    const whole = last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;',
    replace: '    const whole = cut;',
    tests: ['src/components/QuickAddTask.test.ts'],
  },
  {
    // Same disagreement as the dependency picker's, one step worse: the row the
    // arrow skips is a slot, so Enter files the card where nobody put it.
    name: 'a move arrow steps from the focused slot, not the pointer’s',
    testName: 'arrows from the focused row even when the pointer highlights another',
    file: 'src/components/QuickMoveMenu.svelte',
    find: '      const from = rowIndex === undefined ? undefined : rows[rowIndex];\n      if (from !== undefined) {\n        nav.highlight(from.key);\n      }\n',
    replace: '',
    tests: ['src/components/QuickMoveMenu.test.ts'],
  },
  {
    // Its sibling menus close with the card; this one stayed open showing every
    // label unselected, and a click PUT labels for an id the server no longer has.
    name: 'the label menu closes with the card it is labelling',
    testName: 'closes the label menu when its card is deleted under it',
    file: 'src/components/QuickLabelMenu.svelte',
    find: '    if (task === undefined) {\n      onclose();\n    }\n',
    replace: '',
    tests: ['src/components/QuickMenus.test.ts'],
  },
  {
    // The notice lives inside the Blocked by section, and once a failure stops
    // reserving skeleton rows that section has nothing else to draw for a card
    // whose blockers are all in other projects.
    name: 'a card blocked only from elsewhere still says the read failed',
    testName: 'still reports the failure on a card whose only blockers are the remote ones',
    file: 'src/components/TaskDependencies.svelte',
    find: '      crossFailureHidesBlockers ||\n',
    replace: '',
    tests: ['src/components/TaskDependencies.test.ts'],
  },
  {
    // The composer clears itself before the write lands and the failure path
    // resyncs the optimistic row away, so a refusal reported to nobody leaves the
    // user a toast and an empty box where their comment was.
    name: 'a refused comment survives in the composer it was typed in',
    testName: 'puts a refused comment back in the composer, and back in the draft',
    file: 'src/components/TaskComments.svelte',
    find: '    if (await board.createComment(taskId, doc)) return;\n    drafts.setDoc(key, doc);\n    posting?.replaceContent(doc);',
    replace: '    void board.createComment(taskId, doc);\n    void key;\n    void posting;',
    tests: ['src/components/TaskComments.test.ts'],
  },
  {
    // Read live rather than captured, the key names whichever card is on screen
    // when the refusal lands — so a switch files the text under the new card and
    // the one it was typed on comes back empty.
    name: 'a refused comment is filed under the card it was typed on',
    testName: 'keeps the text on its own card when the post is refused after a switch',
    file: 'src/components/TaskComments.svelte',
    find: '    drafts.setDoc(key, doc);',
    replace: '    drafts.setDoc(draftKeyForTask, doc);',
    tests: ['src/components/TaskComments.test.ts'],
  },
  {
    // The card panel refreshes this read every time it opens, so an ungated
    // failure clause gave every card opened offline a Blocked by heading over an
    // empty list — including cards that have no dependencies at all.
    name: 'a failed read grows no dependency section on a card without any',
    testName: 'renders nothing when the read fails on a card with no dependencies',
    file: 'src/components/TaskDependencies.svelte',
    find: '    entry?.error === true && (task?.open_cross_project_blocker_count ?? 0) > 0\n',
    replace: '    entry?.error === true\n',
    tests: ['src/components/TaskDependencies.test.ts'],
  },
  {
    // The try and catch arms have always been token-guarded; the finally was not,
    // so the failure is a live read reporting itself finished because an
    // abandoned one landed.
    name: 'an abandoned page does not clear the loading flag of the read that replaced it',
    testName: 'leaves the loading flag belonging to the load that replaced it',
    file: 'src/lib/myTasks.svelte.ts',
    find: '      if (token === this.#fetchToken) {\n        this.loadingMore = false;\n      }',
    replace: '      this.loadingMore = false;',
    tests: ['src/lib/myTasks.test.ts'],
  },
];
