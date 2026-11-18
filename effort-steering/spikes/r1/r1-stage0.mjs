// Stage 0 of the R1 experiment: the failing test's output at the parent commit, as a trace prompt. No model call.
//
//   captureTrace(manifest, { workRoot, image, cpus, memoryGb, grade = gradeTree }) -> Promise<string>
//   runStage0({ workRoot, outRoot, taskIds, image, cpus, memoryGb, capture = captureTrace, log }) -> Promise<{ report, usable }>
//   savedOutputCapture(outRoot) -> capture      reads the f2p.out an earlier run saved (no Docker); `stage0 --reuse-output` uses it
//
// The grade container is S5's own (gradeTree): the built P tree with the hidden tests grafted in. gradeTree sets no
// RUST_BACKTRACE, so the f2p command gets an `env RUST_BACKTRACE=1` prefix on a copy of the manifest. S5_KEEP_GRADES=1 makes
// gradeTree keep the grade directory, whose results/f2p.out is the raw output.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

// A capture that does not call Docker: it returns the f2p.out that an earlier stage 0 saved in <outRoot>/stage0. runStage0 then rebuilds
// the prompt, the report and the hashes from the same raw output (the build-hint sentence changed the prompt, not the trace).
export function savedOutputCapture(outRoot) {
  return async (manifest) => {
    const file = join(outRoot, 'stage0', `${manifest.id}.f2p.out`);
    try {
      return readFileSync(file, 'utf8');
    } catch (err) {
      throw new Error(`savedOutputCapture: cannot read ${file}: ${err.message}`);
    }
  };
}


export async function runStage0({ workRoot, outRoot, taskIds, image, cpus, memoryGb, capture = captureTrace, log = console.log }) {
  const dir = join(outRoot, 'stage0');
  mkdirSync(dir, { recursive: true });
  const report = [];
  for (const id of taskIds) {
    const manifest = JSON.parse(readFileSync(join(workRoot, 'tasks', id, 'manifest.json'), 'utf8'));
    const output = await capture(manifest, { workRoot, image: image ?? IMAGE_FOR_REPO[manifest.repo], cpus, memoryGb });
    // The saved output is the only copy of a capture: it is written when it is new or different, and never rewritten with its own text.
    const savedFile = join(dir, `${id}.f2p.out`);
    if (!existsSync(savedFile) || readFileSync(savedFile, 'utf8') !== output) writeFileSync(savedFile, output);
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
