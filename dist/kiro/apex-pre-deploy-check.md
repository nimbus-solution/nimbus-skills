---
inclusion: manual
---

# Pre-deploy check for an Apex change

You are gating an Apex change before it goes to an org. Nimbus runs the affected tests locally in seconds, so you can catch coverage drops, governor regressions, and risky patterns before paying for a deploy. This skill produces a go / no-go report, not a fix — though it can hand off to the relevant fix skill.

## Preconditions

1. Nimbus is installed; the project runs; there's a diff to check (uncommitted changes, a branch vs `main`, or a named PR).
2. Use the CLI for the gate (`nimbus test … --json`, `--coverage`); it's scriptable for CI.

## Method

1. **Scope the diff.** Determine the changed Apex files (`git diff --name-only` against the base). Map each changed production class to its test class(es) — by naming convention (`FooTest` for `Foo`) and by scanning tests that reference the class. If you can't confidently map a changed class to a test, that's itself a finding (untested change).
2. **Run the affected tests with coverage.** `nimbus test "<Class1.*|Class2.*|…>" --coverage --json`. Prefer the narrow set for speed; fall back to `*` if the change is cross-cutting (e.g. a base class or trigger touched by many).
3. **Check the gates** and record each result:
   - **Pass/fail** — any red test is an automatic no-go.
   - **Coverage** — overall and per-changed-file line %. Flag any changed file below the project bar (default 75%) and any *drop* vs the pre-change baseline if available.
   - **Governor** — read `governorUsage` on the affected tests; flag SOQL/DML counts that scale with data or sit near limits (hand off to `bulkify-apex`).
   - **Risky patterns in the diff** — scan the changed lines for the checklist below.
4. **Mutation (on request or for critical paths).** If the user asks for depth, or the change is in core logic, run `nimbus mutate "<changed classes>"` and include the score; a low score on new code means weak tests (hand off to `harden-tests-with-mutation`).
5. **Emit a go / no-go report.** A short verdict line, then the evidence. Be decisive: green only if tests pass, coverage holds, and no high-severity pattern is present.

## Risky-pattern checklist (scan changed lines)

| Pattern | Why it's flagged |
|---|---|
| SOQL or DML inside a `for` loop | Governor blow-up under bulk — see `bulkify-apex` |
| `@isTest(SeeAllData=true)` | Test depends on org state; brittle and slow |
| Hardcoded 15/18-char IDs | Breaks across orgs |
| Empty `catch {}` / swallowed exceptions | Hides failures |
| New public/global method with no test referencing it | Untested surface |
| `without sharing` added to a class doing DML | Possible FLS/sharing regression — confirm intentional |
| Assertion-free test methods added | Coverage theatre; mutation would survive |

## Hard rules

- **This skill reports; it doesn't silently fix.** Surface findings and hand off to the right fix skill. Don't quietly rewrite the diff under the guise of a "check".
- **No-go is no-go.** A red test or a high-severity pattern fails the gate even if coverage is high. Don't soften the verdict to be agreeable.
- **Measure, don't guess.** Coverage and governor numbers come from an actual run, not from reading the code. If you couldn't run the tests, say the gate is *inconclusive*, not green.
- **Scope honestly.** If you ran a narrow set, say which tests ran and which you skipped — a green on 3 of 12 affected classes is not a green.

## When to stop and ask the user

- The diff touches a class you can't map to any test — report it and ask whether to proceed or write a test first (`apex-tdd`).
- A gate fails for a reason that's actually an intended behaviour change (coverage drop because dead code was deleted) — present it; let the user accept.

## Verification (of your own report)

1. The report states exactly which tests ran and their result — no hand-waving.
2. Every number (coverage %, governor counts, mutation score) is from a real run you can point to.
3. The verdict follows the rules above mechanically: green requires pass + coverage held + no high-severity pattern; otherwise no-go or inconclusive.
