// Records that constitutional review ran for the current project. Invoked by the
// /review command in place of the old `touch /tmp/.sdd-reviewed-<md5>` shell line.
// Uses process.cwd() as the project dir (parity with the old $PWD-based marker)
// and the shared lib.reviewMarker path so review-guard reads the same file.
import { writeFileSync } from 'node:fs';
import { reviewMarker } from './lib.mjs';

try {
  writeFileSync(reviewMarker(process.cwd()), '');
} catch {
  // fail-open: marking is best-effort
}
process.exit(0);
