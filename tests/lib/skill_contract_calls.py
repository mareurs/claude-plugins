"""Discover concrete MCP examples and validate them against an isolated server."""

def extract_calls(text):
    """Return (tool, literal kwargs, original source, line) for action-bearing examples.

    Quoted strings are copied byte-for-byte. Only unquoted JSON booleans,
    dictionary keys and illustrative placeholders are translated to Python.
    Malformed examples fail rather than disappearing from the population.
    """
    import ast
    import re

    pattern = re.compile(r'\b(doc|librarian|index|memory|workspace)\s*\(')
    result, cursor = [], 0
    while match := pattern.search(text, cursor):
        start = match.start()
        opening = text.index("(", start)
        i, depth, quote = opening, 0, None
        while i < len(text):
            char = text[i]
            if quote:
                if char == "\\":
                    i += 1
                elif char == quote:
                    quote = None
            elif char in "\"'":
                quote = char
            elif char == "(":
                depth += 1
            elif char == ")":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        if depth:
            raise ValueError(f"unbalanced {match.group(1)} call at line {text.count(chr(10), 0, start) + 1}")
        raw = text[start:i + 1]
        if not re.search(r"\baction\s*=", raw):
            cursor = i + 1
            continue
        parts, j = [], 0
        while j < len(raw):
            char = raw[j]
            if char in "\"'":
                end, quote = j + 1, char
                while end < len(raw):
                    if raw[end] == "\\":
                        end += 2
                        continue
                    if raw[end] == quote:
                        end += 1
                        break
                    end += 1
                parts.append(raw[j:end])
                j = end
            elif char == "<":
                end = raw.find(">", j)
                if end == -1:
                    raise ValueError("unclosed placeholder")
                parts.append(repr(raw[j:end + 1]))
                j = end + 1
            elif char == "…":
                parts.append("...")
                j += 1
            elif char.isalpha() or char == "_":
                word = re.match(r"\w+", raw[j:]).group()
                after = j + len(word)
                tail = raw[after:].lstrip()
                parts.append(repr(word) if tail.startswith(":") else
                             {"true": "True", "false": "False", "null": "None"}.get(word, word))
                j = after
            else:
                parts.append(char)
                j += 1
        try:
            normalized = re.sub(r",\s*\.\.\.\s*\)$", ")", "".join(parts))
            node = ast.parse(normalized, mode="eval").body
            if not isinstance(node, ast.Call) or node.args or any(kw.arg is None for kw in node.keywords):
                raise ValueError("expected keyword arguments only")
            kwargs = {}
            for kw in node.keywords:
                if kw.arg in kwargs:
                    raise ValueError(f"duplicate keyword {kw.arg}")
                kwargs[kw.arg] = ast.literal_eval(kw.value)
        except (SyntaxError, ValueError) as exc:
            raise ValueError(f"invalid {match.group(1)} example at line {text.count(chr(10), 0, start) + 1}: {exc}") from exc
        result.append((match.group(1), kwargs, raw, text.count("\n", 0, start) + 1))
        cursor = i + 1
    return result
def validate_signature(call, schema):
    """Check supplied names and action even on incomplete illustrative calls."""
    properties = schema["properties"]
    unknown = set(call) - set(properties)
    if unknown:
        raise ValueError(f"unknown argument(s): {', '.join(sorted(unknown))}")
    actions = properties.get("action", {}).get("enum")
    if actions is not None and call.get("action") not in actions:
        raise ValueError(f"unknown action: {call.get('action')!r}")
