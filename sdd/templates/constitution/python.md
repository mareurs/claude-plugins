# Python constitution: articles VII and VIII

Added to the base rules when the stack is `python` (two rules). Both carry `paths`, so
they apply to Python files only.

```json
[
  {"title": "Python architecture", "paths": ["**/*.py"], "rule": "Organise by feature, not by technical layer. Every function signature has type hints. Use dataclasses or Pydantic models for structured data, pass dependencies explicitly, import explicitly, and use with-statements for resources."},
  {"title": "Python testing", "paths": ["**/*.py"], "rule": "Use pytest, with tests mirroring the source layout. Prefer fixtures over setup methods, mock at the boundary, and use pytest-asyncio for async tests. Parametrize instead of copying a test."}
]
```

## Python architecture

Why: type hints and explicit dependencies catch errors early and keep behaviour predictable.
How: run mypy or pyright. Evidence: signatures in the diff.

## Python testing

Why: tests are the spec's executable form. How: `tests/` mirrors `src/`; shared fixtures
live in `conftest.py`. Evidence: the tests in the diff.
