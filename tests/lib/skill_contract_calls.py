"""Discover concrete MCP examples and validate them against an isolated server."""

import json
import subprocess
import tempfile


def extract_calls(text, bindings=None):
    """Return (tool, literal kwargs, original source, line) for action-bearing examples.

    Quoted strings are copied byte-for-byte. Only unquoted JSON booleans,
    dictionary keys and illustrative placeholders are translated to Python.
    Malformed examples fail rather than disappearing from the population.
    """
    import ast
    import re

    class BindInputs(ast.NodeTransformer):
        def visit_Name(self, node):
            if node.id in (bindings or {}):
                return ast.parse(repr(bindings[node.id]), mode="eval").body
            return node

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
                kwargs[kw.arg] = ast.literal_eval(BindInputs().visit(kw.value))
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
def callable_doc_schema(binary, env, run=subprocess.run):
    """The `doc` schema the server accepts, from `codescout call doc --schema`.

    `tools/list` advertises fewer `doc` actions than the server runs: a hidden action is
    callable but absent from the advertised enum. A skill example is legal when the server
    accepts it, so `doc` is judged against this schema. Returns None for a binary that has no
    such door (non-zero exit, no JSON object, or an object without `properties`); the caller
    must then say so, because a silent fallback hides a mismatch.
    """
    with tempfile.TemporaryDirectory() as empty:
        try:
            done = run([binary, "call", "doc", "--schema"], cwd=empty, env=env,
                       capture_output=True, text=True, timeout=30)
        except (OSError, subprocess.SubprocessError):
            return None
    if done.returncode != 0:
        return None
    try:
        schema = json.loads(done.stdout)
    except json.JSONDecodeError:
        return None
    if not isinstance(schema, dict) or not isinstance(schema.get("properties"), dict):
        return None
    return schema


def action_is_hidden(action, advertised, callable_):
    """True when `action` is in the callable `action` enum but not in the advertised one."""
    def enum(schema):
        return schema.get("properties", {}).get("action", {}).get("enum") or []
    return action in enum(callable_) and action not in enum(advertised)



def run_catalog_examples(cs, skills, ok, bad, info, covered):
    """Check every action-bearing example; execute complete auxiliary calls.

    Existing ledger/verdict tests own their richer fixtures. Ellipsis-only
    fragments get signature checks, never a fictitious successful execution.
    """
    schemas = {tool["name"]: tool["inputSchema"]
               for tool in cs._rpc("tools/list", {})["result"]["tools"]}
    # `doc` is judged by what the server accepts: nine of its actions are callable but no
    # longer advertised. Every other tool keeps the advertised schema.
    advertised_doc = schemas.get("doc")
    callable_doc = callable_doc_schema(cs.binary, cs.env)
    if callable_doc is None:
        info("door schema unavailable: doc validated against tools/list")
    else:
        schemas["doc"] = callable_doc
    hidden = 0
    made = []
    def create(slug, kind="tracker"):
        reply = cs.call("doc", action="create", kind=kind, title=f"Contract {slug}",
                        status="active", tags=["sdd"], rel_path=f"docs/contracts/{slug}.md",
                        body="# Contract fixture\n\n| ID | Date | … |\n")
        if not reply.ok:
            raise ValueError(reply.error or reply.text[:200])
        ref = reply.document_ref
        made.append(ref)
        return ref

    checked = executed = fragments = delegated = roadmap = 0
    try:
        target = create("target")
        spec = create("spec", "spec")
        for path in sorted(skills.rglob("*.md")):
            rel = str(path.relative_to(skills))
            try:
                bindings = None
                if rel in ("reconnaissance/references/patterns-tracker.md",
                           "reconnaissance/references/reconnaissance-patterns-template.md"):
                    template = (skills / "reconnaissance/references/reconnaissance-patterns-template.md").read_text()
                    bindings = {"prefix": "RCB" if rel.endswith("/patterns-tracker.md") else "RCA",
                                "template_body": template.split('```yaml\n', 1)[1].split('```', 1)[1].lstrip(),
                                "tracker_id": "<tracker>", "entry_title": "Contract entry",
                                "entry_body": "**Observed:** contract fixture."}
                calls = extract_calls(path.read_text(), bindings=bindings)
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
                if tool == "doc" and callable_doc is not None and advertised_doc is not None and \
                        action_is_hidden(action, advertised_doc, callable_doc):
                    hidden += 1
                if tool == "doc" and (path, call) in covered:
                    delegated += 1
                    continue
                if (tool == "doc" and ((action == "augment" and set(call) == {"action"}) or
                        call.get("patch", {}).get("body_edits") == [Ellipsis])) or (
                        tool == "workspace" and "path" not in call):
                    fragments += 1
                    info(f"{label}: incomplete illustration; signature checked, not executed")
                    continue
                if (tool == "doc" and action == "append_entry" and
                        rel == "reconnaissance/references/reconnaissance-patterns-template.md"):
                    fixture = cs.call("doc", action="create", kind="tracker", status="active",
                                      title="Recon append fixture", rel_path="docs/contracts/recon-append.md",
                                      extra={"entry_prefix": bindings["prefix"],
                                             "snapshot_anchor": "| ID | Date | Verdict | Pattern | Evidence (recon entry) |"},
                                      body=bindings["template_body"])
                    if not fixture.ok:
                        raise ValueError(fixture.error or fixture.text[:200])
                    fixture_ref = fixture.document_ref
                    made.append(fixture_ref)
                    reply = cs.call(tool, **dict(call, id=fixture_ref))
                    if not reply.ok:
                        bad(f"{label}: prescribed append accepted", reply.error or reply.text[:300])
                        continue
                    got = cs.call("doc", action="get", id=fixture_ref, full=True).payload["body"]
                    eid = reply.payload["id"]
                    if f"## {eid} — {call['title']}" not in got or f"| {eid} |" not in got:
                        bad(f"{label}: append writes both section and index", got[:300])
                        continue
                    executed += 1
                    ok(f"{label}: signature and runtime accepted; section and index persisted")
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
                if (tool == "librarian" and action == "link_scan" and real.get("write") is True and
                        reply.error.startswith("link_scan write=true is refused on this checkout:")):
                    context = " ".join(part.strip() for part in path.read_text().splitlines()[line - 1:line + 7])
                    if "derived-index checkout" in context and "refused" in context:
                        del real["write"]
                        report = cs.call(tool, **real)
                        if report.ok:
                            executed += 1
                            ok(f"{label}: derived index refuses edge writes and accepts the report")
                        else:
                            bad(f"{label}: derived index accepts the report", report.error or report.text[:300])
                        continue
                if not reply.ok:
                    bad(f"{label}: prescribed call is accepted", reply.error or reply.text[:300])
                    continue
                executed += 1
                if tool == "doc" and action == "create":
                    ref = reply.document_ref
                    made.append(ref)
                    got = cs.call("doc", action="get", id=ref, full=True).payload
                    if got.get("extra", {}).get("entry_prefix") != call["extra"]["entry_prefix"]:
                        bad(f"{label}: declared prefix persisted", str(got.get("extra")))
                        continue
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
        info(f"hidden-action examples: {hidden} examples name a doc action that is callable but not advertised")
    finally:
        for doc_id in reversed(made):
            reply = cs.call("doc", action="delete", id=doc_id, force=True)
            if not reply.ok:
                bad("contract fixture deleted", reply.error or reply.text[:200])
