// Stage 0 of the R1 experiment: the failing test's output at the parent commit, as a trace prompt. No model call.
//
//   captureTrace(manifest, { workRoot, image, cpus, memoryGb, grade = gradeTree }) -> Promise<string>
//   runStage0({ workRoot, outRoot, taskIds, image, cpus, memoryGb, capture = captureTrace, log }) -> Promise<{ report, usable }>
//
// The grade container is S5's own (gradeTree): the built P tree with the hidden tests grafted in. gradeTree sets no
// RUST_BACKTRACE, so the f2p command gets an `env RUST_BACKTRACE=1` prefix on a copy of the manifest. S5_KEEP_GRADES=1 makes
// gradeTree keep the grade directory, whose results/f2p.out is the raw output.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gradeTree, removeGradeDir } from '../s5/grade.mjs';
import { IMAGE_FOR_REPO } from '../s5/task-def.mjs';
import { buildTracePrompt, checkTracePrompt, traceFromTestOutput } from './r1-prompt.mjs';

export const MIN_USABLE = 12;

export async function captureTrace(manifest, { workRoot, image, cpus, memoryGb, grade = gradeTree }) {
  if (manifest?.def?.testRunner !== 'cargo') throw new Error(`captureTrace: ${manifest?.id} is not a cargo task; R1 covers Rust fixes only`);
  const withBacktrace = {
    ...manifest,
    def: { ...manifest.def, f2p: { ...manifest.def.f2p, command: ['env', 'RUST_BACKTRACE=1', ...manifest.def.f2p.command] } },
  };
  const options = { workRoot, image, runId: `r1-${manifest.id}`, ...(cpus === undefined ? {} : { cpus }), ...(memoryGb === undefined ? {} : { memoryGb }) };
  const before = process.env.S5_KEEP_GRADES;
  process.env.S5_KEEP_GRADES = '1';
  let result;
  try {
    result = await grade(withBacktrace, join(workRoot, 'tasks', manifest.id, 'tree'), options);
  } finally {
    if (before === undefined) delete process.env.S5_KEEP_GRADES;
    else process.env.S5_KEEP_GRADES = before;
  }
  if (!result?.kept) throw new Error(`captureTrace: grade of ${manifest.id} kept no directory (S5_KEEP_GRADES was not honoured)`);
  try {
    return readFileSync(join(result.kept, 'results', 'f2p.out'), 'utf8');
  } finally {
    removeGradeDir(result.kept);
  }
}

export async function runStage0({ workRoot, outRoot, taskIds, image, cpus, memoryGb, capture = captureTrace, log = console.log }) {
  const dir = join(outRoot, 'stage0');
  mkdirSync(dir, { recursive: true });
  const report = [];
  for (const id of taskIds) {
    const manifest = JSON.parse(readFileSync(join(workRoot, 'tasks', id, 'manifest.json'), 'utf8'));
    const output = await capture(manifest, { workRoot, image: image ?? IMAGE_FOR_REPO[manifest.repo], cpus, memoryGb });
    writeFileSync(join(dir, `${id}.f2p.out`), output);
    const trace = traceFromTestOutput(output);
    let entry;
    if (trace === null) {
      entry = { id, ok: false, reasons: ['no_failure_block'], f2pNamesShown: false, chars: 0, promptSha256: null };
    } else {
      const prompt = buildTracePrompt(trace);
      const check = checkTracePrompt(prompt, manifest.def);
      writeFileSync(join(dir, `${id}.prompt.txt`), prompt);
      entry = { id, ok: check.ok, reasons: check.reasons, f2pNamesShown: check.f2pNamesShown, chars: prompt.length, promptSha256: createHash('sha256').update(prompt).digest('hex') };
    }
    report.push(entry);
    log(`${id} ${entry.ok ? 'ok' : `not ok (${entry.reasons.join(', ')})`} chars=${entry.chars} f2pNamesShown=${entry.f2pNamesShown}`);
  }
  writeFileSync(join(dir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return { report, usable: report.filter((r) => r.ok).length };
}
