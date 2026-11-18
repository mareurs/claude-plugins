# Task: a long re-embedding run must keep a caller that asked for progress informed

## Background

An MCP client can ask the server for progress on a tool call by attaching a progress token to the
request. When it did, the server can send `notifications/progress` messages for that call while the
call is running; each one carries the token, a `progress` number and an optional `total`. When the
client attached no token, the server sends no progress notification for that call at all: it never
makes a token up, because a client that receives progress it did not ask for can crash.

`librarian(action="reindex", reembed=true)` re-scans the artifact catalog and then embeds the queued
pieces of content one after another, one embedding call per item. On a large corpus (tens of
thousands of items) that takes many minutes. Its response says how many items were embedded
(`embedded`) and how many embeddings failed (`embed_error_count`); a failed embedding does not fail
the call.

## Observed

A client calls `librarian(action="reindex", reembed=true)` over a large corpus with a progress token
attached. During the whole run it receives no progress notification. It gives up at its idle timeout
and aborts the call, while the server carries on embedding to the end: the work is paid for and its
result is thrown away.

## Expected

For a `librarian` `reindex` call that embeds content, from a client that attached a progress token:

- The client receives progress notifications while the items are being embedded, not only before the
  first item or after the last. Whenever an item has been processed and at least half a second has
  passed since the previous notification of that call, a notification follows. (A notification that
  would come less than half a second after the previous one of the same call may be dropped; the
  client does not need it.)
- Each notification carries `progress`, the number of items this run has processed so far, and
  `total`, the number of items this run sets out to embed. `progress` never decreases and never
  exceeds `total`.
- An item is processed once its embedding has been attempted, whether it succeeded or failed. A run
  in which every embedding fails still reports progress as it works through its items.
- The notifications of a call go to the token of that call, and only to it. A call that carried no
  token causes no notification, including when an earlier call on the same server did carry one.
- The response of the `reindex` call, and everything else the tool does, stays as it is today.

## Constraints

- Make the change in the crate's source. You may add tests of your own. Do not delete or weaken an
  existing assertion. An existing test may be adjusted only so that it still compiles against your
  change and checks the same behaviour.
- All existing tests must still compile and pass.
- Do not rename or remove a `pub` function, type or constant, and do not change the signature of a
  `pub` function.
- Do not add a dependency or change `Cargo.lock`. The network is not available.
- Keep the change focused on this behaviour.
