#!/bin/sh
# Tests for .githooks/format-touched, post-commit and post-rewrite.
#
#   sh .githooks/tests/format-touched.test.sh
#
# These hooks are the only code every package's commits run, and no package's
# CI filter reaches .githooks/ — .github/workflows/repo-ci.yaml exists to run
# this, and is the only thing that does.
#
# Nothing here touches a real repository or a real fixer: stub-git and stub-pnpm
# go first on PATH and each case gets a throwaway tree under $TMPDIR. The point
# is not only safety. Every case below turns on holding `git diff --quiet` to an
# exact per-file answer, and on changing that answer once the fixers have run —
# neither of which a scratch repository would hand over without a great deal of
# ceremony.

set -u

tests_dir=$(cd "$(dirname "$0")" && pwd)
hooks_dir=$(dirname "$tests_dir")
orig_path=$PATH

# git exports GIT_DIR to a hook, and format-touched honours it. Inherited here
# it would point every stubbed call at the real repository.
unset GIT_DIR

work=$(mktemp -d "${TMPDIR:-/tmp}/format-touched-tests.XXXXXX") || exit 1
trap 'rm -rf "$work"' EXIT
trap 'rm -rf "$work"; exit 1' INT TERM

cases=0
failures=0
case_name=''
case_failed=0
status=0

setup() {
  case_name=$1
  cases=$((cases + 1))
  case_failed=0

  sandbox=$work/$cases
  STUB_ROOT=$sandbox/repo
  STUB_LOG=$sandbox/log
  STUB_DIRTY=$sandbox/dirty-before
  STUB_DIRTY_AFTER=$sandbox/dirty-after
  STUB_COMMIT_FILES=$sandbox/commit-files
  export STUB_ROOT STUB_LOG STUB_DIRTY STUB_DIRTY_AFTER STUB_COMMIT_FILES
  unset STUB_EXIT
  unset SKIP_POST_COMMIT

  mkdir -p "$STUB_ROOT" "$STUB_LOG" "$sandbox/bin"
  : >"$STUB_DIRTY"
  : >"$STUB_DIRTY_AFTER"
  : >"$STUB_COMMIT_FILES"
  # Created up front so every assertion can read them without a existence dance.
  : >"$STUB_LOG/git.args"
  : >"$STUB_LOG/git.add"
  : >"$STUB_LOG/git.commit"
  : >"$STUB_LOG/git.commit.env"
  : >"$STUB_LOG/pnpm.args"
  : >"$STUB_LOG/stderr"

  # Copied rather than symlinked so a checkout that lost the executable bit on
  # the stubs fails here and not in the middle of a case.
  cp "$tests_dir/stub-git" "$sandbox/bin/git"
  cp "$tests_dir/stub-pnpm" "$sandbox/bin/pnpm"
  chmod +x "$sandbox/bin/git" "$sandbox/bin/pnpm"
  PATH=$sandbox/bin:$orig_path
  export PATH

  for setup_pkg in api web cli; do
    mkdir -p "$STUB_ROOT/$setup_pkg/node_modules/.bin" "$STUB_ROOT/$setup_pkg/src"
    for setup_tool in eslint prettier; do
      printf '#!/bin/sh\nexit 0\n' >"$STUB_ROOT/$setup_pkg/node_modules/.bin/$setup_tool"
      chmod +x "$STUB_ROOT/$setup_pkg/node_modules/.bin/$setup_tool"
    done
    printf 'export default [];\n' >"$STUB_ROOT/$setup_pkg/eslint.config.js"
    printf '{}\n' >"$STUB_ROOT/$setup_pkg/.prettierrc.json"
  done
  # preview-edge gets neither a fixer nor a config on purpose: that is the state
  # the real package is in, and one case below is about it.
  mkdir -p "$STUB_ROOT/preview-edge/src"
}

finish() {
  if [ "$case_failed" -eq 0 ]; then
    printf 'ok    %s\n' "$case_name"
  else
    failures=$((failures + 1))
  fi
}

fail() {
  case_failed=1
  printf 'FAIL  %s\n        %s\n' "$case_name" "$1" >&2
}

# Repo-relative path, created with content so `[ -f ]` finds it.
make_file() {
  mkdir -p "$STUB_ROOT/$(dirname "$1")"
  printf 'x\n' >"$STUB_ROOT/$1"
}

