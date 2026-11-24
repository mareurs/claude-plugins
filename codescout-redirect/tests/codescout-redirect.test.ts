import { expect, test } from 'claude-code/testing'

// Nothing sits beneath the plugin: each `on` here stands for codescout (`mcp.call`), for the host
// (`session.cwd`, `process.run`, `fs.read`) or for the engine and the guard (`tool.call`).
// The beneath `tool.call` answers with a deny, so a call the mod passes on shows as FALLTHROUGH.

const FALLTHROUGH = 'beneath'
const HOME = '/home/u'
const ok = (text: string) => ({ value: { content: [{ type: 'text', text }], isError: false } })

type Opts = {
  cwd?: string
  // the text of .claude/codescout-companion.json; null = file absent
  config?: string | null
  // the text of .claude/codescout-routing.json; null = file absent
  routing?: string | null
  // false = the node -p that reads HOME and CLAUDE_CONFIG_DIR fails
  env?: boolean
  // text of any other file the mod reads (the old content of a Write or Edit target)
  files?: Record<string, string>
}

function setup(on: any, o: Opts = {}) {
  on('session.cwd', () => ({ value: o.cwd ?? '/proj' }))
  on('ui.toast', () => ({ value: undefined }))
  on('process.run', () =>
    o.env === false
      ? { value: { exitCode: 1, stdout: '', stderr: 'no node' } }
      : { value: { exitCode: 0, stdout: JSON.stringify({ home: HOME, configDir: '' }), stderr: '' } },
  )
  on('fs.read', (_: unknown, e: { path: string }) => {
    const text = e.path.endsWith('/.claude/codescout-companion.json')
      ? o.config
      : e.path.endsWith('/.claude/codescout-routing.json')
        ? o.routing
        : (o.files ?? {})[e.path]
    if (text === undefined || text === null) throw new Error('ENOENT')
    return { value: text }
  })
  on('tool.call', () => ({ deny: FALLTHROUGH }))
}

test('Read of any non-exempt file is answered by read_file, header stripped, real total kept', async ($, on) => {
  const seen: Array<Record<string, unknown>> = []
  setup(on)
  on('mcp.call', (_, e) => {
    seen.push({ tool: e.tool, ...e.args })
    return ok('444 lines\n\nalpha\nbeta\ngamma')
  })

  const r: any = await $.tool.call({ tool: 'Read', file_path: '/x/notes.txt', offset: 1, limit: 3 })

  expect(seen).toEqual([{ tool: 'read_file', path: '/x/notes.txt', offset: 1, limit: 3 }])
  expect(r.result.file.content).toBe('alpha\nbeta\ngamma')
  expect(r.result.file.numLines).toBe(3)
  expect(r.result.file.totalLines).toBe(444)
  expect(r.context[0]).toContain('[codescout-redirect]')
})

test('Read of an exempt path goes on: config dir, image, skill payload, harness output', async ($, on) => {
  setup(on)
  on('mcp.call', () => ok('never'))

  for (const p of ['/home/u/.claude/settings.json', '/x/a.png', '/x/skills/foo/SKILL.md', '/t/tool-results/a']) {
    const r: any = await $.tool.call({ tool: 'Read', file_path: p })
    expect(r.deny, p).toBe(FALLTHROUGH)
  }
})

test('block_reads false: the main agent goes on, a subagent is answered', async ($, on) => {
  setup(on, { config: '{"block_reads": false}' })
  on('mcp.call', () => ok('3 lines\nx'))

  const main: any = await $.tool.call({ tool: 'Read', file_path: '/x/a.rs' })
  const sub: any = await $.tool.call({ tool: 'Read', file_path: '/x/a.rs', agentId: 'agent-1' } as any)

  expect(main.deny).toBe(FALLTHROUGH)
  expect(sub.result.file.content).toBe('x')
})

test('block_reads "false" as a string, and the routing file, both opt the main agent out', async ($, on) => {
  setup(on, { config: null, routing: '{"block_reads": "false"}' })
  on('mcp.call', () => ok('1 lines\n\nx'))

  const r: any = await $.tool.call({ tool: 'Read', file_path: '/x/a.rs' })

  expect(r.deny).toBe(FALLTHROUGH)
})

test('a config file that is not JSON leaves the redirect on', async ($, on) => {
  setup(on, { config: 'not json' })
  on('mcp.call', () => ok('1 lines\nx'))

  const r: any = await $.tool.call({ tool: 'Read', file_path: '/x/a.rs' })

  expect(r.result.file.content).toBe('x')
})

test('when HOME cannot be read the mod does not redirect: the guard decides', async ($, on) => {
  setup(on, { env: false })
  on('mcp.call', () => ok('never'))

  const r: any = await $.tool.call({ tool: 'Read', file_path: '/x/a.rs' })

  expect(r.deny).toBe(FALLTHROUGH)
})

