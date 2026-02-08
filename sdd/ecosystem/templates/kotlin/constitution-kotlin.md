
---

## Article VII: Kotlin Architecture & Patterns

### Principle
Kotlin projects follow clean architecture principles with clear layer separation and dependency direction.

### Mandates

1. **Layer Direction**: Dependencies flow inward. Outer layers depend on inner layers, never the reverse.

2. **Package Structure**: Organize by feature, then by layer:
   ```
   src/main/kotlin/com/project/
   ├── feature1/
   │   ├── api/        # Controllers, DTOs
   │   ├── service/    # Business logic
   │   ├── repository/ # Data access
   │   └── domain/     # Entities, value objects
   └── shared/         # Cross-cutting concerns
   ```

3. **Interface Boundaries**: Services depend on repository interfaces, not implementations. Enables testing and flexibility.

4. **Coroutines for Async**: Use `suspend` functions and `Flow` for asynchronous operations. No blocking I/O on main dispatchers.

5. **Sealed Classes for State**: Use sealed classes/interfaces for closed type hierarchies (results, events, states).

6. **Data Classes for DTOs**: Use data classes for value objects and DTOs. Leverage `copy()` for immutable updates.

7. **Null Safety**: Avoid `!!`. Use `?.let`, `?:`, or validate non-null at boundaries.

### Rationale

Clean architecture with Kotlin idioms produces testable, maintainable code. Coroutines provide efficient async without callback hell. Sealed classes enable exhaustive when-expressions for state handling.

---

## Article VIII: Kotlin Testing Standards

### Principle
Tests are first-class citizens. Every feature has corresponding tests at appropriate levels of the testing pyramid.

### Mandates

1. **Testing Pyramid**: Unit tests (MockK) at base, integration tests (Testcontainers) in middle, E2E tests at top.

2. **MockK for Mocking**: Use MockK for test doubles. Prefer `coEvery`/`coVerify` for suspend functions.
   ```kotlin
   coEvery { repository.findById(any()) } returns entity
   coVerify { repository.save(match { it.name == "test" }) }
   ```

3. **Test Naming**: Follow `should {expected} when {condition}` pattern for clarity.
   ```kotlin
   @Test
   fun `should return user when valid id provided`() { ... }
   ```

4. **No Test Shortcuts**: Tests that use `@Disabled` or skip assertions are tech debt. Fix the code, not the test.

5. **Coroutine Testing**: Use `runTest` for testing suspend functions. Never use `runBlocking` in tests.
   ```kotlin
   @Test
   fun `should fetch data asynchronously`() = runTest {
       val result = service.fetchData()
       assertThat(result).isNotEmpty()
   }
   ```

6. **Test Fixtures**: Use factory functions or builders for test data. Avoid duplicated setup across tests.

### Rationale

A proper testing pyramid catches bugs early (unit tests) while validating integration (integration tests). MockK's coroutine support makes async testing natural. Consistent naming makes test failures immediately understandable.

---

## Constitutional Compliance Checklist (Kotlin)

When reviewing Kotlin code changes, verify:

- [ ] Article VII: Layer boundaries respected, dependencies flow inward
- [ ] Article VII: Coroutines used for async, no blocking calls
- [ ] Article VII: Sealed classes for closed hierarchies
- [ ] Article VII: Data classes for DTOs, null safety maintained
- [ ] Article VIII: Tests exist at appropriate pyramid level
- [ ] Article VIII: MockK used correctly for suspend functions
- [ ] Article VIII: Test names follow convention
