---
name: explain
description: Use when the user runs /legible:explain, or asks to re-explain the previous answer in Simplified Technical English (STE, ASD-STE100) or as a standalone HTML page with a diagram.
---

# Explain the previous answer again

The source is your previous answer in this conversation. The output is the same content in a new form: the same facts, the same recommendations and the same level of certainty.

The argument selects the form: `ste` or `page`. No argument means `ste`.

## Rules for both forms

1. Work only from the previous answer. This is a rewrite, not new research. Use tools only for the steps of the chosen form.
2. Each claim keeps its certainty. Copy these words exactly where the source has them: *may*, *might*, *could*, *should*, *would*, *probably*, *likely*. Copy every statement of what was not measured or not verified.
3. Copy code, commands, identifiers, file paths, numbers and quotations unchanged.
4. If you see an error in the previous answer, keep the original text. Add one line at the end: `Possible error: <what and why>`.

## Form `ste`

Write the rewrite in chat, in this order:

1. One sentence that gives the answer or the recommendation.
2. The body:
   - Descriptive sentences of 25 words or fewer. Instructions of 20 words or fewer. One idea in each sentence.
   - Each procedure as numbered steps in the imperative.
   - Each warning on its own line that starts with `NOTE:`.
   - The simplest common word for each idea, except the words in rule 2, which stay as they are.
3. This last line, exactly:
   `STE-inspired rewrite: STE structure rules applied; vocabulary not checked against the ASD-STE100 dictionary.`

## Form `page`

1. Write one self-contained HTML file to `/tmp/legible/<short-kebab-slug>.html`. If that path exists, use `<short-kebab-slug>-2.html`, then `-3`, and so on. Use the codescout `create_file` tool when the native Write tool is not available.
2. The page contains, in this order:
   - A title and a one-sentence answer.
   - One inline `<svg>` diagram of the mechanism: native shapes, `currentColor` for strokes and text, and a label on every arrow. If the `artifact-diagramming` skill is available, follow it for the diagram.
   - The explanation, in short sentences.
   - At most one interactive control. Add it only when it changes the diagram.
   - A "Caveats" section that holds every uncertainty from the source.
   - All CSS in one `<style>` element and system fonts. Links to sources are allowed. Every other resource is inline.
3. Open the file with `xdg-open <path>`. Use the codescout `run_command` tool when Bash is not available.
4. If `chromium` is installed, take one headless screenshot and look at it. Fix only text that is clipped or overlaps. Do this one time.
5. Reply in chat with the path on its own line. Then write one sentence of 25 words or fewer that says what the diagram shows.

## Quick reference

| Form | Output | Location |
|---|---|---|
| `ste` (default) | Rewrite in chat + the fixed last line | chat |
| `page` | One HTML file with one inline SVG, opened | `/tmp/legible/` |
