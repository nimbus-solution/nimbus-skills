---
inclusion: manual
---

# Fix a failing Apex test

You are fixing a real Apex test failure in a Salesforce project that uses Nimbus for local execution. Nimbus runs Apex (and SOQL/DML) against an embedded Postgres without an org — the inner loop is fast enough to iterate aggressively.

## Preconditions

1. The project has `sfdx-project.json` and Nimbus is installed (`nimbus --version`).
2. Nimbus's MCP server is registered with the agent. If not, register it:
   ```
   claude mcp add nimbus -- nimbus mcp
   ```
3. If MCP is unavailable, fall back to `nimbus test <pattern> --json` and parse the JSON output.

## Loop

Run this loop until the test passes or you've exhausted the strategies below.

1. **Run the suspect test(s).** Call the `run_apex_tests` MCP tool with the narrowest pattern that includes the failure (`ClassName.methodName` if you know it, otherwise `ClassName.*`). Set `max_failures: 5` so output stays readable.
2. **Read the failure.** For each failure object, note:
   - Exception type and message
   - Stack file/line — this is the line in the *test* method where the assertion or call failed, not the production line.
   - If the message mentions a SOQL/DML row count, a missing field, or a null pointer, the root cause is usually in the production code or the test setup, not the assertion.
3. **Locate the code under test.** Call `list_test_classes` to map class name → file path. Read the test method *and* every production method it calls. Do not guess based on the class name alone.
4. **Form one hypothesis.** Write it down in a single sentence: "the test fails because X." If you cannot articulate a single hypothesis, you do not understand the failure yet — re-read the code.
5. **Make the smallest edit that would prove the hypothesis right or wrong.** Edit production code, not the test, unless the test is provably wrong (asserting against impossible state, hardcoded record IDs, etc.).
6. **Re-run.** Same MCP call as step 1. If green, stop. If a different failure appears, return to step 2 with the new failure. If the same failure persists, return to step 4 with a new hypothesis — do not retry the same edit.

## Hard rules

- **Never weaken the test to make it pass.** Do not delete assertions, replace assertions with `System.assert(true)`, comment out method bodies, or wrap failing code in `try/catch` to swallow exceptions.
- **Never add `@isTest(SeeAllData=true)`** to escape a setup problem. Fix the setup.
- **Never reduce coverage** by removing test methods. If a test is genuinely obsolete, say so explicitly and ask the user before deleting it.
- **Never disable triggers, validation rules, or sharing** in the production class to make a test pass. The test is exercising real behaviour for a reason.

## Common Apex failure signatures

| Signature | Likely cause | Where to look |
|---|---|---|
| `System.NullPointerException` at `someVar.field` | Variable is null because a prior SOQL returned 0 rows or a Map lookup missed | The query/lookup just before the dereference. Check that test setup actually inserts the record. |
| `System.AssertException: Expected: X, Actual: null` | Production code didn't write the field (returned early, hit a guard clause) | Step through the production method. Look for `if (cond) return;` branches that early-exit. |
| `System.DmlException: INSUFFICIENT_ACCESS_OR_READONLY` | FLS/CRUD check or sharing rule excluded the record. Or a trigger is rejecting the DML. | Check active triggers on the SObject; check `with sharing` modifiers on the production class. |
| `System.QueryException: List has no rows` | A SOQL with `LIMIT 1` returned 0 rows. The test setup didn't create the expected record, or filter doesn't match. | Re-read `@testSetup` (or the inline setup) and the WHERE clause of the failing query. |
| `System.LimitException` (CPU, SOQL, DML) | Production code is in a loop that doesn't bulkify. The test exposed it by inserting many records. | Find the loop, refactor to bulkify (build a Set of IDs, query once outside the loop). |

## When to stop and ask the user

Stop and ask the user (don't keep iterating) when:

- The failure is caused by missing org metadata (Custom Setting record, Custom Metadata Type entry, Custom Label) that you cannot infer from code.
- The test depends on a managed-package class you don't have source for.
- The failure reveals a real product bug whose fix changes user-visible behaviour. Describe the bug, propose two options, let the user pick.
- You've made 5 iterations without progress. Summarise what you've tried and ask for guidance — do not blindly continue.

## Verification before declaring done

Before reporting the test fixed:

1. Run the broader pattern (`ClassName.*` if you started with a single method, or `*` if it's a small project) to confirm you didn't break a sibling test.
2. Re-read your edit. Did you change behaviour for callers other than the test? If yes, that's a real change — flag it in the summary.
3. If the project tracks coverage (look for a `nimbus.config` `coverage` key or `nimbus test --coverage` in CI), spot-check that coverage on the edited file did not drop.
