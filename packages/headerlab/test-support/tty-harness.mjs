/**
 * Runs the CLI with `process.stdin.isTTY` (and, on request, `stdout`) set to
 * `true` while the streams themselves are ordinary pipes the test can drive.
 *
 * Node cannot open a pty without a dependency, and this package's runtime
 * dependency count is zero on purpose. So the seam is the property the CLI
 * actually reads: `bin/headerlab.mjs` decides "is a person at a terminal" by
 * looking at `isTTY` on these two streams and nothing else (measured —
 * `grep -rn 'isTTY' lib/ bin/`), and every branch behind that check is one no
 * test could reach before, because `node --test` gives its children pipes.
 *
 * **What this does not prove.** It exercises the branch, not the terminal: a
 * real pty also gives line discipline, echo, and a SIGINT on Ctrl-C, none of
 * which is simulated here. It is the right instrument for "does the confirm
 * prompt settle on EOF" and the wrong one for "does the cursor come back".
 *
 * **Lives outside `test/` on purpose.** Node's test runner treats every `.mjs`
 * anywhere under a directory named `test` as a test file, so parking it there
 * made `pnpm test` execute the CLI once per run — printing the top-level help
 * into the report and counting it as a passing test. Not shipped either way:
 * `package.json`'s `files` is `bin` and `lib`.
 */
process.stdin.isTTY = true;
if (process.env.HEADERLAB_TEST_STDOUT_TTY === '1') process.stdout.isTTY = true;
if (process.env.HEADERLAB_TEST_STDERR_TTY === '1') process.stderr.isTTY = true;

await import(new URL('../bin/headerlab.mjs', import.meta.url));
