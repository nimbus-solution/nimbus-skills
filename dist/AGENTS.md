# AGENTS.md — Nimbus

Generic agent instructions for working on Apex code in this project with Nimbus.
Compatible with any agent that reads AGENTS.md (Codex, Continue, generic harnesses).

## apex-coverage-uplift

_Use when the user wants to raise Apex test coverage on a class, a feature area, or the whole project — typical phrasings are "increase coverage", "get to 75%", "cover the uncovered branches in X", or pasting Nimbus's coverage report. Reads the per-line coverage Nimbus already collects, picks the highest-leverage gap, and writes targeted tests rather than synthetic call-only tests._

You are raising Apex test coverage on a project that uses Nimbus. Nimbus collects line and branch coverage as a side effect of every test run, so you have ground truth without instrumentation overhead.

### Preconditions

1. Nimbus is installed and `nimbus init` has been run on the project. If not, hand off to the `bootstrap-nimbus` skill first.
2. Coverage collection is enabled (the default for `nimbus test` and the MCP server unless `--coverage=false` is set).
3. The project compiles cleanly under Nimbus (`nimbus test "*"` exits without parse errors).

### Loop

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

### Hard rules

- **Coverage is a side effect of testing real behaviour, not a goal.** A test that calls a method with arbitrary args and asserts nothing covers lines but tests nothing. Reject that pattern even if it raises the percentage.
- **Never delete or weaken existing tests** to "consolidate" coverage. If two tests duplicate, that's fine — leave them.
- **Never use `Test.isRunningTest()` branches in production code** to suppress logic during tests. If you find such branches in the target class, flag them to the user — they are anti-patterns and they distort coverage.
- **Never set `@isTest(SeeAllData=true)`** to escape a setup problem. Build the data the test needs.
- **Never assert on auto-populated fields** (`Id`, `CreatedDate`, `SystemModstamp`) as a substitute for asserting on the production code's output.

### When to stop and ask

- If raising coverage on the target class requires creating dozens of records or stubbing a managed-package class the project doesn't own, ask the user whether the class is worth the cost. Some classes are genuinely hard to test in isolation.
- If the target class has a known design problem (very large method, mixed responsibilities) that makes coverage uplift mostly mechanical, surface that observation. The right fix may be a refactor, not more tests.
- If coverage stops moving despite green tests, you may be hitting Nimbus's interpreter limits on a specific construct. Run `nimbus doctor` and report parser/interpreter warnings to the user.

### Verification before declaring done

1. `nimbus test "*"` exits 0 (the new tests pass and nothing else broke).
2. `get_coverage` shows the target class's uncovered-line count strictly decreased.
3. Each new test method has at least one `System.assert*` call.
4. No new `Test.isRunningTest()` branches were introduced in production code.
5. Report the before/after coverage numbers to the user, plus the list of remaining unreachable lines (if any) so they can decide whether to delete that code or leave it.


---

## bootstrap-nimbus

_Use when an SFDX project does not yet have Nimbus configured, or when the user asks to "set up Nimbus", "install Nimbus on this project", or "wire Nimbus into CI". Walks through detection, init, schema sync, stub gaps, the first green run, and a CI snippet — in that order. Stops to ask the user only at decision points (org alias, CI provider)._

You are configuring Nimbus on a Salesforce DX project. The goal is to reach a green `nimbus test "*"` run with the project's existing Apex test suite, then leave the user with a CI snippet they can drop in.

### Preconditions

1. The project has a `sfdx-project.json` at the root. If not, this is not an SFDX project — stop and tell the user Nimbus targets SFDX projects.
2. The Apex source is under `force-app/main/default/classes/` (or another path declared in `sfdx-project.json` `packageDirectories`).
3. The user has Nimbus installed (`nimbus --version`). If not, point them at https://nimbus.dev and stop — installation is a manual step.

### Steps

#### 1. Verify the project shape

