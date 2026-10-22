# Handling a red test

The failure mode this file exists for: a test goes red, and the fastest way to green is to edit the test. That produces a suite that agrees with the code no matter what the code does.

## Triage before any edit

A red test has exactly three causes. Name one, with the failure output quoted, before touching a file: the production code is wrong, the default; the expectation is wrong, a rule the domain does not have; the test is mechanically broken and never reached the behavior.

- Expectation or code: where did the expected value come from? A value traced to a spec line, a ticket, a worked example or a sentence from the user is not wrong because the code disagrees with it. A value you invented while writing the test may be. If you cannot name its source, that is the finding: report it.
- Broken test or code: where was the failure raised, read from the stack trace, not from the exception's name. `Cannot read properties of undefined` raised in the test's setup is a broken test; raised inside production code on the path under test, it is the bug the test found.

A mechanical fix leaves every assertion as it was, such as `placeOrder(order)` becoming `await placeOrder(order)`, and is reported beside the rerun.

## Never while red

Each of these turns a failing test into one that cannot fail: an expected value copied from the actual output, a loosened matcher, the failing half of the behavior deleted, a crash swallowed in a `try`, the scenario renamed to describe what the code happens to do, `.skip`, `.only`, a raised timeout, an added sleep, a strict equality swapped for a snapshot written from the current output.

A wrong expectation is a stop, not an edit: quote the source you read it from, state what you now believe the rule is, and ask.

## The red has to be the right red

Before writing implementation, confirm the test failed at the assertion, or inside production code on the path under test, with roughly the expected and actual you predicted. A red for the wrong reason gives no evidence, and the green that follows proves only that the mechanics got fixed.

## Attempt budget

Two failed attempts at the same red and you stop. Report the failure output, the diagnosis, and the options. Three consecutive edits chasing one assertion is the pattern that ends with the test rewritten.
