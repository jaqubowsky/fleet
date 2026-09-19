# Testing

Reached from `rules/core.md` when a test is written, changed or read.

1. Unit = behavior, not class or method
2. Black box. Arrange/Act/Assert as blank-line sections, no comment labels
3. Short test names, like user story. No Gherkin
4. No private method tests. Painful through public API = missing unit, extract it
5. Verification order: output > state > communication. Mocks only for side effects invisible in state and output
6. Shared or volatile dependency -> double. Private, in-process, deterministic -> real object
7. Test the behavior at the lowest seam that can still fail on it. None -> test higher, up to e2e, and name the doubles it forced: that list is the coupling to remove before the next test goes lower
8. Bug report -> regression test first. Show the red, then the fix
9. Red = production code wrong until proven otherwise. Quote failure, name cause before editing
10. Red from import error or TypeError says nothing about behavior. Fix mechanics, get real red
11. While red never weaken test: no value copied from actual, no loosened matcher, no skip/only, no raised timeout, no renamed scenario
12. Wrong expectation -> stop, quote spec or ask user. Never re-derive from what code returns
13. Green right after red -> mutation check. Break the line, confirm red, revert
