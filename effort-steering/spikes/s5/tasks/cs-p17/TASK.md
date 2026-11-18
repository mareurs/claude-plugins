# Task: `migrate-memories --in-place` must be able to embed a long memory

## Background

A project's memories are markdown notes under `.codescout/memories/`. Each one is also kept in the
semantic memory store (the note's content plus one dense vector), which is what recall searches. With
`CODESCOUT_VECTOR_BACKEND=sqlite-vec` that store is a sqlite-vec database that ranks by L2 distance, so
the vectors in it are expected to have length 1, as the vectors an embedding backend returns do.

`codescout migrate-memories --in-place` repairs the store after a change of embedding setup. It runs two
passes, in this order:

1. It re-derives the vector of every memory already in the store, from the content the store holds.
2. It embeds every memory on disk that has no entry in the store yet.

It prints one JSON object with, among others, `read`, `upserted` and `skipped`. A memory whose
embedding fails is counted in `skipped` and the run goes on; the vector a stored memory already had is
left as it was.

Dense vectors come from an OpenAI-compatible endpoint (`POST {url}/v1/embeddings`). A real backend has
a limit on the size of one input and refuses a longer one. llama.cpp, for example, answers HTTP 500 with
`input is too large to process. increase the physical batch size`.

## Observed

Scenario: a stub backend that refuses any single input longer than 1,500 characters. The project has
three memories: a short note on disk, a note on disk of more than 5,000 characters, and a note of more
than 5,000 characters that is already in the store with an old vector. Run
`codescout migrate-memories --in-place --project <dir>`.

- The command exits 0 and its report says `"read": 3`, `"upserted": 1`, `"skipped": 2`.
- Its log has two warnings that embedding failed with `input is too large to process`.
- The long note that was only on disk has no vector in the store; the long note that was already in the
  store keeps its old vector.
- The short note is embedded and stored as expected.

## Expected

For the same scenario:

- The report says `"read": 3`, `"upserted": 3`, `"skipped": 0`.
- All of the text of each long note reaches the backend, in inputs the backend accepts. Nothing is cut
  off or left out of the embedding.
- Every one of the three memories ends with a vector in the store, and each of those vectors has length
  1 (within 0.001), including the vectors of the long notes. The long stored note's old vector is
  replaced.
- Memories that were embedded without trouble before are embedded as before.
- The behaviour does not depend on how far over the limit a note is.

The scenario is run against the real `codescout` binary and a stub HTTP backend, configured only
through environment variables: `CODESCOUT_VECTOR_BACKEND=sqlite-vec`, `CODESCOUT_SQLITE_DIR`,
`CODESCOUT_EMBEDDER_URL`, `CODESCOUT_EMBEDDER_MODEL` (an arbitrary model name) and
`CODESCOUT_MODEL_DIM=2`.

## Constraints

- Do not add a dependency or change `Cargo.lock`. The network is not available.
- Keep the command line (flags, subcommand names) and the fields of the JSON report as they are.
- The existing tests must keep compiling and passing.
- Keep the change focused on this behaviour.
