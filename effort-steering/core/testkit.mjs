// Minimal dependency-free test helper. Prints TAP-like lines and sets a
// non-zero exit code when any test throws, so tests/run-all.sh sees the failure.
export function t(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.log(`not ok - ${name}`);
    console.log(String(err && err.stack ? err.stack : err));
    process.exitCode = 1;
  }
}