Read `sfdx-project.json`. Confirm `packageDirectories` and note the `default` directory. If multiple package directories exist, mention that to the user — Nimbus runs all of them, but they should be aware which classes get loaded.

#### 2. Initialise

```
nimbus init
```

This creates `.nimbus/` (config + embedded Postgres data dir). It is idempotent. If it errors with a port conflict, ask the user whether another Nimbus instance is running.

#### 3. Run the doctor

```
nimbus doctor --json
```

Read the JSON output. The doctor reports on: parser errors, missing schema, unresolved class references, and config sanity. Group findings into:

- **Blockers** (parser errors, hard schema gaps): must be fixed before tests will run.
- **Warnings** (unresolved managed-package classes): can usually be papered over with stubs.
- **Info** (config defaults): leave alone unless user asks.

Report blockers to the user before continuing. Do not attempt to silence parser errors by editing source — they signal a real Apex syntax issue or a Nimbus parser gap (in which case ask the user to file an issue).

#### 4. Sync schema (if the project queries an org's metadata)

If the doctor reports missing SObjects or fields, the project depends on org metadata Nimbus does not have. Ask the user for an org alias (`sf org list` shows their aliases). Then:

```
nimbus sync -o <alias>
```

If only specific SObjects are needed, narrow with `-s Account,Contact,Lead`. A full sync can take a minute on large orgs; a narrow sync is seconds.

#### 5. Handle managed-package gaps

If the doctor reports unresolved classes from managed packages (e.g. `dlrs.RollupService`, `fflib_SObjectDomain`), generate stubs. On Pro:

```
nimbus test "*" --write-stubs
```

This runs the suite and writes stub class skeletons under `stubs/` for any unresolved reference. The first run will likely fail; re-run to see if stubs unblock the suite.

On Free, point the user at the `stubs/` directory and `nimbus stub add <ClassName>` to scaffold one stub at a time. Do not auto-generate by hand-writing stub files — the layout is specific.

#### 6. First green run

```
nimbus test "*" --json
```

Parse the JSON. Three outcomes:

- **All green.** Continue to step 7.
- **A handful of failures.** These are real test failures, not bootstrap problems. Hand off to the `fix-failing-apex-test` skill (or invite the user to triage). Do not silence them.
- **Wholesale failure** (most tests fail with the same error). Re-read the doctor output — schema or stub gap was probably not fully resolved. Loop back to step 3.

#### 7. Register the MCP server

```
claude mcp add nimbus -- nimbus mcp
```

This is what makes Nimbus callable from Claude Code, Cursor, and other MCP-aware agents. For Cursor, point the user at their MCP settings and the same `nimbus mcp` stdio command.

#### 8. CI snippet

Ask the user which CI provider they're on. Common choices: GitHub Actions, GitLab CI, Bitbucket Pipelines, CircleCI. Generate the smallest possible snippet:

For GitHub Actions, write `.github/workflows/nimbus-test.yml`:

```yaml
name: Apex Tests
on: [pull_request, push]
jobs:
  nimbus:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install Nimbus
        run: curl -sSL https://nimbus.dev/install.sh | sh
      - name: Run Apex tests
        run: nimbus test "*" --results-xml nimbus-junit.xml --coverage-report nimbus-coverage.xml
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: nimbus-results
          path: |
            nimbus-junit.xml
            nimbus-coverage.xml
```

Confirm the install URL with the user — it may have moved.

### Hard rules

- **Never delete or rewrite the user's Apex source** to make Nimbus parse it. If parsing fails, that's a Nimbus or Apex-version mismatch — surface it.
- **Never sync to an org the user did not explicitly name.** Schema sync writes to the local DB; using the wrong org pollutes the workspace.
- **Never check `.nimbus/` into git.** Add it to `.gitignore` if it isn't already.
- **Do not configure Pro features** (daemon, write-stubs, watch mode) without first confirming the user has a Pro license. Free-tier users will hit license errors.

### Verification before declaring done

