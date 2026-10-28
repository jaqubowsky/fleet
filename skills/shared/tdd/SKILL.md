---
name: tdd
description: 'Writing, changing or reading a test, or reproducing a bug. Use before the first test of a feature, ticket or fix, on a bug report, when a red test has to be diagnosed, and when green arrives on the first run.'
---

# Test-Driven Development

TDD is the red → green loop. This skill is the reference that makes that loop produce tests worth keeping: what a good test is, where tests go, the anti-patterns, and the rules of the loop.

## What a good test is

- Unit = behavior, not class or method
- Black box. Arrange/Act/Assert as blank-line sections, no comment labels
- Short test names, like user story. No Gherkin
- Test the behavior at the lowest seam that can still fail on it. None -> test higher, up to e2e, and name the doubles it forced: that list is the coupling to remove before the next test goes lower

A test verifies behavior through a public interface, so it survives a refactor that keeps the behavior. Its name reads like a specification: "user can checkout with valid cart" says what capability exists. [mocking.md](mocking.md) decides what gets a double.

## Seams: where tests go

A **seam** is the public boundary you test at: the interface where you observe behavior without reaching inside. Tests live at seams, never against internals.

**Test at an existing public seam by default**: the one an accepted analysis or ticket names, else the interface the code's callers already use. Write the seams under test down before the first test. Ask the user only when choosing a seam changes scope or a contract: a new public interface, a moved module boundary, or test effort the ticket did not plan.

## Anti-patterns

- **Implementation-coupled**: mocks internal collaborators, tests private methods, or verifies through a side channel (querying the database instead of using the interface). The tell: the test breaks when you refactor but behavior hasn't changed.
- **Tautological**, the assertion recomputes the expected value the way the code does (`expect(add(a, b)).toBe(a + b)`, a snapshot derived by hand the same way, a constant asserted equal to itself), so it passes by construction and can never disagree with the code. Expected values must come from an independent source of truth, a known-good literal, a worked example, the spec.
- **Horizontal slicing**, writing all tests first, then all implementation. Bulk tests verify _imagined_ behavior: you test the _shape_ of things rather than user-facing behavior, the tests go insensitive to real changes, and you commit to test structure before understanding the implementation. Work in **vertical slices** instead, one test → one implementation → repeat, each test a **tracer bullet** that responds to what the last cycle taught you.

## Rules of the loop

- **Bug report -> regression test first.** Show the red, then the fix.
- **Red before green.** Write the failing test first, then only enough code to pass it. Don't anticipate future tests or add speculative features.
- **Every red leaves a log.** Save the right red's output to `logs/tdd-<ticket>/<test-name>.log` where your seat's rules keep outputs, or name it in your reply when they keep none. It is the review's only evidence that the test can fail.
- **A red test accuses the code, not itself.** [red.md](red.md) is the procedure for every failure in the loop.
- **One slice at a time.** One seam, one test, one minimal implementation per cycle.
- **Refactoring is not part of the loop.** It belongs after green, before the gate, not inside the red → green implementation cycle.
