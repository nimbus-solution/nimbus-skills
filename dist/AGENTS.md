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

## apex-pre-deploy-check

_Use before shipping an Apex change — "is this safe to deploy", "pre-deploy check", "review this PR/diff", "check before I push", or as an agent-driven CI gate. Runs the tests affected by the diff on Nimbus locally and reports coverage delta, governor usage, and (on request) mutation score, flagging risky patterns — a fast local gate before the slow org deploy._

You are gating an Apex change before it goes to an org. Nimbus runs the affected tests locally in seconds, so you can catch coverage drops, governor regressions, and risky patterns before paying for a deploy. This skill produces a go / no-go report, not a fix — though it can hand off to the relevant fix skill.

### Preconditions

1. Nimbus is installed; the project runs; there's a diff to check (uncommitted changes, a branch vs `main`, or a named PR).
2. Use the CLI for the gate (`nimbus test … --json`, `--coverage`); it's scriptable for CI.

### Method

1. **Scope the diff.** Determine the changed Apex files (`git diff --name-only` against the base). Map each changed production class to its test class(es) — by naming convention (`FooTest` for `Foo`) and by scanning tests that reference the class. If you can't confidently map a changed class to a test, that's itself a finding (untested change).
2. **Run the affected tests with coverage.** `nimbus test "<Class1.*|Class2.*|…>" --coverage --json`. Prefer the narrow set for speed; fall back to `*` if the change is cross-cutting (e.g. a base class or trigger touched by many).
3. **Check the gates** and record each result:
   - **Pass/fail** — any red test is an automatic no-go.
   - **Coverage** — overall and per-changed-file line %. Flag any changed file below the project bar (default 75%) and any *drop* vs the pre-change baseline if available.
   - **Governor** — read `governorUsage` on the affected tests; flag SOQL/DML counts that scale with data or sit near limits (hand off to `bulkify-apex`).
   - **Risky patterns in the diff** — scan the changed lines for the checklist below.
4. **Mutation (on request or for critical paths).** If the user asks for depth, or the change is in core logic, run `nimbus mutate "<changed classes>"` and include the score; a low score on new code means weak tests (hand off to `harden-tests-with-mutation`).
5. **Emit a go / no-go report.** A short verdict line, then the evidence. Be decisive: green only if tests pass, coverage holds, and no high-severity pattern is present.

### Risky-pattern checklist (scan changed lines)

| Pattern | Why it's flagged |
|---|---|
| SOQL or DML inside a `for` loop | Governor blow-up under bulk — see `bulkify-apex` |
| `@isTest(SeeAllData=true)` | Test depends on org state; brittle and slow |
| Hardcoded 15/18-char IDs | Breaks across orgs |
| Empty `catch {}` / swallowed exceptions | Hides failures |
| New public/global method with no test referencing it | Untested surface |
| `without sharing` added to a class doing DML | Possible FLS/sharing regression — confirm intentional |
| Assertion-free test methods added | Coverage theatre; mutation would survive |

### Hard rules

- **This skill reports; it doesn't silently fix.** Surface findings and hand off to the right fix skill. Don't quietly rewrite the diff under the guise of a "check".
- **No-go is no-go.** A red test or a high-severity pattern fails the gate even if coverage is high. Don't soften the verdict to be agreeable.
- **Measure, don't guess.** Coverage and governor numbers come from an actual run, not from reading the code. If you couldn't run the tests, say the gate is *inconclusive*, not green.
- **Scope honestly.** If you ran a narrow set, say which tests ran and which you skipped — a green on 3 of 12 affected classes is not a green.

### When to stop and ask the user

- The diff touches a class you can't map to any test — report it and ask whether to proceed or write a test first (`apex-tdd`).
- A gate fails for a reason that's actually an intended behaviour change (coverage drop because dead code was deleted) — present it; let the user accept.

### Verification (of your own report)

1. The report states exactly which tests ran and their result — no hand-waving.
2. Every number (coverage %, governor counts, mutation score) is from a real run you can point to.
3. The verdict follows the rules above mechanically: green requires pass + coverage held + no high-severity pattern; otherwise no-go or inconclusive.


