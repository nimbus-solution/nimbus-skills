---
name: triage-apex-failures
description: Use when a test run comes back with many failures and the user wants to understand them before fixing — "triage these failures", "what's going on with the suite", "group these errors", or pasting a long red run. Clusters failures by root cause using Nimbus's stack traces and execution traces, explains each cluster, and proposes a fix order — rather than diving into the first failure.
---

# Triage a wall of Apex failures

You are making sense of a failing Apex suite before fixing anything. Many failures usually share a few root causes; triage finds the causes so the fix is a handful of edits, not hundreds. Nimbus gives you per-failure stack traces and, on demand, full execution traces.

## Preconditions

1. Nimbus is installed and the project runs (`nimbus --version`, `sfdx-project.json` present).
2. Get the full picture first: `nimbus test "<scope>" --json` (scope = `*`, a package dir, or a class glob). Use `run_apex_tests` via MCP for re-running a single cluster while you investigate.

## Method

1. **Collect every failure.** From the JSON, capture for each: class, method, exception type, message, and the top stack frame.
2. **Normalise messages into signatures.** Strip record IDs, row counts, and line numbers so `Expected: 5, Actual: 3` and `Expected: 9, Actual: 1` collapse to one signature `AssertException: Expected/Actual mismatch`. Group by signature.
3. **Rank clusters by blast radius.** Sort by failure count. The top cluster is almost always one shared cause (a missing setup field, a broken trigger, an unsynced schema).
4. **Diagnose one representative per cluster.** Pick the smallest-looking failure in the cluster. Read the test method and the production code it calls. If the stack alone doesn't explain it, capture an execution trace: `nimbus trace ClassName.methodName` (writes trace JSON to `.nimbus/traces/`) and read where execution diverged — the trace shows the real call/SOQL/DML path, not just the failing line.
5. **Write the diagnosis.** For each cluster: one sentence of root cause, the count it explains, and a proposed fix with a confidence level. Order the clusters into a fix sequence (schema/setup causes first — they often dissolve downstream clusters).
6. **Hand off or fix.** Present the triage table. If the user wants you to proceed, fix top cluster first with the `fix-failing-apex-test` skill, re-run the whole scope, and re-triage the remainder (the counts will have shifted).

## Output: the triage table

Always produce a table like:

| # | Root cause (1 sentence) | Failures | Proposed fix | Confidence |
|---|---|---|---|---|
| 1 | `@testSetup` never inserts the Account the queries filter on | 142 | Add the Account to setup | high |
| 2 | Trigger recursion guard missing → second update re-fires | 31 | Add static reentry flag | med |
| 3 | One unsupported platform call | 4 | Report to Nimbus / stub | low |

Counts must sum to (near) the total failures, so the user can see the long tail is accounted for.

## Hard rules

- **Diagnose before fixing.** Do not start editing on failure #1 — you'll fix a symptom of cluster #1 and miss that it explains 142 tests.
- **One representative per cluster.** Don't read all 142; read one, confirm the shared cause, then spot-check a second to be sure the cluster is real.
- **Separate Nimbus-only failures from real bugs.** A cluster that reproduces in the org is a product bug to report, not a migration artifact — label it.
- **Don't inflate confidence.** If the trace doesn't conclusively show the cause, mark it `low` and say what you'd need to confirm.

## When to stop and ask the user

- Clusters point at missing org metadata or credentials you can't supply.
- The top cluster is a genuine product bug whose fix changes behaviour — present it, don't unilaterally change semantics.
- After two triage rounds the residual failures are unrelated singletons — hand the list back; they're individual jobs, not a cluster.

## Verification

- The triage table's counts account for essentially all failures (no silent remainder).
- Each cluster names a *cause*, not a symptom ("queries return 0 rows because setup omits the Account", not "NullPointerException").
- If you fixed anything, re-run the full scope and show the new counts so the user sees clusters clearing.