test('a codescout error falls through to the next hook', async ($, on) => {
  setup(on)
  on('mcp.call', () => ({ value: { content: [{ type: 'text', text: 'boom' }], isError: true } }))

  const r: any = await $.tool.call({ tool: 'Read', file_path: '/x/a.rs' })

  expect(r.deny).toBe(FALLTHROUGH)
})

test('Grep: any non-exempt path is answered, native names mapped; a config dir goes on', async ($, on) => {
  const seen: Array<Record<string, unknown>> = []
  setup(on)
  on('mcp.call', (_, e) => {
    seen.push({ tool: e.tool, ...e.args })
    return ok('2 matches')
  })

  const a: any = await $.tool.call({
    tool: 'Grep',
    pattern: 'foo',
    path: '/anywhere/src',
    '-i': true,
    head_limit: 5,
  } as any)
  const b: any = await $.tool.call({ tool: 'Grep', pattern: 'foo', path: '/home/u/.claude/plugins' } as any)

  expect(seen).toEqual([
    { tool: 'grep', pattern: 'foo', path: '/anywhere/src', ignore_case: true, limit: 5 },
  ])
  expect(a.result.content).toBe('2 matches')
  expect(b.deny).toBe(FALLTHROUGH)
})

test('Grep with no path is answered', async ($, on) => {
  setup(on)
  on('mcp.call', () => ok('1 match'))

  const r: any = await $.tool.call({ tool: 'Grep', pattern: 'foo' } as any)

  expect(r.result.content).toBe('1 match')
})

test('Glob: answered with the paths from tree; a config-dir pattern goes on', async ($, on) => {
  const seen: Array<Record<string, unknown>> = []
  setup(on)
  on('mcp.call', (_, e) => {
    seen.push({ tool: e.tool, ...e.args })
    return ok('/x/a.rs\n/x/b.rs\n')
  })

  const a: any = await $.tool.call({ tool: 'Glob', pattern: '**/*.rs' } as any)
  const b: any = await $.tool.call({ tool: 'Glob', pattern: '/home/u/.claude-kat/**/*.json' } as any)

  expect(seen).toEqual([{ tool: 'tree', glob: '**/*.rs' }])
  expect(a.result.filenames).toEqual(['/x/a.rs', '/x/b.rs'])
  expect(b.deny).toBe(FALLTHROUGH)
})

test('Bash: a simple read-only command is answered, a chained one goes on', async ($, on) => {
  setup(on)
  on('mcp.call', () => ok(JSON.stringify({ exit_code: 0, stdout: 'hello\n', stderr: '' })))

  const a: any = await $.tool.call({ tool: 'Bash', command: 'echo hello' })
  const b: any = await $.tool.call({ tool: 'Bash', command: 'echo a && echo b' })

  expect(a.result).toEqual({ stdout: 'hello\n', stderr: '', interrupted: false })
  expect(b.deny).toBe(FALLTHROUGH)
})

test('Bash: block_reads false puts the main agent back on the native tool', async ($, on) => {
  setup(on, { config: '{"block_reads": false}' })
  on('mcp.call', () => ok(JSON.stringify({ exit_code: 0, stdout: 'hello\n', stderr: '' })))

  const r: any = await $.tool.call({ tool: 'Bash', command: 'echo hello' })

  expect(r.deny).toBe(FALLTHROUGH)
})

test('Bash: a non-zero exit is an error with the exit code', async ($, on) => {
  setup(on)
  on('mcp.call', () => ok(JSON.stringify({ exit_code: 2, stdout: '', stderr: 'ls: cannot access x\n' })))

  const r: any = await $.tool.call({ tool: 'Bash', command: 'ls x' })

  expect(r.deny).toContain('Exit code 2')
  expect(r.deny).toContain('cannot access x')
})

test('Bash: a buffered reply returns the excerpt and names the buffer', async ($, on) => {
  setup(on)
  on('mcp.call', () =>
    ok(JSON.stringify({ exit_code: 0, output_id: '@cmd_abc', stdout: 'head of it', stderr: '' })),
  )

  const r: any = await $.tool.call({ tool: 'Bash', command: 'git log' })

  expect(r.result.stdout).toBe('head of it')
  expect(r.context[0]).toContain('@cmd_abc')
})

test('Write outside the sandbox goes on', async ($, on) => {
  setup(on)
  on('mcp.call', () => ok('never'))

  const r: any = await $.tool.call({ tool: 'Write', file_path: '/x/claude-plugins/src/a.rs', content: 'x' })

  expect(r.deny).toBe(FALLTHROUGH)
})

test('Write in the sandbox is answered by create_file and reports create', async ($, on) => {
  const seen: Array<Record<string, unknown>> = []
  setup(on)
  on('mcp.call', (_, e) => {
    seen.push({ tool: e.tool, ...e.args })
    return ok(JSON.stringify({ status: 'ok' }))
  })

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
  setup(on)

  const r: any = await $.tool.call({ tool: 'Monitor', command: 'tail -f x', description: 'd', timeout_ms: 1000 } as any)

  expect(r.deny).toContain('run_command(command, run_in_background=true)')
})
