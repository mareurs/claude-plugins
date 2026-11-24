// The stored state of the mod: the ids of the cards the person has opened.
// Change the tag in register.tsx (`shape`) when this type changes.
export type OpenIds = string[]

declare module 'claude-code' {
  interface PluginState {
    'codescout-display': { open: Shaped<OpenIds> }
  }
}