mark_dirty() { printf '%s\n' "$1" >>"$STUB_DIRTY"; }
mark_rewritten() { printf '%s\n' "$1" >>"$STUB_DIRTY_AFTER"; }
commit_touched() { printf '%s\n' "$1" >>"$STUB_COMMIT_FILES"; }

run_format_touched() {
  (cd "$STUB_ROOT" && sh "$hooks_dir/format-touched" "$@") \
    >"$STUB_LOG/stdout" 2>"$STUB_LOG/stderr"
  status=$?
}

run_post_commit() {
  (cd "$STUB_ROOT" && sh "$hooks_dir/post-commit") \
    >"$STUB_LOG/stdout" 2>"$STUB_LOG/stderr"
  status=$?
}

# $1 is git's argument; the rest are the `<old-sha> <new-sha>` lines it feeds on
# stdin. Written to a file rather than piped in: a pipeline runs its elements in
# subshells, and `status` set in one of those would not survive.
run_post_rewrite() {
  run_post_rewrite_arg=$1
  shift
  printf '%s\n' "$@" >"$sandbox/rewritten-shas"
  (cd "$STUB_ROOT" && sh "$hooks_dir/post-rewrite" "$run_post_rewrite_arg") \
    <"$sandbox/rewritten-shas" >"$STUB_LOG/stdout" 2>"$STUB_LOG/stderr"
  status=$?
}

fixer_calls() { tr '\n' ' ' <"$STUB_LOG/pnpm.args"; }

assert_status() {
  [ "$status" -eq "$1" ] || fail "expected exit $1, got $status"
}

# $1 is a whole recorded call: the arguments pnpm was handed, '|'-separated.
assert_fixer_ran() {
  grep -Fxq -- "$1" "$STUB_LOG/pnpm.args" ||
    fail "expected fixer call [$1]; recorded: $(fixer_calls)"
}

assert_fixer_count() {
  assert_fixer_count_n=$(wc -l <"$STUB_LOG/pnpm.args" | tr -d ' ')
  [ "$assert_fixer_count_n" -eq "$1" ] ||
    fail "expected $1 fixer calls, got $assert_fixer_count_n: $(fixer_calls)"
}

assert_no_fixers() {
  if [ -s "$STUB_LOG/pnpm.args" ]; then
    fail "expected no fixer to run; recorded: $(fixer_calls)"
  fi
}

assert_never_seen() {
  if grep -Fq -- "$1" "$STUB_LOG/pnpm.args"; then
    fail "no fixer should have been handed [$1]; recorded: $(fixer_calls)"
  fi
}

assert_no_amend() {
  if [ -s "$STUB_LOG/git.add" ] || [ -s "$STUB_LOG/git.commit" ]; then
    fail "expected no amend; git add: $(tr '\n' ' ' <"$STUB_LOG/git.add")"
  fi
}

assert_added() {
  grep -Fxq -- "$1" "$STUB_LOG/git.add" ||
    fail "expected [$1] to be staged; staged: $(tr '\n' ' ' <"$STUB_LOG/git.add")"
}

assert_stderr_has() {
  grep -Fq -- "$1" "$STUB_LOG/stderr" ||
    fail "expected a warning mentioning [$1]; stderr: $(tr '\n' ' ' <"$STUB_LOG/stderr")"
}

assert_stderr_silent() {
  if [ -s "$STUB_LOG/stderr" ]; then
    fail "expected silence; stderr: $(tr '\n' ' ' <"$STUB_LOG/stderr")"
  fi
}

assert_git_untouched() {
  if [ -s "$STUB_LOG/git.args" ]; then
    fail "expected git never to be called; calls: $(tr '\n' ' ' <"$STUB_LOG/git.args")"
  fi
}

# --- what gets bucketed, and what does not ----------------------------------

setup 'no arguments is a no-op'
run_format_touched
assert_status 0
assert_no_fixers
assert_no_amend
finish

setup 'a path no package owns is left alone'
# Root prose, a root-level source file, and two directories that are not
# packages. `rel=${f#*/}` would strip nothing useful from any of them, and no
# eslint or prettier config reaches outside a package to cover them.
make_file README.md
make_file notes.ts
make_file docs/notes.ts
make_file scripts/lib/repo-paths.mjs
run_format_touched README.md notes.ts docs/notes.ts scripts/lib/repo-paths.mjs
assert_status 0
assert_no_fixers
assert_no_amend
finish

