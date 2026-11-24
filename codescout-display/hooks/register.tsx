import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

const PREFIX = 'mcp__codescout__'

// Ids of the cards the person has opened. A new tag declines what an older version stored.
const open = atom({ plugin: 'codescout-display', key: 'open' } as const, [] as string[], { shape: 'open-1' })

// Task 1 gate probe. Tasks 2 to 4 replace this body with cards.
export const register: Register = on => {
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const p = e.props
    if (!p.tool.startsWith(PREFIX) || p.isRunning || p.output === undefined) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const isOpen = (await read($, open)).includes(p.tool_use_id)
    const toggle = () =>
      update($, open, ids => (isOpen ? ids.filter(id => id !== p.tool_use_id) : [...ids, p.tool_use_id]))

    return (
      <Box flexDirection="column">
        {await next(e)}
        <Button key="toggle" label={isOpen ? 'fold' : 'open'} onPress={toggle} />
        <Text>{isOpen ? 'OPEN' : 'closed'}</Text>
      </Box>
    )
  }).catch(($, e, next) => next(e))
}
