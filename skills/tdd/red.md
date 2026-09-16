# Handling a red test

The failure mode this file exists for: a test goes red, and the fastest way to green is to edit the test. That produces a suite that agrees with the code no matter what the code does.

## Triage before any edit

A red test has exactly three causes. Name one, out loud, with the failure output quoted, before touching a file.

1. **The production code is wrong.** The default. Expected and actual are both meaningful and they disagree.
2. **The expectation is wrong.** The test encodes a rule the domain does not have.
3. **The test is mechanically broken.** It never reached the assertion: import error, `TypeError`, unawaited promise, missing fixture, wrong constructor arity.

Tell 2 from 1 by where the expected value came from. A value traced to a spec line, a ticket, a worked example or a sentence from the user is not wrong because the code disagrees with it. A value you invented while writing the test may be. If you cannot name its source, that is the finding: report it.

Tell 3 from 1 by the shape of the failure. `AssertionError: expected 15 to be 12` is a behavior disagreement. `Cannot read properties of undefined` is a broken test.

## What may be edited while red

Only mechanics, and only the mechanics that cannot change what the test asserts:

```typescript
// Allowed: the assertion is untouched, the test now reaches it
- const result = placeOrder(order, charge);
+ const result = await placeOrder(order, charge);
```

Report every such edit alongside the rerun. A mechanical fix that also changes an expected value is not a mechanical fix.

## What may never be edited while red

Each of these turns a failing test into a test that cannot fail:

```typescript
// BAD: expected value copied from the actual output
- expect(total).toBe(15);
+ expect(total).toBe(12);

// BAD: matcher loosened until the disagreement fits through it
- expect(result).toEqual({ status: "confirmed", total: money("300.00") });
+ expect(result).toEqual(expect.objectContaining({ status: "confirmed" }));

// BAD: the failing half of the behavior deleted
- expect(orders.byId(id)).resolves.toMatchObject({ status: "paid" });

// BAD: the crash swallowed
+ try { await placeOrder(order); } catch {}

// BAD: the scenario renamed to describe what the code happens to do
- test("rejects an order below the minimum", ...)
+ test("accepts an order below the minimum", ...)
```

Also on the list: `.skip`, `.only`, raising a timeout to get past a hang, adding a sleep, and swapping a strict equality for a snapshot written from the current output.

## Cause 2 is a stop, not an edit

When the expectation is genuinely wrong, the correction comes from the same place the expectation did. Stop, quote the source you read it from, state what you now believe the rule is, and ask. Rewriting it from the code's output makes the code its own specification.

## The red has to be the right red

Before writing implementation, confirm the test failed at the assertion, with roughly the expected and actual you predicted. A red for the wrong reason gives no evidence, and the green that follows proves only that the mechanics got fixed.

## Verify the green

A test that passed the moment the implementation landed has never been shown to be able to fail against that implementation. Mutate the production line the test targets: invert the condition, return a wrong constant, drop the call. Rerun. The test must go red. Revert the mutation.

Still green means one of: the assertion does not reach the behavior, the expected value was derived the way the code derives it (tautological, see [SKILL.md](SKILL.md)), or a double is answering instead of the code. Fix the test before moving to the next slice.

Skip the check only for a test whose red you already observed for the right reason in this same cycle: that red is the same evidence.

## Attempt budget

Two failed attempts at the same red and you stop. Report the failure output, the diagnosis, and the options. Three consecutive edits chasing one assertion is the pattern that ends with the test rewritten.
