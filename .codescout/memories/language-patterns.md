# Language Patterns

Per-language anti-patterns and correct patterns for this project's languages.
Each section lists the top 5 mistakes LLMs make and the top 5 idiomatic patterns.

### Python

**Anti-patterns (Don't → Do):**
1. Mutable default arguments `def f(items=[])` → use `None` with `if items is None: items = []`
2. `typing.List`, `typing.Dict`, `typing.Optional` → built-in generics: `list[str]`, `str | None`
3. Bare/broad exception handling `except Exception: pass` → catch specific exceptions, log with context
4. `os.path.join()` → `pathlib.Path`: `Path(base) / "data" / "file.csv"`
5. `Any` type overuse → complete type annotations on all function signatures

**Correct patterns:**
1. Modern type hints (3.10+): `list[int]`, `dict[str, Any]`, `str | None`
2. `uv` for packages, `ruff` for linting/formatting, `pyright` for types, `pytest` for testing
3. `pyproject.toml` over `setup.py`/`requirements.txt`
4. `dataclasses` for internal data, Pydantic for validation, TypedDict for dict shapes
5. `is` comparison for singletons: `if x is None:` not `if x == None:`
