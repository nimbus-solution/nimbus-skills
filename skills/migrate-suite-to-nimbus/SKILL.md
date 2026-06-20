---
name: migrate-suite-to-nimbus
description: Use when a team wants an existing Apex test suite running locally on Nimbus — phrasings like "get our tests running on Nimbus", "migrate the suite", "why do so many tests fail on Nimbus", or pasting a run where hundreds of tests fail right after first setup. Systematically clears the real blockers (missing schema, stubs, Test.loadData, unsupported calls) and drives toward a green local run, instead of fixing failures one by one.
---

# Migrate an existing suite to Nimbus

You are getting a real project's Apex test suite to run on Nimbus's local runtime. The first full run of a mature org-grown suite almost always fails in clusters — the job is to fix *classes of failure*, not individual tests, in dependency order.

## Preconditions

1. The project has `sfdx-project.json` and Nimbus is installed. If Nimbus isn't initialised, run the `bootstrap-nimbus` skill first, then return here.
2. Work from the CLI for the bulk pass — `nimbus test "*" --json --quiet` gives a machine-readable failure list across the whole suite. Use MCP (`run_apex_tests`) for the tight loop on a single class once you're fixing.

## Method: cluster, then clear in order

1. **Get the full failure list.** Run `nimbus test "*" --json` and collect every failure with its exception type and message. Do not start fixing yet.
2. **Cluster by root cause, not by class.** Bucket failures by signature (see table). One missing field can redden 200 tests; one fix clears the bucket.
3. **Fix clusters in this order** — each layer unblocks the next, so ordering avoids re-work:
   1. **Schema gaps** — unknown SObject/field. Run `nimbus sync` (or refresh `.nimbus/schemas/`) so custom objects/fields resolve. Re-run; many failures evaporate.
   2. **Stub gaps** — unresolved managed-package or namespaced types. Add stubs (`nimbus stub add <Namespace>`, or configure `nimbus.stubs.namespaces`). See the Stubs system.
   3. **Static/setup init** — failures referencing data missing in `@testSetup` or static blocks. Confirm setup data is created before the assertions that read it.
   4. **`Test.loadData` / StaticResource fixtures** — point at the CSV/resource, or convert to factory inserts.
   5. **Unsupported or divergent platform calls** — anything left. Capture each as a distinct signature for the user / for a Nimbus issue; don't hand-hack around it silently.
4. **Re-run the whole suite after each layer.** Track the pass count climbing. Report the delta per layer (`820 → 1,310 → 1,890 passing`) so progress is visible.

## Failure-cluster reference

| Signature | Cluster | Fix |
|---|---|---|
| `Unknown SObject 'X__c'` / `No such column 'Y__c'` | Schema not synced | `nimbus sync`; refresh local schema from the org or project metadata |
| `Unknown type 'ns__Foo'` / managed-package class missing | Stub gap | `nimbus stub add ns`; set `nimbus.stubs.namespaces` |
| `List has no rows` / NPE in many tests sharing a setup | Static/setup init order | Verify `@testSetup` inserts the records the tests query |
| `Test.loadData` errors / StaticResource not found | Fixture loading | Wire the resource path or replace with factory inserts |
| One specific platform method throws "not implemented" | Genuine engine gap | Record the exact call; report it — do not fake the result |

## Hard rules

- **Fix by cluster, top of the list down.** Never start hand-editing individual tests before the schema and stub layers are clean — most "failures" are the same missing field.
- **Never weaken tests to migrate them.** No deleting assertions, no `SeeAllData=true`, no commenting out methods. A migrated suite that no longer tests anything is worthless.
- **Don't paper over an engine gap.** If a platform call genuinely isn't supported, surface it as a precise, minimal repro for the user — that's a product signal, not something to monkey-patch around.
- **Distinguish "fails on Nimbus only" from "fails everywhere."** If a test also fails in the org (flaky, order-dependent, pre-existing red), say so — it's not a migration blocker.

## When to stop and ask the user

- An org connection / `nimbus sync` needs credentials or an org alias you don't have.
- A managed package has no stub and no public source — ask whether to stub it or skip those tests.
- Remaining failures all trace to one unsupported platform feature — report the cluster and let the user decide (stub, skip, or wait on a Nimbus fix).

## Verification before declaring done

1. Run the full suite once more; report final `passing / total` and the list of any still-red tests grouped by cause.
2. For anything still red, state explicitly whether it's a Nimbus gap, a missing-metadata gap, or a pre-existing org failure — each has a different owner.
3. Leave a one-line `nimbus test "*"` CI snippet (or confirm `bootstrap-nimbus` already added one) so the green stays green.
