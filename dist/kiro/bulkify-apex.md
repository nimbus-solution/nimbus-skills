---
inclusion: manual
---

# Bulkify Apex against governor limits

You are making Apex bulk-safe in a Salesforce project running on Nimbus. Nimbus executes triggers and DML for real and tracks governor usage per test locally, so you can *measure* SOQL/DML/CPU consumption and prove a bulk fix — not just argue about it.

## Preconditions

1. Nimbus is installed and the project runs.
2. Nimbus reports per-test governor usage. Preferred path (MCP): call `run_apex_tests` for the pattern, then `get_governor_usage` (optionally with a `class` filter) — it returns each test's usage map (SOQL queries, DML statements, CPU, …) plus the peak per limit. CLI fallback: `nimbus test "<pattern>" --json` and read each result's `governorUsage`. If governor enforcement is configured `strict`, over-limit code throws `LimitException` directly; if `warn`, usage is reported without failing.

## Method

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

## Hard rules

- **Prove it with numbers.** "Bulkified" means the measured `governorUsage` for the operation is constant in the record count — quote the before/after. Don't claim a fix you didn't measure.
- **Keep the bulk test.** It's the regression guard against someone re-introducing a loop query later. Leave it in the suite.
- **Never raise limits or split into smaller batches to dodge the count.** Fix the algorithm. Chunking DML to stay under a limit is a smell, not a fix.
- **Watch recursion too.** If the code is in a trigger, a bulk update can re-fire it — verify with a trace (`nimbus trace`) that the path runs the expected number of times, and add a static reentry guard if it doesn't.
- **Don't sacrifice readability blindly.** A `Map`-keyed lookup is the idiom; keep names clear so the bulk version is still obvious to the next reader.

## When to stop and ask the user

- The per-row query depends on data you can't bulk-key cleanly (e.g. a dynamic SOQL whose filter genuinely differs per row) — surface the design question.
- Bulkifying would change ordering/side-effects the tests rely on — that's a behaviour decision for the user.

## Verification

1. Bulk test passes and its `governorUsage` SOQL/DML counts are flat vs record count (show the numbers).
2. The full class's existing tests still pass — behaviour unchanged.
3. If it's trigger code, a trace confirms the handler fires the expected number of times under a bulk update (no runaway recursion).
