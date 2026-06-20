---
inclusion: manual
---

# Harden tests with mutation testing

You are improving Apex *test quality* (not coverage) in a project running on Nimbus. High line coverage only proves code executed — a test can run a line and assert nothing. Mutation testing introduces small changes (mutants) and checks your tests catch them; a **surviving** mutant is a hole in your assertions. Nimbus ships mutation testing locally.

## Preconditions

1. Nimbus is installed and the target class already has passing tests (mutation testing measures existing tests — fix red tests first with `fix-failing-apex-test`).
2. Mutation testing is a Pro feature. Preferred path (MCP): the `run_mutation_tests` tool — args `pattern`, `class` (mutate one class — recommended for speed), `timeout_seconds`, `survivors_only` (default true). It returns the score plus the surviving-mutant list. CLI equivalent: `nimbus mutate "<pattern>"` with `--survivors-only` and `--min-score N` (exit non-zero below N%, for CI gating).

## Method

1. **Baseline.** Run mutation on the target (`run_mutation_tests` with `class: "ClassName"`, or `nimbus mutate "ClassName"`) and read the mutation score plus the surviving-mutant list. Each survivor names a location and the mutation applied (e.g. `>` → `>=`, `true` → `false`, removed a method call, replaced a return).
2. **Read each survivor as a missing assertion.** A survivor means: "I changed the code here and every test still passed." That's behaviour no test pins down. Translate it: a mutated boundary (`>`→`>=`) that survives means no test exercises the boundary value; a removed side-effect call that survives means no test asserts the side effect.
3. **Strengthen the test, don't chase the mutant.** Add or tighten an assertion that would *fail* under the mutation:
   - Boundary mutants → add a test at the exact boundary (the off-by-one case).
   - Replaced return / constant → assert the real returned value, not just "not null".
   - Removed method call / DML → assert the observable effect of that call (the record was updated, the list grew).
   - Negated condition → add a case for the other branch.
4. **Re-run mutation on the same target** (`run_mutation_tests` / `nimbus mutate`). Confirm the score rose and that specific survivor is now killed. Don't move on until it's dead or you've consciously accepted it (see below).
5. **Repeat for the highest-value survivors.** Prioritise survivors in core logic over trivial ones. Stop when the score clears the project's bar (or `--min-score`) and the remaining survivors are documented equivalents.

## Hard rules

- **Kill mutants by asserting behaviour, never by deleting the mutated code.** The goal is stronger tests, not less code.
- **Never assert something tautological** (`System.assert(true)`, `assertNotNull` on a freshly-`new`'d object) — it kills no mutant and rots the suite. If an added assertion doesn't kill a survivor on re-run, it was hollow; replace it.
- **Don't game the score** by mutating fewer lines or excluding hard files. A high score on a narrowed target is a lie.
- **Equivalent mutants are real.** Some mutants can't be killed because they don't change observable behaviour (e.g. a mutated branch both paths of which return the same result). Mark these explicitly and move on — don't contort a test to "kill" a true equivalent.

## When to stop and ask the user

- A survivor reveals genuinely dead/unreachable production code — propose removing it rather than testing it, and let the user confirm.
- Killing a survivor would require asserting on a managed-package or external side-effect you can't observe locally — note it and skip.
- The user only wanted a quality *report*, not edits — deliver the survivor analysis and stop.

## Verification

1. Re-run `nimbus mutate "ClassName"` and show score before → after.
2. Every survivor you targeted is now killed, or is explicitly listed as an accepted equivalent with a one-line reason.
3. All tests still pass (`nimbus test "ClassName.*"`) and coverage did not drop — you added assertions, not removed cases.
