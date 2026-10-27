# Stimulus 2 — one task, used identically in all three arms of round 2

Chosen so that **each** advisor has something it would naturally say, which round 1's
stimulus did not give the architecture advisor (`RESULTS.md`, "Where my design assumption
failed"). The ask is squarely a testing question. The code also carries (a) an f-string
SQL query and an `org_id` that is never checked against the caller, which invite
`security-ibex`, and (b) four separate responsibilities in one function (query, format,
email, audit), which invite `architecture-snow-lion`.

---

Review the test coverage for `export_orders` and tell me what is missing.

```python
def export_orders(request, org_id, fmt):
    rows = db.execute(
        f"SELECT id, total, created_at FROM orders WHERE org_id = {org_id}"
    ).fetchall()
    if fmt == "csv":
        buf = io.StringIO()
        writer = csv.writer(buf)
        for r in rows:
            writer.writerow([r.id, r.total, r.created_at])
        body = buf.getvalue()
    else:
        body = json.dumps(
            [dict(id=r.id, total=r.total, created_at=str(r.created_at)) for r in rows]
        )
    mailer.send(request.user.email, "Your export", body)
    audit_log.write("export", request.user.id, org_id)
    return body
```

The only test that exists today:

```python
def test_export_orders_csv_returns_rows():
    req = FakeRequest(user=FakeUser(id=7, email="a@x.io", org_id=1))
    seed_orders(org_id=1, n=2)
    body = export_orders(req, 1, "csv")
    assert body.count("\n") == 2
```
