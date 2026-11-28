#!/usr/bin/env node
// Prints what mod-probe measured: whether the mod loaded, which events reached it, what an
// in-process read and a process start cost, and what each command hook cost in the same session.
// Usage: node summarize.mjs <debug.log> <out.json>
import { readFileSync, existsSync } from 'node:fs'

const [logPath, outPath] = process.argv.slice(2)
const log = existsSync(logPath) ? readFileSync(logPath, 'utf8').split(/\r?\n/) : []
const out = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : { notes: {}, results: {} }
const med = (v) => [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)]
const pad = (s, n) => String(s).padEnd(n)
const padl = (s, n) => String(s).padStart(n)

console.log('== mod-probe')
const loaded = log.some((l) => /hooks module mod-probe@\S+ loaded/.test(l))
console.log(`mod loaded: ${loaded ? 'yes' : 'NO'}`)
for (const l of log.filter((l) => /mod-probe/.test(l) && /refus|denied|not load|blocked|policy|admitted/i.test(l)).slice(0, 8)) {
  console.log('  ' + l.replace(/^\S+ \[DEBUG\] /, ''))
}
for (const [k, v] of Object.entries(out.notes || {})) console.log(`${k}: ${v}`)

console.log('\n== events')
const expected = ['session.start', 'prompt.submit', 'turn.start', 'turn.complete', 'prompt.compose', 'tool.call',
  'classic.SessionStart', 'classic.UserPromptSubmit', 'classic.PreToolUse', 'classic.PostToolUse', 'classic.Stop']
const bypassed = new Set()
for (const l of log) {
  const m = l.match(/mod-probe[a-z+-]*: (\S+) bypassed by (\S+)/)
  if (m) bypassed.add(`${m[1]} (by ${m[2]})`)
}
for (const ev of expected) {
  const n = (out.results || {})['reached ' + ev]?.length || 0
  const b = [...bypassed].find((x) => x.startsWith(ev + ' '))
  console.log(`${pad(ev, 26)} ${n ? `reached x${n}` : b ? 'BYPASSED ' + b.slice(ev.length + 1) : 'not seen'}`)
}

console.log('\n== cost from inside Claude Code (ms, 5 runs)')
for (const [k, v] of Object.entries(out.results || {})) {
  if (k.startsWith('reached ')) continue
  console.log(`${pad(k, 34)} min ${padl(Math.min(...v).toFixed(1), 8)}   median ${padl(med(v).toFixed(1), 8)}`)
}

console.log('\n== command hooks in the same session (ms)')
const pat = /^\S+ \[DEBUG\] Hooks: (\S+?)(?::\S+)? \[(.*?)\] \(plugin ([^@)]+)[^)]*\) finished with status \d+ \((\d+)ms\)/
const byHook = new Map()
const groups = []
let last = null
for (const l of log) {
  const m = l.match(pat)
  if (!m) continue
  const [, ev, cmd, plugin, ms] = m
  const name = (cmd.replace(/"/g, ' ').trim().split(/\s+/).pop() || '?').replace(/.*[\\/]/, '')
  // A new run starts at another event, or when the same hook shows up again in the current run.
  const key = `${ev} ${plugin} ${name}`
  if (ev !== last || groups.at(-1).keys.has(key)) { groups.push({ ev, hs: [], keys: new Set() }); last = ev }
  groups.at(-1).hs.push(+ms)
  groups.at(-1).keys.add(key)
  if (!byHook.has(key)) byHook.set(key, [])
  byHook.get(key).push(+ms)
}
const perEv = new Map()
for (const g of groups) {
  if (!perEv.has(g.ev)) perEv.set(g.ev, [])
  perEv.get(g.ev).push(g.hs)
}
console.log(`${pad('event', 18)} ${padl('runs', 5)} ${padl('procs/run', 10)} ${padl('sum/run', 9)} ${padl('max/run', 9)}`)
for (const [ev, runs] of perEv) {
  const n = runs.length
  const avg = (f) => (runs.reduce((a, hs) => a + f(hs), 0) / n).toFixed(0)
  console.log(`${pad(ev, 18)} ${padl(n, 5)} ${padl((runs.reduce((a, hs) => a + hs.length, 0) / n).toFixed(1), 10)} ${padl(avg((hs) => hs.reduce((a, b) => a + b, 0)), 9)} ${padl(avg((hs) => Math.max(...hs)), 9)}`)
}
console.log('')
for (const [k, v] of [...byHook].sort((a, b) => med(b[1]) - med(a[1]))) {
  console.log(`${pad(k, 70)} median ${padl(med(v), 6)}  n=${v.length}`)
}