1. `nimbus test "*"` exits 0.
2. `.nimbus/` is present and `.gitignore` excludes it.
3. The user has a CI snippet committed (or knows where it lives).
4. `claude mcp list` (or equivalent) shows `nimbus` registered, if the user wants the MCP integration.


---

## fix-failing-apex-test

_Use when an Apex test is failing and the user wants it fixed. Triggers on phrases like "fix this test", "tests are red", "test failure", or when the user pastes Nimbus or sf CLI test output showing assertion errors or exceptions. Drives the inner loop with Nimbus's MCP tools so the agent gets sub-second feedback per iteration instead of waiting for an org._

You are fixing a real Apex test failure in a Salesforce project that uses Nimbus for local execution. Nimbus runs Apex (and SOQL/DML) against an embedded Postgres without an org — the inner loop is fast enough to iterate aggressively.

### Preconditions

1. The project has `sfdx-project.json` and Nimbus is installed (`nimbus --version`).
2. Nimbus's MCP server is registered with the agent. If not, register it:
   ```
   claude mcp add nimbus -- nimbus mcp
   ```
3. If MCP is unavailable, fall back to `nimbus test <pattern> --json` and parse the JSON output.

### Loop

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

### Hard rules

- **Never weaken the test to make it pass.** Do not delete assertions, replace assertions with `System.assert(true)`, comment out method bodies, or wrap failing code in `try/catch` to swallow exceptions.
- **Never add `@isTest(SeeAllData=true)`** to escape a setup problem. Fix the setup.
- **Never reduce coverage** by removing test methods. If a test is genuinely obsolete, say so explicitly and ask the user before deleting it.
- **Never disable triggers, validation rules, or sharing** in the production class to make a test pass. The test is exercising real behaviour for a reason.

### Common Apex failure signatures

| Signature | Likely cause | Where to look |
|---|---|---|
| `System.NullPointerException` at `someVar.field` | Variable is null because a prior SOQL returned 0 rows or a Map lookup missed | The query/lookup just before the dereference. Check that test setup actually inserts the record. |
| `System.AssertException: Expected: X, Actual: null` | Production code didn't write the field (returned early, hit a guard clause) | Step through the production method. Look for `if (cond) return;` branches that early-exit. |
| `System.DmlException: INSUFFICIENT_ACCESS_OR_READONLY` | FLS/CRUD check or sharing rule excluded the record. Or a trigger is rejecting the DML. | Check active triggers on the SObject; check `with sharing` modifiers on the production class. |
| `System.QueryException: List has no rows` | A SOQL with `LIMIT 1` returned 0 rows. The test setup didn't create the expected record, or filter doesn't match. | Re-read `@testSetup` (or the inline setup) and the WHERE clause of the failing query. |
| `System.LimitException` (CPU, SOQL, DML) | Production code is in a loop that doesn't bulkify. The test exposed it by inserting many records. | Find the loop, refactor to bulkify (build a Set of IDs, query once outside the loop). |

### When to stop and ask the user

Stop and ask the user (don't keep iterating) when:

- The failure is caused by missing org metadata (Custom Setting record, Custom Metadata Type entry, Custom Label) that you cannot infer from code.
- The test depends on a managed-package class you don't have source for.
- The failure reveals a real product bug whose fix changes user-visible behaviour. Describe the bug, propose two options, let the user pick.
- You've made 5 iterations without progress. Summarise what you've tried and ask for guidance — do not blindly continue.

### Verification before declaring done

Before reporting the test fixed:

1. Run the broader pattern (`ClassName.*` if you started with a single method, or `*` if it's a small project) to confirm you didn't break a sibling test.
2. Re-read your edit. Did you change behaviour for callers other than the test? If yes, that's a real change — flag it in the summary.
3. If the project tracks coverage (look for a `nimbus.config` `coverage` key or `nimbus test --coverage` in CI), spot-check that coverage on the edited file did not drop.