setup 'preview-edge owns neither fixer, so its files are skipped'
make_file preview-edge/src/index.ts
run_format_touched preview-edge/src/index.ts
assert_status 0
assert_no_fixers
assert_no_amend
finish

setup 'a commit spanning three packages runs each package on its own paths'
# The bucketing this whole script exists for, and the trap its header names:
# every path goes in with the package prefix stripped, because `pnpm -C <pkg>`
# runs with cwd=<pkg> and api/src/a.ts there means api/api/src/a.ts.
make_file api/src/a.ts
make_file web/src/App.svelte
make_file cli/src/b.ts
run_format_touched api/src/a.ts web/src/App.svelte cli/src/b.ts
assert_status 0
assert_fixer_ran '-C|api|exec|eslint|--fix|src/a.ts|'
assert_fixer_ran '-C|api|exec|prettier|--write|--log-level|warn|src/a.ts|'
assert_fixer_ran '-C|web|exec|eslint|--fix|src/App.svelte|'
assert_fixer_ran '-C|web|exec|prettier|--write|--log-level|warn|src/App.svelte|'
assert_fixer_ran '-C|cli|exec|eslint|--fix|src/b.ts|'
assert_fixer_ran '-C|cli|exec|prettier|--write|--log-level|warn|src/b.ts|'
# Six exact calls and no seventh: no package was handed another's paths.
assert_fixer_count 6
finish

setup "each package sees only the extensions its own fixers can parse"
# Only web has prettier-plugin-svelte, so a .svelte under api/ must not be
# dispatched to api's prettier — it would exit on "Cannot find package".
make_file api/src/x.ts
make_file api/src/x.svelte
make_file api/src/x.json
make_file web/src/y.svelte
run_format_touched api/src/x.ts api/src/x.svelte api/src/x.json web/src/y.svelte
assert_fixer_ran '-C|api|exec|eslint|--fix|src/x.ts|'
assert_fixer_ran '-C|web|exec|eslint|--fix|src/y.svelte|'
assert_never_seen 'x.svelte'
assert_never_seen 'x.json'
assert_fixer_count 4
finish

# --- the files that must not be touched -------------------------------------

setup 'a file with unstaged changes is skipped so the amend cannot swallow it'
make_file api/src/clean.ts
make_file api/src/dirty.ts
mark_dirty api/src/dirty.ts
mark_rewritten api/src/clean.ts
run_format_touched api/src/clean.ts api/src/dirty.ts
assert_fixer_ran '-C|api|exec|eslint|--fix|src/clean.ts|'
assert_never_seen 'dirty.ts'
assert_added api/src/clean.ts
if grep -Fq 'dirty.ts' "$STUB_LOG/git.add"; then
  fail 'a file with unstaged work was staged into the amend'
fi
finish

setup 'a deleted path is skipped'
# post-commit lists what the commit touched, so a deletion arrives here as a
# path with nothing behind it.
make_file api/src/live.ts
run_format_touched api/src/gone.ts api/src/live.ts
assert_status 0
assert_fixer_ran '-C|api|exec|eslint|--fix|src/live.ts|'
assert_never_seen 'gone.ts'
assert_fixer_count 2
finish

setup 'a path containing a space is left unformatted rather than half-formatted'
# Known limitation, asserted so it stays a known one. The buckets are
# space-separated word lists, so `src/a b.ts` reaches the fixers as two
# arguments. What matters is that the damage stops there: neither name resolves,
# both fixers exit 2, the failure is printed, and nothing is staged or amended —
# the same shape as the no-config and no-binary paths. Fixing it properly means
# NUL-delimited plumbing through post-commit and post-rewrite as well, since
# both split their own file lists on whitespace before this script sees them.
STUB_EXIT=2
export STUB_EXIT
make_file 'api/src/a b.ts'
run_format_touched 'api/src/a b.ts'
assert_status 0
assert_fixer_ran '-C|api|exec|eslint|--fix|src/a|b.ts|'
assert_stderr_has 'eslint exited 2 in api'
assert_no_amend
finish

# --- when a fixer cannot run ------------------------------------------------

setup 'a package with no config of its own is named in a warning and skipped'
rm "$STUB_ROOT/cli/.prettierrc.json"
make_file cli/src/b.ts
run_format_touched cli/src/b.ts
assert_status 0
assert_fixer_ran '-C|cli|exec|eslint|--fix|src/b.ts|'
assert_fixer_count 1
assert_stderr_has 'cli has no prettier config of its own'
assert_no_amend
finish

