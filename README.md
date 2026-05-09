# nimbus-skills

Curated agent skills for working on Apex with [Nimbus](https://nimbus.dev) — the local Apex test runner.

Skills are short, opinionated playbooks that tell an AI coding agent **when** and **how** to use Nimbus's MCP tools effectively. Three to start:

- **`fix-failing-apex-test`** — the inner loop. Read failure → narrow → edit → re-run, until green.
- **`bootstrap-nimbus`** — set Nimbus up on a fresh SFDX project, including CI.
- **`apex-coverage-uplift`** — raise coverage by writing targeted tests, not theatre.

All three assume the project has Nimbus installed and the MCP server registered with the agent (`claude mcp add nimbus -- nimbus mcp`).

## Install

### Claude Code

```bash
mkdir -p ~/.claude/skills
git clone https://github.com/nimbus-solution/nimbus-skills.git /tmp/nimbus-skills
cp -r /tmp/nimbus-skills/dist/claude-code/* ~/.claude/skills/
```

Or per-project: copy into `.claude/skills/` at the project root.

### Cursor

```bash
mkdir -p .cursor/rules
curl -L https://github.com/nimbus-solution/nimbus-skills/raw/main/dist/cursor/fix-failing-apex-test.mdc -o .cursor/rules/fix-failing-apex-test.mdc
curl -L https://github.com/nimbus-solution/nimbus-skills/raw/main/dist/cursor/bootstrap-nimbus.mdc -o .cursor/rules/bootstrap-nimbus.mdc
curl -L https://github.com/nimbus-solution/nimbus-skills/raw/main/dist/cursor/apex-coverage-uplift.mdc -o .cursor/rules/apex-coverage-uplift.mdc
```

### Aider

```bash
curl -L https://github.com/nimbus-solution/nimbus-skills/raw/main/dist/aider/CONVENTIONS.md -o CONVENTIONS.md
aider --read CONVENTIONS.md
```

### Other agents (Codex, Continue, generic harnesses)

Drop [`dist/AGENTS.md`](dist/AGENTS.md) at the root of your project. Most modern agents auto-load it.

## Repo layout

```
skills/                  # Source of truth — edit these
  fix-failing-apex-test/SKILL.md
  bootstrap-nimbus/SKILL.md
  apex-coverage-uplift/SKILL.md
dist/                    # Generated; do not edit
  claude-code/<name>/SKILL.md
  cursor/<name>.mdc
  aider/CONVENTIONS.md
  AGENTS.md
scripts/build.mjs        # Renders dist/ from skills/
```

The build script is dependency-free Node — `node scripts/build.mjs` regenerates `dist/`. CI verifies `dist/` matches `skills/` on every PR.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). New skills are welcome if they target a real Apex workflow that benefits from sub-second iteration.

## License

MIT.
