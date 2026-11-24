import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { PREFIX, buildCard, pendingCard, tokenLevel, tokenParts } from './cards'
import type { Card } from './cards'

const ACCENT = 'suggestion' // a theme key: the card follows the person's theme
// The token row: theme keys for green, orange and red.
const LEVEL_COLOR = { low: 'success', mid: 'warning', high: 'error' } as const

// Ids of the cards the person has opened. A new tag declines what an older version stored.
const open = atom({ plugin: 'codescout-display', key: 'open' } as const, [] as string[], { shape: 'open-1' })

// The first non-empty line of a hook note: a closed card shows a note as one dim line.
const firstLine = (note: string): string => note.split('\n').find(l => l.trim() !== '') ?? ''

// Maps a Card to elements. `els` is the surface's element table, `$.ui.resolve(e)`: no `$` here.
// `toggle` is set when the card has something to open: hidden lines or hook notes.
// `status` is one dim line under the body: "running…" on the frame of a call that has not ended.
function drawCard(els: any, card: Card, isOpen: boolean, toggle?: () => unknown, status?: string): any {
  const { Box, Text, Code, Markdown, Button } = els
  const children: any[] = [<Text bold color={card.isMutating ? 'warning' : ACCENT}>{card.title}</Text>]
  if (card.params !== '') children.push(<Text dimColor wrap="truncate-end">{card.params}</Text>)
  const { body, command } = card

  if (command) {
    children.push(<Code source={isOpen ? command.full : command.source} language="bash" />)
    if (!isOpen && command.extra > 0) children.push(<Text dimColor>{`… ${command.extra} more command lines`}</Text>)
  }

  if (isOpen && (body.kind === 'text' || body.kind === 'fields')) {
    children.push(<Code source={card.full} />)
  } else if (body.kind === 'text') {
    for (const line of body.head) children.push(<Text wrap="truncate-end">{line}</Text>)
  } else if (body.kind === 'fields') {
    children.push(<Text dimColor>{body.line}</Text>)
  } else if (body.kind === 'diff') {
    children.push(<Code source={isOpen ? card.full : body.source} format="diff" path={body.path} />)
  } else if (body.kind === 'symbols') {
    for (const row of isOpen ? body.all : body.head) {
      if (row.type === 'code') {
        children.push(<Code source={row.source} path={row.path} />)
      } else if (row.type === 'label') {
        children.push(
          <Text wrap="truncate-end">
            <Text dimColor>{`${' '.repeat(row.indent)}${row.kind} `}</Text>
            <Text bold color={ACCENT}>{row.name}</Text>
            <Text dimColor>{`  ${row.range}`}</Text>
          </Text>,
        )
      } else {
        children.push(<Text dimColor wrap="truncate-end">{row.type === 'file' ? row.path : row.text}</Text>)
      }
    }
  } else {
    const source = isOpen ? card.full : body.source
    if (source !== '') {
      children.push(
        body.isMarkdown ? (
          <Markdown text={source} />
        ) : (
          <Code source={source} path={body.path} startLine={body.startLine} />
        ),
      )
    }
  }

  if (card.result) children.push(<Text dimColor>{card.result}</Text>)
  if (status) children.push(<Text dimColor>{status}</Text>)
  if (!isOpen && card.hidden > 0) children.push(<Text dimColor>{`… ${card.hidden} more lines hidden`}</Text>)
  for (const note of card.notes) {
    if (isOpen) {
      for (const line of note.split('\n')) if (line.trim() !== '') children.push(<Text dimColor>{`↳ ${line}`}</Text>)
    } else {
      children.push(<Text dimColor wrap="truncate-end">{`↳ ${firstLine(note)}`}</Text>)
    }
  }

  if (toggle) {
    const extra = command?.extra ?? 0
    const closed =
      card.hidden > 0
        ? `open (${card.hidden} more lines)`
        : extra > 0
          ? `open (${extra} more command lines)`
          : card.isCut
            ? 'open (full reply)'
            : 'open notes'
    children.push(<Button key="toggle" label={isOpen ? 'fold' : closed} onPress={toggle} />)
  }

  if (card.tokens) {
    children.push(
      <Box justifyContent="flex-end">
        <Text color={LEVEL_COLOR[tokenLevel('input', card.tokens.input)]}>{tokenParts(card.tokens).input}</Text>
        <Text dimColor>{' · '}</Text>
        <Text color={LEVEL_COLOR[tokenLevel('output', card.tokens.output)]}>{tokenParts(card.tokens).output}</Text>
      </Box>,
    )
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={ACCENT} paddingX={1} {...(command ? { width: '100%' } : {})}>
      {children}
    </Box>
  )
}

export const register: Register = on => {
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const p = e.props
    if (e.surface !== 'terminal' || p.isExpanded !== true) return next(e)
    if (!p.tool.startsWith(PREFIX) || p.isErrored || p.isInterrupted) return next(e)

    // No output yet: the frame, drawn from the first render so the border stays when the tool ends. No state read.
    if (p.output === undefined) return drawCard($.ui.resolve(e), pendingCard(p.tool, p.input), false, undefined, p.isRunning ? 'running…' : undefined)
    if (p.isRunning) return next(e)

    const card = buildCard(p.tool, p.input, p.output)
    if (!card) return next(e)

    if (!card.openable) return drawCard($.ui.resolve(e), card, false)

    const isOpen = (await read($, open)).includes(p.tool_use_id)
    const toggle = () => update($, open, ids => (isOpen ? ids.filter(id => id !== p.tool_use_id) : [...ids, p.tool_use_id]))

    return drawCard($.ui.resolve(e), card, isOpen, toggle)
  }).catch(($, e, next) => next(e))
}