setup 'a package with the fixer uninstalled is named in a warning and skipped'
rm "$STUB_ROOT/api/node_modules/.bin/eslint"
make_file api/src/a.ts
run_format_touched api/src/a.ts
assert_status 0
assert_fixer_ran '-C|api|exec|prettier|--write|--log-level|warn|src/a.ts|'
assert_fixer_count 1
assert_stderr_has "no eslint in api/node_modules"
finish

setup 'a fixer that only left problems behind is quiet'
# eslint exits 1 when problems remain after --fix. That is the normal case and
# must not print, or every commit gets noise.
STUB_EXIT=1
export STUB_EXIT
make_file api/src/a.ts
run_format_touched api/src/a.ts
assert_status 0
assert_stderr_silent
finish

setup 'a fixer that could not run at all is reported'
# Exit 2 is eslint failing to start — a misconfigured hook looks exactly like
# this, which is why it may not be swallowed.
STUB_EXIT=2
export STUB_EXIT
make_file api/src/a.ts
run_format_touched api/src/a.ts
assert_status 0
assert_stderr_has 'eslint exited 2 in api'
assert_stderr_has 'prettier exited 2 in api'
finish

# --- the amend, and the guard that stops it recursing -----------------------

setup 'nothing is amended when the fixers changed nothing'
make_file api/src/a.ts
run_format_touched api/src/a.ts
assert_status 0
assert_fixer_count 2
assert_no_amend
finish

setup 'a rewritten file is staged and folded into HEAD with the guard set'
make_file api/src/a.ts
make_file api/src/b.ts
mark_rewritten api/src/a.ts
run_format_touched api/src/a.ts api/src/b.ts
assert_added api/src/a.ts
if grep -Fq 'b.ts' "$STUB_LOG/git.add"; then
  fail 'a file the fixers did not change was staged'
fi
grep -Fxq -- '--amend --no-edit --no-verify' "$STUB_LOG/git.commit" ||
  fail "expected an amend; git commit: $(tr '\n' ' ' <"$STUB_LOG/git.commit")"
# Without this the amend fires post-commit, which fixes and amends again.
grep -Fxq -- '1' "$STUB_LOG/git.commit.env" ||
  fail 'the amend did not carry SKIP_POST_COMMIT=1'
finish

setup 'SKIP_POST_COMMIT stops post-commit re-entering after that amend'
commit_touched api/src/a.ts
make_file api/src/a.ts
SKIP_POST_COMMIT=1
export SKIP_POST_COMMIT
run_post_commit
unset SKIP_POST_COMMIT
assert_status 0
# It has to bail before the diff-tree, not merely before the fixers.
assert_git_untouched
assert_no_fixers
finish

# --- the two entry points ---------------------------------------------------

setup 'post-commit narrows a commit to the extensions the fixers know'
commit_touched api/src/a.ts
commit_touched api/README.md
commit_touched api/src/a.json
commit_touched web/src/App.svelte
make_file api/src/a.ts
make_file api/README.md
make_file api/src/a.json
make_file web/src/App.svelte
run_post_commit
assert_status 0
assert_fixer_ran '-C|api|exec|eslint|--fix|src/a.ts|'
assert_fixer_ran '-C|web|exec|eslint|--fix|src/App.svelte|'
assert_never_seen 'README.md'
assert_never_seen 'a.json'
assert_fixer_count 4
finish

setup 'post-rewrite steps aside for anything but a rebase'
# post-commit already handled the amend; running here too fixes the same files
# twice.
commit_touched api/src/a.ts
make_file api/src/a.ts
run_post_rewrite amend 'aaaa bbbb'
assert_status 0
assert_no_fixers
finish

setup 'post-rewrite formats the commits a rebase rewrote'
commit_touched api/src/a.ts
make_file api/src/a.ts
run_post_rewrite rebase 'aaaa bbbb' 'cccc dddd'
assert_status 0
assert_fixer_ran '-C|api|exec|eslint|--fix|src/a.ts|'
assert_fixer_count 2
finish

setup 'the hooks are executable, or git will not run them'
for hook in format-touched post-commit post-rewrite; do
  [ -x "$hooks_dir/$hook" ] || fail ".githooks/$hook is not executable"
done
finish

printf '\n%s cases, %s failed\n' "$cases" "$failures"
[ "$failures" -eq 0 ] || exit 1
