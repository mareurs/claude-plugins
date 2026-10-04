// Spike S1 (throwaway): which fields does a UserPromptSubmit hook receive?
//
// Reads the hook input JSON on stdin and writes { keys: { [name]: typeof value } }
// to the file named by env S1_OUT. It stores key names and typeof only, never a
// value, so no prompt text can reach the output file. It prints nothing to stdout
// (hook stdout can inject context into a session) and exits 0 on every input.

import { writeFileSync } from 'node:fs';

function typeName(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => resolve(''));
  });
}

try {
  const outPath = process.env.S1_OUT;
  if (outPath) {
    const input = JSON.parse(await readStdin());
    if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
      const keys = {};
      for (const [name, value] of Object.entries(input)) keys[name] = typeName(value);
      writeFileSync(outPath, JSON.stringify({ keys }) + '\n');
    }
  }
} catch {
  // Fail open: swallow everything. A spike hook must never disturb a session.
}
process.exit(0);
