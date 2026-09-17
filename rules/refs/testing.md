---
paths:
  - "**/*.test.{ts,tsx,js,jsx}"
  - "**/*.spec.{ts,tsx,js,jsx}"
  - "**/tests/**/*"
  - "**/__tests__/**/*"
---

# Testing

Reached from `rules/core.md` when a test is written, changed or read.

1. Unit = behavior, not class or method
2. Black box. Arrange/Act/Assert as blank-line sections, no comment labels
3. Short test names, like user story. No Gherkin
4. No private method tests. Painful through public API = missing unit, extract it
5. Verification order: output > state > communication. Mocks only for side effects invisible in state and output
6. Shared or volatile dependency -> double. Private, in-process, deterministic -> real object
7. Bug report -> regression test first. Show the red; production code after the go-ahead, or at once under rule 16
8. Red = production code wrong until proven otherwise. Quote failure, name cause before editing
9. Red from import error or TypeError says nothing about behavior. Fix mechanics, get real red
10. While red never weaken test: no value copied from actual, no loosened matcher, no skip/only, no raised timeout, no renamed scenario
11. Wrong expectation -> stop, quote spec or ask user. Never re-derive from what code returns
12. Green right after red -> mutation check. Break the line, confirm red, revert
13. Cases: zero/one/many, boundaries, domain, illegal values. Stop when fear turns to boredom
14. Test code = production readability. Realistic domain data
15. Test pyramid
16. "finish/deliver/complete end to end" = standing auth: genuine behavioral RED -> production GREEN, no second ask. Preserve + report RED. RED from imports/mechanics/unsupported expectation != auth. Never weaken failing assertion for green. Expectation vs accepted spec conflict -> stop, ask
