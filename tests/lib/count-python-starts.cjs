// Observe successful child creation at Node's actual spawn boundary on every OS.
// A shell wrapper on PATH is bypassed by native Windows executable resolution.
const {appendFileSync} = require('node:fs');
const {basename} = require('node:path');
const childProcess = require('node:child_process');
const {syncBuiltinESMExports} = require('node:module');
const original = childProcess.spawnSync;
childProcess.spawnSync = function (command, ...args) {
  const result = original.call(this, command, ...args);
  if (/^(?:python3?|py)(?:\.exe)?$/i.test(basename(command)) && result.pid > 0) {
    appendFileSync(process.env.CPH_COUNTER_PATH, 'x\n');
  }
  return result;
};
syncBuiltinESMExports();
