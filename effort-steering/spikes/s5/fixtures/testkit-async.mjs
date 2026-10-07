
// testkit-async.mjs — the async twin of ../../../core/testkit.mjs's `t`.
//
// A copy of the `ta` helper in ../../s4-run.test.mjs (controller ruling R4): testkit's `t`
// is sync, so this awaits the body and sets the exit code the same way, which keeps
// tests/run-all.sh seeing a failure. Use `await ta(...)` at the top level of a test file.

export async function ta(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.log(`not ok - ${name}`);
    console.log(String(err && err.stack ? err.stack : err));
    process.exitCode = 1;
  }
}