def run_catalog_examples(cs, skills, ok, bad, info, covered):
    """Check every action-bearing example; execute complete auxiliary calls.

    Existing ledger/verdict tests own their richer fixtures. Ellipsis-only
    fragments get signature checks, never a fictitious successful execution.
    """
    schemas = {tool["name"]: tool["inputSchema"]
               for tool in cs._rpc("tools/list", {})["result"]["tools"]}
    made = []
    def create(slug, kind="tracker"):
        reply = cs.call("doc", action="create", kind=kind, title=f"Contract {slug}",
                        status="active", tags=["sdd"], rel_path=f"docs/contracts/{slug}.md",
                        body="# Contract fixture\n\n| ID | Date | … |\n")
        if not reply.ok:
            raise ValueError(reply.error or reply.text[:200])
        made.append(reply.payload["id"])
        return reply.payload["id"]

    checked = executed = fragments = delegated = roadmap = 0
    try:
        target = create("target")
        spec = create("spec", "spec")
        for path in sorted(skills.rglob("*.md")):
            rel = str(path.relative_to(skills))
            try:
                calls = extract_calls(path.read_text())
            except ValueError as exc:
                bad(f"{rel}: examples parse", str(exc))
                continue
            for tool, call, raw, line in calls:
                label = f"{rel}:{line}: {tool} {call['action']}"
                # This exact occurrence explicitly names a FUTURE Rust detector,
                # rather than instructing an agent to call a shipped action.
                if (rel == "tracker-hygiene/SKILL.md" and
                        raw == 'librarian(action="audit_trackers")' and
                        "graduates to a Rust" in path.read_text().split(raw)[0][-100:]):
                    roadmap += 1
                    info(f"{label}: future detector, not a prescribed call")
                    continue
                try:
                    validate_signature(call, schemas[tool])
                except (ValueError, KeyError) as exc:
                    bad(f"{label}: signature matches the live tool", str(exc))
                    continue
                checked += 1
                action = call["action"]
                if tool == "doc" and (path, call) in covered:
                    delegated += 1
                    continue
                if (tool == "doc" and ((action == "augment" and set(call) == {"action"}) or
                        call.get("patch", {}).get("body_edits") == [Ellipsis])) or (
                        tool == "workspace" and "path" not in call):
                    fragments += 1
                    info(f"{label}: incomplete illustration; signature checked, not executed")
                    continue
                if tool == "doc" and (action == "append_entry" or
                        (action == "update" and "body_edits" in call.get("patch", {}))):
                    bad(f"{label}: runtime fixture exists", "new ledger example needs a runtime fixture")
                    continue
                real = dict(call)
                if "id" in real and (real["id"] is Ellipsis or str(real["id"]).startswith("<")):
                    real["id"] = spec if action in ("get", "event_create", "event_list") else target
                if tool == "memory" and "workspace" in real:
                    if real["workspace"] != "<path>":
                        bad(f"{label}: workspace fixture is known", repr(real["workspace"]))
                        continue
                    real["workspace"] = str(cs.repo)
                if tool == "workspace":
                    if real["path"] != "<target>":
                        bad(f"{label}: activation fixture is known", repr(real["path"]))
                        continue
                    real["path"] = str(cs.repo)
                if tool == "doc" and action == "find" and real.get("rel_path") == "<path or fragment>":
                    real["rel_path"] = "docs/contracts/spec.md"
                if tool == "doc" and action == "link":
                    successor, old_id = create(f"successor-{executed}"), create(f"old-{executed}")
                    roles = {"<successor>": successor, "<old>": old_id}
                    for field in ("src_id", "dst_id"):
                        real[field] = roles.get(real[field], real[field])
                reply = cs.call(tool, **real)
                if not reply.ok:
                    bad(f"{label}: prescribed call is accepted", reply.error or reply.text[:300])
                    continue
                executed += 1
                if tool == "doc" and action == "find":
                    expected = spec if real.get("kind") == "spec" else target
                    if expected not in reply.text:
                        bad(f"{label}: fixture is found", reply.text[:300])
                        continue
                if tool == "doc" and action == "link":
                    old = cs.call("doc", action="get", id=old_id).payload
                    new = cs.call("doc", action="get", id=successor).payload
                    if old.get("status") != "superseded" or new.get("status") != "active":
                        bad(f"{label}: successor supersedes the old document", str((new.get("status"), old.get("status"))))
                        continue
                if tool == "doc" and action == "event_create":
                    got = cs.call("doc", action="event_list", id=spec, kinds=[real["event"]["kind"]])
                    if not got.ok or real["event"]["payload"]["outcome"] not in got.text:
                        bad(f"{label}: event reads back", got.text[:300])
                        continue
                if tool == "doc" and action == "event_list" and not reply.payload.get("items"):
                    bad(f"{label}: recorded verdict is listed", reply.text[:300])
                    continue
                if tool == "doc" and action == "update":
                    got = cs.call("doc", action="get", id=target).payload
                    if got.get("extra", {}).get("snapshot_anchor") != call["patch"]["extra"]["snapshot_anchor"]:
                        bad(f"{label}: snapshot anchor is persisted", str(got.get("extra")))
                        continue
                if tool == "memory" and action == "write":
                    got = cs.call("memory", action="read", topic=real["topic"])
                    if not got.ok or real["content"] not in got.text:
                        bad(f"{label}: written memory reads back", got.text[:300])
                        continue
                if tool == "workspace" and reply.payload.get("read_only") is not real["read_only"]:
                    bad(f"{label}: requested activation mode is respected", reply.text[:300])
                    continue
                ok(f"{label}: signature and runtime accepted")
        if not checked:
            bad("skill contract population is nonempty", "no action-bearing examples found")
        info(f"skill contract inventory: {checked} live signatures checked; {executed} auxiliary calls executed; "
             f"{delegated} calls delegated to ledger/verdict runtime cases; {fragments} incomplete illustrations; "
             f"{roadmap} explicit roadmap mention")
    finally:
        for doc_id in reversed(made):
            reply = cs.call("doc", action="delete", id=doc_id, force=True)
            if not reply.ok:
                bad("contract fixture deleted", reply.error or reply.text[:200])
