# Python constitution: articles VII and VIII

Added to the base rules when the stack is `python` (ids C-7 and C-8). Both carry `paths`, so
they apply to Python files only.

```json
[
  {"id": "C-7", "paths": ["**/*.py"], "title": "Python architecture", "rule": "Organise by feature, not by technical layer. Every function signature has type hints. Use dataclasses or Pydantic models for structured data, pass dependencies explicitly, import explicitly, and use with-statements for resources.", "status": "active"},
  {"id": "C-8", "paths": ["**/*.py"], "title": "Python testing", "rule": "Use pytest, with tests mirroring the source layout. Prefer fixtures over setup methods, mock at the boundary, and use pytest-asyncio for async tests. Parametrize instead of copying a test.", "status": "active"}
]
```

## C-7 — Python architecture

Why: type hints and explicit dependencies catch errors early and keep behaviour predictable.
How: run mypy or pyright. Evidence: signatures in the diff.

## C-8 — Python testing

Why: tests are the spec's executable form. How: `tests/` mirrors `src/`; shared fixtures
live in `conftest.py`. Evidence: the tests in the diff.
