import type { Register } from 'claude-code'

import { PREFIX, buildCard } from './cards'
import type { Card } from './cards'

const ACCENT = 'suggestion' // a theme key: the card follows the person's theme

// The first non-empty line of a hook note: a note is one dim line on the card.
const firstLine = (note: string): string => note.split('\n').find(l => l.trim() !== '') ?? ''

// Maps a Card to elements. `els` is the surface's element table, `$.ui.resolve(e)`: no `$` here.
function drawCard(els: any, card: Card): any {
  const { Box, Text, Code, Markdown } = els
  const children: any[] = [<Text bold color={ACCENT}>{card.title}</Text>]
  const { body } = card

  if (body.kind === 'text') {
    for (const line of body.head) children.push(<Text wrap="truncate-end">{line}</Text>)
  } else if (body.kind === 'fields') {
    children.push(<Text dimColor>{body.line}</Text>)
  } else if (body.kind === 'diff') {
    children.push(<Code source={body.source} format="diff" path={body.path} />)
  } else if (body.source !== '') {
    children.push(
      body.isMarkdown ? (
        <Markdown text={body.source} />
      ) : (
        <Code source={body.source} path={body.path} startLine={body.startLine} />
      ),
    )
  }

  if (card.hidden > 0) children.push(<Text dimColor>{`… ${card.hidden} more lines hidden`}</Text>)
  for (const note of card.notes) children.push(<Text dimColor wrap="truncate-end">{`↳ ${firstLine(note)}`}</Text>)

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={ACCENT} paddingX={1}>
      {children}
    </Box>
  )
}

export const register: Register = on => {
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const p = e.props
    if (e.surface !== 'terminal' || p.isExpanded !== true) return next(e)
    if (!p.tool.startsWith(PREFIX) || p.isRunning || p.isErrored || p.output === undefined) return next(e)

    const card = buildCard(p.tool, p.input, p.output)
    if (!card) return next(e)

    return drawCard($.ui.resolve(e), card)
  }).catch(($, e, next) => next(e))
}