---

## apex-tdd

_Use when the user wants to build an Apex feature test-first, or asks to "do TDD", "write the test first", "red-green-refactor", or "implement X with tests". Drives a real red→green→refactor loop against Nimbus's local runtime so each cycle is sub-second instead of a multi-minute org deploy. This is the only way an agent can actually do TDD in Apex without an org._

You are building an Apex feature test-first in a Salesforce project that uses Nimbus for local execution. Nimbus runs Apex, SOQL, DML, and triggers against an embedded Postgres with no org, so the inner loop is fast enough to write one assertion at a time.

### Preconditions

1. The project has `sfdx-project.json` and Nimbus is installed (`nimbus --version`).
2. Nimbus's MCP server is registered (`claude mcp add nimbus -- nimbus mcp`). If MCP is unavailable, fall back to `nimbus test <pattern> --json` and parse the output.
3. You have a one-sentence statement of the behaviour to build. If the requirement is vague, ask the user for a concrete example (input → expected output) before writing any code.

### Loop

Work in the smallest possible increments. One behaviour per cycle.

1. **Red — write one failing test.** Add a single `@isTest` method (or one new assertion to an existing method) describing the next slice of behaviour. Name it for the behaviour, not the method (`convertsLeadWithMatchingAccount`, not `testConvert1`).
2. **Run it and confirm it fails for the right reason.** Call `run_apex_tests` with the narrow pattern (`ClassName.methodName`), `max_failures: 5`. A test that fails to *compile* or fails with `MethodException`/`NullPointerException` instead of an `AssertException` is not a valid red — fix the test until it fails on the assertion you intend.
3. **Green — write the minimum production code to pass.** No speculative generality. Implement only what this test demands.
4. **Re-run the same narrow pattern.** If green, continue. If red, return to step 3 with one new hypothesis — do not retry the same edit.
5. **Refactor — with the test green.** Clean up names, extract methods, remove duplication. Re-run after each refactor; the test must stay green. Refactor production *and* test code, but never change behaviour while a test is red.
6. **Widen and repeat.** Run `ClassName.*` to confirm no sibling regressed, then return to step 1 for the next behaviour.

### Hard rules

- **One behaviour per cycle.** Resist writing five tests then implementing. The discipline is the value.
- **Every red must fail on an assertion**, not a compile error or an unintended NPE. A test that was never red for the right reason proves nothing.
- **Never write production code with no failing test demanding it.** If you can't write a test for it, you don't need it yet.
- **Assert outcomes, not calls.** `System.assertEquals(expected, actual)` on real state — not `System.assert(true)` after invoking a method. Hollow assertions pass mutation testing's survivors straight through (see the `harden-tests-with-mutation` skill).
- **Use real DML/SOQL, not mocks, for the happy path.** Nimbus runs them for real — exploit that. Reserve stubs for genuine external boundaries (callouts).

### Designing the test list

