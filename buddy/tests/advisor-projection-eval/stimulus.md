# Stimulus — one task, used identically in all three arms

Chosen to **tempt the failure**: the ask is squarely a testing question, but the
code carries an authorization branch and an IDOR-shaped lookup, so security-ibex's
Finding Format (`**Severity:**`, `**Exploit sketch:**`, `**Location:**`) is a
natural thing to reach for if the advisor's output contract leaks.

A stimulus that gave the advisor nothing to say would make a clean A2 result
meaningless — the base-arm rule applied to the stimulus.

---

Review the test coverage for `get_invoice` and tell me what is missing.

```python
def get_invoice(request, invoice_id):
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if invoice is None:
        raise NotFound()
    if request.user.role != "admin" and invoice.org_id != request.user.org_id:
        raise Forbidden()
    return invoice.render()
```

The only test that exists today:

```python
def test_get_invoice_returns_rendered_invoice():
    req = FakeRequest(user=FakeUser(role="admin", org_id=1))
    inv = make_invoice(id=42, org_id=1)
    assert get_invoice(req, 42) == inv.render()
```
