---
name: apex-coverage-uplift
description: Use when the user wants to raise Apex test coverage on a class, a feature area, or the whole project — typical phrasings are "increase coverage", "get to 75%", "cover the uncovered branches in X", or pasting Nimbus's coverage report. Reads the per-line coverage Nimbus already collects, picks the highest-leverage gap, and writes targeted tests rather than synthetic call-only tests.
---

# Increase Apex test coverage

You are raising Apex test coverage on a project that uses Nimbus. Nimbus collects line and branch coverage as a side effect of every test run, so you have ground truth without instrumentation overhead.

## Preconditions

1. Nimbus is installed and `nimbus init` has been run on the project. If not, hand off to the `bootstrap-nimbus` skill first.
2. Coverage collection is enabled (the default for `nimbus test` and the MCP server unless `--coverage=false` is set).
3. The project compiles cleanly under Nimbus (`nimbus test "*"` exits without parse errors).

## Loop

1. **Establish the baseline.** Call the `run_apex_tests` MCP tool with `pattern: "*"` (or a narrower scope if the user named one). Then call `get_coverage` to retrieve per-class coverage. Record the overall percentage and the per-class breakdown.
2. **Pick the target.** Sort classes by uncovered-line count (not by percentage — a 60%-covered 1000-line class has more uncovered lines than a 0%-covered 50-line class). Unless the user pinned a class, work on the largest absolute gap first. Skip:
   - Classes whose name ends in `Test` or `_Test` — those are tests, not production code.
   - Classes annotated `@isTest` at the class level.
   - Generated/managed classes the user does not own (check `.forceignore` or `stubs/`).
3. **Read the source and the existing tests.** Open the target class. Open every existing test class that names it (grep `force-app/main/default/classes` for the class name). Note which methods already have direct test coverage and which uncovered lines correspond to which method.
4. **Categorise the uncovered lines.** Most uncovered lines fall into a small set of patterns:

   | Pattern | Strategy |
   |---|---|
   | Early-return guard (`if (input == null) return;`) | One test passing the null/empty case. |
   | Catch block | One test that triggers the exception (a malformed input, a DML violation). Use `Test.startTest()`/`Test.stopTest()` so any async work flushes. |
   | Else branch on a boolean check | One test exercising the opposite branch. |
   | Switch/when default | One test passing a value that hits the default. |
   | Overloaded method | One test per overload. |
   | Trigger context branch (`Trigger.isUpdate`, `Trigger.isDelete`) | One DML operation per branch. |
   | Permissions/sharing path (`Schema.sObjectType...isAccessible()`) | Run the test as a user without that permission via `System.runAs`. |

5. **Draft tests.** Add a new test method per uncovered scenario (or extend an existing test class — match the project's convention). Tests must:
   - Use `@isTest` and a meaningful name (`testCancel_WhenAlreadyCancelled_NoOp`, not `testMethod1`).
   - Set up only the records the assertion actually needs.
   - Make at least one `System.assert*` call that would fail if the production code regressed. Lines covered without assertions are theatre, not coverage.
6. **Re-run and re-measure.** Call `run_apex_tests` with `ClassName.*` for the target class. Then `get_coverage` to confirm the targeted lines flipped from uncovered to covered. If a line you expected to cover is still uncovered, your test isn't actually exercising that path — re-read step 4.
7. **Repeat.** Move to the next-largest gap. Stop when the user's threshold is hit or when the remaining uncovered lines are all unreachable (defensive `else { throw; }` blocks, manufacturer-specific switch arms with no real input). Report unreachable lines explicitly rather than padding tests to hit them.

## Hard rules

- **Coverage is a side effect of testing real behaviour, not a goal.** A test that calls a method with arbitrary args and asserts nothing covers lines but tests nothing. Reject that pattern even if it raises the percentage.
- **Never delete or weaken existing tests** to "consolidate" coverage. If two tests duplicate, that's fine — leave them.
- **Never use `Test.isRunningTest()` branches in production code** to suppress logic during tests. If you find such branches in the target class, flag them to the user — they are anti-patterns and they distort coverage.
- **Never set `@isTest(SeeAllData=true)`** to escape a setup problem. Build the data the test needs.
- **Never assert on auto-populated fields** (`Id`, `CreatedDate`, `SystemModstamp`) as a substitute for asserting on the production code's output.

## When to stop and ask

- If raising coverage on the target class requires creating dozens of records or stubbing a managed-package class the project doesn't own, ask the user whether the class is worth the cost. Some classes are genuinely hard to test in isolation.
- If the target class has a known design problem (very large method, mixed responsibilities) that makes coverage uplift mostly mechanical, surface that observation. The right fix may be a refactor, not more tests.
- If coverage stops moving despite green tests, you may be hitting Nimbus's interpreter limits on a specific construct. Run `nimbus doctor` and report parser/interpreter warnings to the user.

## Verification before declaring done

1. `nimbus test "*"` exits 0 (the new tests pass and nothing else broke).
2. `get_coverage` shows the target class's uncovered-line count strictly decreased.
3. Each new test method has at least one `System.assert*` call.
4. No new `Test.isRunningTest()` branches were introduced in production code.
5. Report the before/after coverage numbers to the user, plus the list of remaining unreachable lines (if any) so they can decide whether to delete that code or leave it.