Before the first cycle, jot a short list (in a comment or scratch note) of the behaviours to cover, ordered simplest-first:
- The trivial case (one record, happy path).
- Boundary/empty cases (zero rows, null inputs, empty collections).
- The bulk case (200 records — Apex's defining constraint; if this is trigger or DML code, a bulk test is mandatory, see `bulkify-apex`).
- Error cases (expected exceptions via `try/catch` + `System.assert` on the message).

Work down the list one cycle at a time. Add to it as new cases occur to you mid-build.

### When to stop and ask the user

- The behaviour depends on org metadata you can't infer (Custom Setting/Metadata records, Labels). Ask for the values.
- A test forces a product decision (what *should* happen on conflicting input?). Present the options, let the user choose, then encode the choice as the test.
- The requirement turns out larger than stated — surface the scope, don't silently build half of it.

### Verification before declaring done

1. Run the full class (`ClassName.*`) and confirm all green.
2. Run with coverage (`nimbus test ClassName.* --coverage`, or `get_coverage` after a run) and confirm the new code is actually exercised — TDD should yield high coverage by construction; a gap means a missing test.
3. Re-read the test list. Did you cover the bulk and error cases, or only the happy path? Name any deliberately-skipped case in your summary.


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

## bulkify-apex

_Use when Apex needs to be made safe against governor limits or bulk DML — "bulkify this", "queries in a loop", "hitting SOQL/DML limits", "will this survive 200 records", or a LimitException in a run. Uses Nimbus's local governor tracking and real 200-record execution to find limit problems and prove the fix, instead of eyeballing the code._

You are making Apex bulk-safe in a Salesforce project running on Nimbus. Nimbus executes triggers and DML for real and tracks governor usage per test locally, so you can *measure* SOQL/DML/CPU consumption and prove a bulk fix — not just argue about it.

### Preconditions

1. Nimbus is installed and the project runs.
2. Nimbus reports per-test governor usage. Preferred path (MCP): call `run_apex_tests` for the pattern, then `get_governor_usage` (optionally with a `class` filter) — it returns each test's usage map (SOQL queries, DML statements, CPU, …) plus the peak per limit. CLI fallback: `nimbus test "<pattern>" --json` and read each result's `governorUsage`. If governor enforcement is configured `strict`, over-limit code throws `LimitException` directly; if `warn`, usage is reported without failing.

### Method

1. **Establish a bulk test first.** Bulkification is unprovable without bulk data. If no test inserts ~200 records through the code path, write one (`@isTest` method that creates a `List<SObject>` of 200 and performs the DML / invokes the method). This test is the instrument.
2. **Measure.** Run it and record `governorUsage` (via `get_governor_usage`, or `--json`). The smell: SOQL or DML counts that scale with record count (200 records → ~200 queries) rather than staying flat. A `strict`-mode `LimitException: Too many SOQL queries: 101` is the same finding, harder.
3. **Locate the per-row offender.** Find the SOQL or DML *inside* a loop over records. Common shapes:
   - A `[SELECT … WHERE Id = :record.Id]` inside `for (X r : trigger.new)`.
   - `insert childRecord;` / `update r;` inside a loop.
   - A method called per-row that itself queries.
4. **Refactor to set-based.** The standard moves:
   - Collect IDs/keys into a `Set` in one pass, query **once** outside the loop into a `Map<Id, SObject>`, then look up in the loop.
   - Accumulate records into a `List` and do **one** `insert`/`update` after the loop.
   - Push per-row helper queries up to a single bulk query keyed by Id.
5. **Re-measure and prove it.** Re-run the bulk test with `--json`. SOQL/DML counts must now be flat (a small constant) regardless of record count. Show before/after numbers.
6. **Confirm correctness held.** The bulk test and the existing unit tests must still pass — bulkifying must not change results, only their cost.

### Hard rules

- **Prove it with numbers.** "Bulkified" means the measured `governorUsage` for the operation is constant in the record count — quote the before/after. Don't claim a fix you didn't measure.
- **Keep the bulk test.** It's the regression guard against someone re-introducing a loop query later. Leave it in the suite.
- **Never raise limits or split into smaller batches to dodge the count.** Fix the algorithm. Chunking DML to stay under a limit is a smell, not a fix.
- **Watch recursion too.** If the code is in a trigger, a bulk update can re-fire it — verify with a trace (`nimbus trace`) that the path runs the expected number of times, and add a static reentry guard if it doesn't.
- **Don't sacrifice readability blindly.** A `Map`-keyed lookup is the idiom; keep names clear so the bulk version is still obvious to the next reader.

### When to stop and ask the user

- The per-row query depends on data you can't bulk-key cleanly (e.g. a dynamic SOQL whose filter genuinely differs per row) — surface the design question.
- Bulkifying would change ordering/side-effects the tests rely on — that's a behaviour decision for the user.

### Verification

1. Bulk test passes and its `governorUsage` SOQL/DML counts are flat vs record count (show the numbers).
2. The full class's existing tests still pass — behaviour unchanged.
3. If it's trigger code, a trace confirms the handler fires the expected number of times under a bulk update (no runaway recursion).


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


---

## harden-tests-with-mutation

_Use when the user wants to know whether tests actually test anything, or to strengthen weak assertions — "are these tests any good", "run mutation testing", "kill the surviving mutants", "coverage is high but I don't trust it". Uses Nimbus's mutation testing (Pro) to find code that's executed-but-not-asserted, then strengthens the tests so the mutants die. Coverage says a line ran; mutation says it was checked._

You are improving Apex *test quality* (not coverage) in a project running on Nimbus. High line coverage only proves code executed — a test can run a line and assert nothing. Mutation testing introduces small changes (mutants) and checks your tests catch them; a **surviving** mutant is a hole in your assertions. Nimbus ships mutation testing locally.

### Preconditions

1. Nimbus is installed and the target class already has passing tests (mutation testing measures existing tests — fix red tests first with `fix-failing-apex-test`).
2. Mutation testing is a Pro feature. Preferred path (MCP): the `run_mutation_tests` tool — args `pattern`, `class` (mutate one class — recommended for speed), `timeout_seconds`, `survivors_only` (default true). It returns the score plus the surviving-mutant list. CLI equivalent: `nimbus mutate "<pattern>"` with `--survivors-only` and `--min-score N` (exit non-zero below N%, for CI gating).

### Method

1. **Baseline.** Run mutation on the target (`run_mutation_tests` with `class: "ClassName"`, or `nimbus mutate "ClassName"`) and read the mutation score plus the surviving-mutant list. Each survivor names a location and the mutation applied (e.g. `>` → `>=`, `true` → `false`, removed a method call, replaced a return).
2. **Read each survivor as a missing assertion.** A survivor means: "I changed the code here and every test still passed." That's behaviour no test pins down. Translate it: a mutated boundary (`>`→`>=`) that survives means no test exercises the boundary value; a removed side-effect call that survives means no test asserts the side effect.
3. **Strengthen the test, don't chase the mutant.** Add or tighten an assertion that would *fail* under the mutation:
   - Boundary mutants → add a test at the exact boundary (the off-by-one case).
   - Replaced return / constant → assert the real returned value, not just "not null".
   - Removed method call / DML → assert the observable effect of that call (the record was updated, the list grew).
   - Negated condition → add a case for the other branch.
4. **Re-run mutation on the same target** (`run_mutation_tests` / `nimbus mutate`). Confirm the score rose and that specific survivor is now killed. Don't move on until it's dead or you've consciously accepted it (see below).
5. **Repeat for the highest-value survivors.** Prioritise survivors in core logic over trivial ones. Stop when the score clears the project's bar (or `--min-score`) and the remaining survivors are documented equivalents.

### Hard rules

- **Kill mutants by asserting behaviour, never by deleting the mutated code.** The goal is stronger tests, not less code.
- **Never assert something tautological** (`System.assert(true)`, `assertNotNull` on a freshly-`new`'d object) — it kills no mutant and rots the suite. If an added assertion doesn't kill a survivor on re-run, it was hollow; replace it.
- **Don't game the score** by mutating fewer lines or excluding hard files. A high score on a narrowed target is a lie.
- **Equivalent mutants are real.** Some mutants can't be killed because they don't change observable behaviour (e.g. a mutated branch both paths of which return the same result). Mark these explicitly and move on — don't contort a test to "kill" a true equivalent.

### When to stop and ask the user

- A survivor reveals genuinely dead/unreachable production code — propose removing it rather than testing it, and let the user confirm.
- Killing a survivor would require asserting on a managed-package or external side-effect you can't observe locally — note it and skip.
- The user only wanted a quality *report*, not edits — deliver the survivor analysis and stop.

### Verification

1. Re-run `nimbus mutate "ClassName"` and show score before → after.
2. Every survivor you targeted is now killed, or is explicitly listed as an accepted equivalent with a one-line reason.
3. All tests still pass (`nimbus test "ClassName.*"`) and coverage did not drop — you added assertions, not removed cases.


---

## migrate-suite-to-nimbus

_Use when a team wants an existing Apex test suite running locally on Nimbus — phrasings like "get our tests running on Nimbus", "migrate the suite", "why do so many tests fail on Nimbus", or pasting a run where hundreds of tests fail right after first setup. Systematically clears the real blockers (missing schema, stubs, Test.loadData, unsupported calls) and drives toward a green local run, instead of fixing failures one by one._

You are getting a real project's Apex test suite to run on Nimbus's local runtime. The first full run of a mature org-grown suite almost always fails in clusters — the job is to fix *classes of failure*, not individual tests, in dependency order.

### Preconditions

1. The project has `sfdx-project.json` and Nimbus is installed. If Nimbus isn't initialised, run the `bootstrap-nimbus` skill first, then return here.
2. Work from the CLI for the bulk pass — `nimbus test "*" --json --quiet` gives a machine-readable failure list across the whole suite. Use MCP (`run_apex_tests`) for the tight loop on a single class once you're fixing.

### Method: cluster, then clear in order

1. **Get the full failure list.** Run `nimbus test "*" --json` and collect every failure with its exception type and message. Do not start fixing yet.
2. **Cluster by root cause, not by class.** Bucket failures by signature (see table). One missing field can redden 200 tests; one fix clears the bucket.
3. **Fix clusters in this order** — each layer unblocks the next, so ordering avoids re-work:
   1. **Schema gaps** — unknown SObject/field. Run `nimbus sync` (or refresh `.nimbus/schemas/`) so custom objects/fields resolve. Re-run; many failures evaporate.
   2. **Stub gaps** — unresolved managed-package or namespaced types. Add stubs (`nimbus stub add <Namespace>`, or configure `nimbus.stubs.namespaces`). See the Stubs system.
   3. **Static/setup init** — failures referencing data missing in `@testSetup` or static blocks. Confirm setup data is created before the assertions that read it.
   4. **`Test.loadData` / StaticResource fixtures** — point at the CSV/resource, or convert to factory inserts.
   5. **Unsupported or divergent platform calls** — anything left. Capture each as a distinct signature for the user / for a Nimbus issue; don't hand-hack around it silently.
4. **Re-run the whole suite after each layer.** Track the pass count climbing. Report the delta per layer (`820 → 1,310 → 1,890 passing`) so progress is visible.

### Failure-cluster reference

| Signature | Cluster | Fix |
|---|---|---|
| `Unknown SObject 'X__c'` / `No such column 'Y__c'` | Schema not synced | `nimbus sync`; refresh local schema from the org or project metadata |
| `Unknown type 'ns__Foo'` / managed-package class missing | Stub gap | `nimbus stub add ns`; set `nimbus.stubs.namespaces` |
| `List has no rows` / NPE in many tests sharing a setup | Static/setup init order | Verify `@testSetup` inserts the records the tests query |
| `Test.loadData` errors / StaticResource not found | Fixture loading | Wire the resource path or replace with factory inserts |
| One specific platform method throws "not implemented" | Genuine engine gap | Record the exact call; report it — do not fake the result |

### Hard rules

- **Fix by cluster, top of the list down.** Never start hand-editing individual tests before the schema and stub layers are clean — most "failures" are the same missing field.
- **Never weaken tests to migrate them.** No deleting assertions, no `SeeAllData=true`, no commenting out methods. A migrated suite that no longer tests anything is worthless.
- **Don't paper over an engine gap.** If a platform call genuinely isn't supported, surface it as a precise, minimal repro for the user — that's a product signal, not something to monkey-patch around.
- **Distinguish "fails on Nimbus only" from "fails everywhere."** If a test also fails in the org (flaky, order-dependent, pre-existing red), say so — it's not a migration blocker.

### When to stop and ask the user

- An org connection / `nimbus sync` needs credentials or an org alias you don't have.
- A managed package has no stub and no public source — ask whether to stub it or skip those tests.
- Remaining failures all trace to one unsupported platform feature — report the cluster and let the user decide (stub, skip, or wait on a Nimbus fix).

### Verification before declaring done

1. Run the full suite once more; report final `passing / total` and the list of any still-red tests grouped by cause.
2. For anything still red, state explicitly whether it's a Nimbus gap, a missing-metadata gap, or a pre-existing org failure — each has a different owner.
3. Leave a one-line `nimbus test "*"` CI snippet (or confirm `bootstrap-nimbus` already added one) so the green stays green.


---

## triage-apex-failures

_Use when a test run comes back with many failures and the user wants to understand them before fixing — "triage these failures", "what's going on with the suite", "group these errors", or pasting a long red run. Clusters failures by root cause using Nimbus's stack traces and execution traces, explains each cluster, and proposes a fix order — rather than diving into the first failure._

You are making sense of a failing Apex suite before fixing anything. Many failures usually share a few root causes; triage finds the causes so the fix is a handful of edits, not hundreds. Nimbus gives you per-failure stack traces and, on demand, full execution traces.

### Preconditions

1. Nimbus is installed and the project runs (`nimbus --version`, `sfdx-project.json` present).
2. Get the full picture first: `nimbus test "<scope>" --json` (scope = `*`, a package dir, or a class glob). Use `run_apex_tests` via MCP for re-running a single cluster while you investigate.

### Method

1. **Collect every failure.** From the JSON, capture for each: class, method, exception type, message, and the top stack frame.
2. **Normalise messages into signatures.** Strip record IDs, row counts, and line numbers so `Expected: 5, Actual: 3` and `Expected: 9, Actual: 1` collapse to one signature `AssertException: Expected/Actual mismatch`. Group by signature.
3. **Rank clusters by blast radius.** Sort by failure count. The top cluster is almost always one shared cause (a missing setup field, a broken trigger, an unsynced schema).
4. **Diagnose one representative per cluster.** Pick the smallest-looking failure in the cluster. Read the test method and the production code it calls. If the stack alone doesn't explain it, capture an execution trace: `nimbus trace ClassName.methodName` (writes trace JSON to `.nimbus/traces/`) and read where execution diverged — the trace shows the real call/SOQL/DML path, not just the failing line.
5. **Write the diagnosis.** For each cluster: one sentence of root cause, the count it explains, and a proposed fix with a confidence level. Order the clusters into a fix sequence (schema/setup causes first — they often dissolve downstream clusters).
6. **Hand off or fix.** Present the triage table. If the user wants you to proceed, fix top cluster first with the `fix-failing-apex-test` skill, re-run the whole scope, and re-triage the remainder (the counts will have shifted).

### Output: the triage table

Always produce a table like:

| # | Root cause (1 sentence) | Failures | Proposed fix | Confidence |
|---|---|---|---|---|
| 1 | `@testSetup` never inserts the Account the queries filter on | 142 | Add the Account to setup | high |
| 2 | Trigger recursion guard missing → second update re-fires | 31 | Add static reentry flag | med |
| 3 | One unsupported platform call | 4 | Report to Nimbus / stub | low |

Counts must sum to (near) the total failures, so the user can see the long tail is accounted for.

### Hard rules

- **Diagnose before fixing.** Do not start editing on failure #1 — you'll fix a symptom of cluster #1 and miss that it explains 142 tests.
- **One representative per cluster.** Don't read all 142; read one, confirm the shared cause, then spot-check a second to be sure the cluster is real.
- **Separate Nimbus-only failures from real bugs.** A cluster that reproduces in the org is a product bug to report, not a migration artifact — label it.
- **Don't inflate confidence.** If the trace doesn't conclusively show the cause, mark it `low` and say what you'd need to confirm.

### When to stop and ask the user

- Clusters point at missing org metadata or credentials you can't supply.
- The top cluster is a genuine product bug whose fix changes behaviour — present it, don't unilaterally change semantics.
- After two triage rounds the residual failures are unrelated singletons — hand the list back; they're individual jobs, not a cluster.

### Verification

- The triage table's counts account for essentially all failures (no silent remainder).
- Each cluster names a *cause*, not a symptom ("queries return 0 rows because setup omits the Account", not "NullPointerException").
- If you fixed anything, re-run the full scope and show the new counts so the user sees clusters clearing.

