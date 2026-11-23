import { expect, test } from 'claude-code/testing'

// Nothing sits beneath the plugin: each `on` here stands for codescout (the
// `mcp.call` and `fs.read` ops) or for the engine and the guard (`tool.call`).
// The beneath `tool.call` answers with a deny, so a call the mod passes on
// shows as FALLTHROUGH.

const FALLTHROUGH = 'beneath'
const ok = (text: string) => ({ value: { content: [{ type: 'text', text }], isError: false } })

test('Read of an in-scope file is answered by read_file, header stripped', async ($, on) => {
  const seen: Array<Record<string, unknown>> = []
  on('mcp.call', (_, e) => {
    seen.push({ tool: e.tool, ...e.args })
    return ok('3 lines\n\nalpha\nbeta\ngamma')
  })
  on('tool.call', () => ({ deny: FALLTHROUGH }))

  const r: any = await $.tool.call({
    tool: 'Read',
    file_path: '/x/claude-plugins/a/b.mjs',
    offset: 1,
    limit: 3,
  })

  expect(seen).toEqual([{ tool: 'read_file', path: '/x/claude-plugins/a/b.mjs', offset: 1, limit: 3 }])
  expect(r.result.file.content).toBe('alpha\nbeta\ngamma')
  expect(r.result.file.startLine).toBe(1)
  expect(r.context[0]).toContain('[codescout-redirect]')
})

test('Read of a file outside the scope goes on', async ($, on) => {
  on('mcp.call', () => ok('never'))
  on('tool.call', () => ({ deny: FALLTHROUGH }))

  const r: any = await $.tool.call({ tool: 'Read', file_path: '/x/other/notes.txt' })

  expect(r.deny).toBe(FALLTHROUGH)
})

test('a codescout error falls through to the next hook', async ($, on) => {
  on('mcp.call', () => ({ value: { content: [{ type: 'text', text: 'boom' }], isError: true } }))
  on('tool.call', () => ({ deny: FALLTHROUGH }))

  const r: any = await $.tool.call({ tool: 'Read', file_path: '/x/claude-plugins/a.mjs' })

  expect(r.deny).toBe(FALLTHROUGH)
})

test('Grep maps the native names and answers with the codescout text', async ($, on) => {
  const seen: Array<Record<string, unknown>> = []
  on('mcp.call', (_, e) => {
    seen.push({ tool: e.tool, ...e.args })
    return ok('2 matches')
  })
  on('tool.call', () => ({ deny: FALLTHROUGH }))

  const r: any = await $.tool.call({
    tool: 'Grep',
    pattern: 'foo',
    path: '/x/claude-plugins/hooks',
    '-i': true,
    head_limit: 5,
  } as any)

  expect(seen).toEqual([
    { tool: 'grep', pattern: 'foo', path: '/x/claude-plugins/hooks', ignore_case: true, limit: 5 },
  ])
  expect(r.result.content).toBe('2 matches')
})

test('Bash: a simple read-only command is answered, a chained one goes on', async ($, on) => {
  on('mcp.call', () => ok(JSON.stringify({ exit_code: 0, stdout: 'hello\n', stderr: '' })))
  on('tool.call', () => ({ deny: FALLTHROUGH }))

  const a: any = await $.tool.call({ tool: 'Bash', command: 'echo hello' })
  const b: any = await $.tool.call({ tool: 'Bash', command: 'echo a && echo b' })

  expect(a.result).toEqual({ stdout: 'hello\n', stderr: '', interrupted: false })
  expect(b.deny).toBe(FALLTHROUGH)
})

test('Bash: a non-zero exit is an error with the exit code', async ($, on) => {
  on('mcp.call', () =>
    ok(JSON.stringify({ exit_code: 2, stdout: '', stderr: 'ls: cannot access x\n' })),
  )
  on('tool.call', () => ({ deny: FALLTHROUGH }))

  const r: any = await $.tool.call({ tool: 'Bash', command: 'ls x' })

  expect(r.deny).toContain('Exit code 2')
  expect(r.deny).toContain('cannot access x')
})

test('Bash: a buffered reply returns the excerpt and names the buffer', async ($, on) => {
  on('mcp.call', () =>
    ok(JSON.stringify({ exit_code: 0, output_id: '@cmd_abc', stdout: 'head of it', stderr: '' })),
  )
  on('tool.call', () => ({ deny: FALLTHROUGH }))

  const r: any = await $.tool.call({ tool: 'Bash', command: 'git log' })

  expect(r.result.stdout).toBe('head of it')
  expect(r.context[0]).toContain('@cmd_abc')
})

test('Write outside the sandbox goes on', async ($, on) => {
  on('mcp.call', () => ok('never'))
  on('tool.call', () => ({ deny: FALLTHROUGH }))

  const r: any = await $.tool.call({ tool: 'Write', file_path: '/x/claude-plugins/src/a.rs', content: 'x' })

  expect(r.deny).toBe(FALLTHROUGH)
})

test('Write in the sandbox is answered by create_file and reports create or update', async ($, on) => {
  const seen: Array<Record<string, unknown>> = []
  on('mcp.call', (_, e) => {
    seen.push({ tool: e.tool, ...e.args })
    return ok(JSON.stringify({ status: 'ok' }))
  })
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('tool.call', () => ({ deny: FALLTHROUGH }))

  const r: any = await $.tool.call({
    tool: 'Write',
    file_path: '/x/claude-plugins/redirect-probe-sandbox/p.txt',
    content: 'alpha',
  })

  expect(seen[0]?.tool).toBe('create_file')
  expect(r.result.type).toBe('create')
  expect(r.result.originalFile).toBeNull()
})

test('Monitor is refused with the fix', async ($, on) => {
  on('tool.call', () => ({ deny: FALLTHROUGH }))

  const r: any = await $.tool.call({ tool: 'Monitor', command: 'tail -f x', description: 'd', timeout_ms: 1000 } as any)

  expect(r.deny).toContain('run_command(command, run_in_background=true)')
})
