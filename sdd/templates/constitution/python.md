
---

## Article VII: Python Architecture & Patterns

### Principle
Python projects follow clear module organization with explicit dependencies and type safety throughout.

### Mandates

1. **Package Structure**: Organize by feature/domain, not by technical layer:
   ```
   src/
   ├── feature1/
   │   ├── __init__.py
   │   ├── models.py      # Domain models, dataclasses
   │   ├── service.py     # Business logic
   │   ├── repository.py  # Data access
   │   └── api.py         # Routes/endpoints (if applicable)
   ├── shared/            # Cross-cutting utilities
   └── main.py            # Entry point
   ```

2. **Type Hints Required**: All function signatures must have type hints. Use `mypy` or `pyright` for static validation.
   ```python
   def get_user(user_id: int) -> User | None:
       ...
   ```

3. **Dataclasses for DTOs**: Use `@dataclass` or Pydantic models for data structures. Avoid plain dicts for structured data.
   ```python
   @dataclass
   class UserDTO:
       id: int
       name: str
       email: str
   ```

4. **Async with asyncio**: Use `async`/`await` for I/O-bound operations. Don't mix sync and async carelessly.

5. **Dependency Injection**: Pass dependencies explicitly via constructor or function parameters. Avoid global state and module-level singletons.

6. **Explicit Imports**: Prefer explicit imports over star imports. Import from specific modules, not packages.

7. **Context Managers for Resources**: Use `with` statements for files, connections, and other resources that need cleanup.

### Rationale

Type hints catch errors before runtime and serve as documentation. Feature-based organization scales better than layer-based. Explicit dependencies make code testable and behavior predictable.

---

## Article VIII: Python Testing Standards

### Principle
Tests validate behavior and serve as living documentation. Every module has corresponding tests.

### Mandates

1. **pytest as Framework**: Use pytest for all testing. Leverage fixtures for setup/teardown.

2. **Test Organization**: Mirror source structure in `tests/`:
   ```
   tests/
   ├── feature1/
   │   ├── test_service.py
   │   └── test_repository.py
   ├── conftest.py        # Shared fixtures
   └── pytest.ini         # Configuration
   ```

3. **Fixtures over Setup**: Use pytest fixtures instead of setUp/tearDown. Scope appropriately (function, module, session).
   ```python
   @pytest.fixture
   def db_session():
       session = create_session()
       yield session
       session.rollback()
   ```

4. **Mocking with pytest-mock**: Use `mocker` fixture for test doubles. Patch at the boundary, not deep internals.
   ```python
   def test_service_calls_repository(mocker):
       mock_repo = mocker.patch('feature1.service.repository')
       mock_repo.find.return_value = expected_data
       result = service.get_data()
       mock_repo.find.assert_called_once()
   ```

5. **Test Naming**: Follow `test_{function}_should_{expected}_when_{condition}` or simpler `test_{behavior}` pattern.

6. **Async Testing**: Use `pytest-asyncio` for async tests. Mark async tests with `@pytest.mark.asyncio`.
   ```python
   @pytest.mark.asyncio
   async def test_async_fetch():
       result = await service.fetch_data()
       assert result is not None
   ```

7. **Parametrize for Variants**: Use `@pytest.mark.parametrize` for testing multiple inputs/outputs.

### Rationale

pytest's fixture system is more flexible than xUnit-style setup. Mocking at boundaries keeps tests focused on behavior, not implementation. Parametrized tests reduce duplication while increasing coverage.

---

## Constitutional Compliance Checklist (Python)

When reviewing Python code changes, verify:

- [ ] Article VII: Type hints present on all function signatures
- [ ] Article VII: Dataclasses/Pydantic used for structured data
- [ ] Article VII: Dependencies injected explicitly
- [ ] Article VII: Context managers used for resources
- [ ] Article VIII: Tests exist in mirrored structure
- [ ] Article VIII: Fixtures used appropriately
- [ ] Article VIII: Mocking done at boundaries
- [ ] Article VIII: Async tests use pytest-asyncio
