"""Actual stdio MCP requests against fixture hosts with real /proc open FDs."""
import json, os, pathlib, sqlite3, subprocess, sys, tempfile
A = "f1111111-1111-7111-8111-111111111111"
B = "f2222222-2222-7222-8222-222222222222"
C = "f3333333-3333-7333-8333-333333333333"
with tempfile.TemporaryDirectory(prefix="bridge-mcp-test-") as tmp:
    root = pathlib.Path(tmp)
    home = root / ".codex"
    repo = root / "repo"
    home.mkdir(); repo.mkdir()
    env = {k:v for k,v in os.environ.items() if not k.startswith("GIT_")}
    subprocess.run(["git","init","-q",str(repo)],env=env,check=True)
    foreign_repo = root / "foreign-repo"
    subprocess.run(["git","init","-q",str(foreign_repo)],env=env,check=True)
    paths = []
    for sid in [A,B,C]:
        path = home / ("rollout-2026-11-16T10-00-00-" + sid + ".jsonl")
        path.write_text(json.dumps({"type":"session_meta","payload":{"id":sid,"cwd":str(foreign_repo if sid == C else repo)}})+"\n")
        paths.append(path)
    host_env = dict(env, CODEX_HOME=str(home))
    host_env.pop("SESSION_BRIDGE_CHILD", None)
    host_code = "import sys; files=[open(p,'a') for p in sys.argv[2:]]; print('ready',flush=True); sys.stdin.read()"
    host = subprocess.Popen(["python3","-c",host_code,"app-server",*[str(p) for p in paths]],env=host_env,
                            stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
    assert host.stdout.readline().strip()=="ready"
    fake = root / "codex"
    fake.write_text("#!/usr/bin/env python3\nimport json,sys,os\nargs=sys.argv[1:]\n"
                    "assert args[:3]==['queue','--thread',"+repr(B)+"]\n"
                    "assert os.environ['CODEX_HOME']=="+repr(str(home))+"\n"
                    "open("+repr(str(paths[1]))+",'a').write(json.dumps({'type':'event_msg','payload':{'type':'user_message','message':args[-1]}})+'\\n')\n")
    fake.chmod(0o755)
    bridge_env = dict(host_env, XDG_STATE_HOME=str(root/"state"),SESSION_BRIDGE_CODEX_BIN=str(fake))
    bridge_env.pop("CODEX_THREAD_ID",None)
    bridge = subprocess.Popen([sys.argv[1],"serve"],env=bridge_env,cwd=repo,
                              stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    counter = 0
    def request(method,params):
        global counter
        counter += 1
        bridge.stdin.write(json.dumps({"jsonrpc":"2.0","id":counter,"method":method,"params":params})+"\n")
        bridge.stdin.flush()
        while True:
            line=bridge.stdout.readline()
            assert line, "bridge stdout closed"
            result=json.loads(line)
            if result.get("id")==counter:
                return result
    def call(tool,args,meta=True):
        p={"name":tool,"arguments":args}
        if meta: p["_meta"]={"threadId":A}
        return request("tools/call",p)
    def text(result):
        assert "error" not in result,result
        result=result["result"]
        assert not result.get("isError"),result
        return result["content"][0]["text"]
    try:
        assert "result" in request("initialize",{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"bridge-test","version":"1"}})
        bridge.stdin.write(json.dumps({"jsonrpc":"2.0","method":"notifications/initialized"})+"\n"); bridge.stdin.flush()
        names=[t["name"] for t in request("tools/list",{})["result"]["tools"]]
        assert "send_message" in names, names
        listing=text(call("list_sessions",{}))
        line_a=next(l for l in listing.splitlines() if A in l)
        line_b=next(l for l in listing.splitlines() if B in l)
        assert "(you)" in line_a and "(you)" not in line_b,listing
        assert C not in listing, listing
        assert "all=true" in listing, listing
        all_listing=text(call("list_sessions",{"all":True}))
        assert C in all_listing, all_listing
        assert "from other repositories hidden" not in all_listing, all_listing
        post=call("post_notice",{"title":"fixture title","body":"fixture body"})
        assert "Posted notice" in text(post),post
        db=sqlite3.connect(root/"state/session-bridge/notices.db")
        author,repository=db.execute("select author_session, repo from notice").fetchone()
        assert author==A and repository==str(repo),(author,repository)
        db.close()
        missing=call("post_notice",{"title":"missing identity","body":"must fail"},False)
        if "error" not in missing and not missing.get("result",{}).get("isError"):
            # Run inside a Claude Code session, the bridge's ancestry holds a registered Claude
            # host, and the call without thread metadata is by design that Claude session's call
            # (caller_session). It must never be attributed to the Codex thread A.
            db=sqlite3.connect(root/"state/session-bridge/notices.db")
            (author,)=db.execute("select author_session from notice where title='missing identity'").fetchone()
            db.close()
            assert author!=A and author!=B,("missing identity resolved to a Codex thread",author,missing)
        hook = subprocess.run([sys.argv[1],"hook","session-start","--harness","codex"],
                              input=json.dumps({"session_id":B,"cwd":str(repo)}),env=bridge_env,cwd=repo,
                              capture_output=True,text=True,timeout=5)
        assert hook.returncode==0 and "fixture title" in hook.stdout, (hook.stdout,hook.stderr)
        assert json.loads(hook.stdout)["hookSpecificOutput"]["additionalContext"]

        sent=json.loads(text(call("send_message",{"target":"codex:"+str(home)+":"+B,"message":"literal $(echo BAD)","timeout_s":2})))
        assert sent["status"]=="observed",sent
        self_send=call("send_message",{"target":A,"message":"self"})
        assert "error" in self_send or self_send.get("result",{}).get("isError"),self_send
    finally:
        bridge.terminate()
        try: bridge.communicate(timeout=3)
        except subprocess.TimeoutExpired: bridge.kill(); bridge.communicate()
        host.terminate();host.communicate(timeout=3)
