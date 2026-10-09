---
name: tdd
description: 'Writing or changing a test, or fixing a bug that needs one. Use before the first test of a feature, ticket or fix, when a red test has to be diagnosed, and when green arrives on the first run.'
---

# Test-Driven Development

TDD is the red → green loop. This skill is the reference that makes that loop produce tests worth keeping: what a good test is, where tests go, the anti-patterns, and the rules of the loop.

## What a good test is

Tests verify behavior through public interfaces, not implementation details. Code can change entirely; tests shouldn't. A good test reads like a specification: "user can checkout with valid cart" tells you exactly what capability exists, and it survives refactors because it doesn't care about internal structure.

See [tests.md](tests.md) for examples and [mocking.md](mocking.md) for mocking guidelines.

## Seams: where tests go

A **seam** is the public boundary you test at: the interface where you observe behavior without reaching inside. Tests live at seams, never against internals.

**Test at an existing public seam by default**: the one an accepted analysis or ticket names, else the interface the code's callers already use. Write the seams under test down before the first test. Ask the user only when choosing a seam changes scope or a contract: a new public interface, a moved module boundary, or test effort the ticket did not plan.

## Anti-patterns

- **Implementation-coupled**: mocks internal collaborators, tests private methods, or verifies through a side channel (querying the database instead of using the interface). The tell: the test breaks when you refactor but behavior hasn't changed.
- **Tautological**, the assertion recomputes the expected value the way the code does (`expect(add(a, b)).toBe(a + b)`, a snapshot derived by hand the same way, a constant asserted equal to itself), so it passes by construction and can never disagree with the code. Expected values must come from an independent source of truth, a known-good literal, a worked example, the spec.
- **Horizontal slicing**, writing all tests first, then all implementation. Bulk tests verify _imagined_ behavior: you test the _shape_ of things rather than user-facing behavior, the tests go insensitive to real changes, and you commit to test structure before understanding the implementation. Work in **vertical slices** instead, one test → one implementation → repeat, each test a **tracer bullet** that responds to what the last cycle taught you.

## Rules of the loop

- **Red before green.** Write the failing test first, then only enough code to pass it. Don't anticipate future tests or add speculative features.
- **Every red leaves a log.** Save the right red's output to `logs/tdd-<ticket>/<test-name>.log` where your seat's rules keep outputs. It is the review's only evidence that the test can fail.
- **A red test accuses the code, not itself.** [red.md](red.md) is the procedure for every failure in the loop.
- **One slice at a time.** One seam, one test, one minimal implementation per cycle.
- **Refactoring is not part of the loop.** It belongs after green, before the gate, not inside the red → green implementation cycle.
