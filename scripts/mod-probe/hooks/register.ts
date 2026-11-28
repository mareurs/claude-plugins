// mod-probe: measures, in one `claude -p` run, which events reach a user-tier mod under this
// machine's policy, and what a file read and a process start cost from inside Claude Code.
// Results go to out.json next to this plugin; summarize.mjs prints them with the debug log.
import type { Register } from 'claude-code'

const now = (): number => (globalThis as any).performance?.now?.() ?? Date.now()
const results: Record<string, number[]> = {}
const notes: Record<string, string> = {}
const rec = (k: string, ms: number) => { (results[k] ||= []).push(Math.round(ms * 100) / 100) }
let probed = false

async function flush($: any) {
  await $.fs.write(`${$.plugin.root}/out.json`, JSON.stringify({ notes, results }, null, 1))
}

async function time(k: string, f: () => Promise<any>) {
  const t = now()
  try {
    const r = await f()
    if (r && typeof r.exitCode === 'number' && r.exitCode !== 0) notes[k] = `exit ${r.exitCode}`
  } catch (err) {
    notes[k] = 'failed: ' + String(err).slice(0, 120)
  }
  rec(k, now() - t)
}

async function probes($: any) {
  if (probed) return
  probed = true
  const info = await $.session.info()
  const win = info.platform === 'windows'
  const cwd = await $.session.cwd()
  notes.platform = String(info.platform)
  // The first python that answers is the one timed.
  let py: string[] | null = null
  for (const c of win ? [['py', '-c', 'pass'], ['python', '-c', 'pass']] : [['python3', '-c', 'pass']]) {
    try { if ((await $.process.run(c)).exitCode === 0) { py = c; break } } catch { /* next */ }
  }
  notes.python = py?.[0] ?? 'none found'
  for (let i = 0; i < 5; i++) {
    await time('fs.read (in-process)', () => $.fs.read(`${$.plugin.root}/hooks/hooks.json`))
    await time('env.get (in-process)', () => $.env.get('PATH'))
    await time('process: empty shell command', () => $.process.run(win ? ['cmd', '/c', 'exit', '0'] : ['true']))
    await time('process: git status', () => $.process.run(['git', 'status', '--porcelain'], { cwd }))
    await time('process: node -e ""', () => $.process.run(['node', '-e', '']))
    if (py) await time(`process: ${notes.python} -c pass`, () => $.process.run(py!))
  }
  await flush($)
}

export const register: Register = (on) => {
  // Each hook records that its event reached the mod, then passes the event on unchanged.
  on('session.start', async ($: any, e: any, next: any) => { rec('reached session.start', 0); const r = await next(e); await probes($); await flush($); return r }).catch(($: any, e: any, next: any) => next(e))
  on('prompt.submit', async ($: any, e: any, next: any) => { rec('reached prompt.submit', 0); const r = await next(e); await probes($); await flush($); return r }).catch(($: any, e: any, next: any) => next(e))
  on('turn.start', async ($: any, e: any, next: any) => { rec('reached turn.start', 0); const r = await next(e); await flush($); return r }).catch(($: any, e: any, next: any) => next(e))
  on('turn.complete', async ($: any, e: any, next: any) => { rec('reached turn.complete', 0); const r = await next(e); await flush($); return r }).catch(($: any, e: any, next: any) => next(e))
  on('prompt.compose', async ($: any, e: any, next: any) => { rec('reached prompt.compose', 0); const r = await next(e); await flush($); return r }).catch(($: any, e: any, next: any) => next(e))
  on('classic.SessionStart', async ($: any, e: any, next: any) => { rec('reached classic.SessionStart', 0); const r = await next(e); await flush($); return r }).catch(($: any, e: any, next: any) => next(e))
  on('classic.UserPromptSubmit', async ($: any, e: any, next: any) => { rec('reached classic.UserPromptSubmit', 0); const r = await next(e); await flush($); return r }).catch(($: any, e: any, next: any) => next(e))
  on('classic.PreToolUse', async ($: any, e: any, next: any) => { rec('reached classic.PreToolUse', 0); const r = await next(e); await flush($); return r }).catch(($: any, e: any, next: any) => next(e))
  on('classic.PostToolUse', async ($: any, e: any, next: any) => { rec('reached classic.PostToolUse', 0); const r = await next(e); await flush($); return r }).catch(($: any, e: any, next: any) => next(e))
  on('classic.Stop', async ($: any, e: any, next: any) => { rec('reached classic.Stop', 0); const r = await next(e); await flush($); return r }).catch(($: any, e: any, next: any) => next(e))
  on('tool.call', async ($: any, e: any, next: any) => {
    rec('reached tool.call', 0)
    await probes($)
    const r = await next(e)
    await flush($)
    return r
  }).catch(($: any, e: any, next: any) => next(e))
}
