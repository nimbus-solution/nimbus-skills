# nimbus-skills

Curated agent skills for working on Apex with **[Nimbus](https://testnimbus.dev)** — the local Apex test runner.

Skills are short, opinionated playbooks that tell an AI coding agent **when** and **how** to use Nimbus's MCP tools effectively. Three to start:

- **`fix-failing-apex-test`** — the inner loop. Read failure → narrow → edit → re-run, until green.
- **`bootstrap-nimbus`** — set Nimbus up on a fresh SFDX project, including CI.
- **`apex-coverage-uplift`** — raise coverage by writing targeted tests, not theatre.

All three assume the project has Nimbus installed and the MCP server registered with the agent (`claude mcp add nimbus -- nimbus mcp`).

## Install

### Recommended: `nimbus skills install`

If you've already installed [Nimbus](https://testnimbus.dev), one command picks up everything in this repo and writes it to the right place for your agent:

```bash
nimbus skills list                          # see what's available
nimbus skills install fix-failing-apex-test # install one
nimbus skills install all                   # install every skill the agent supports
```

`nimbus skills` auto-detects your agent from the project root. Override with `--agent claude-code|cursor|aider|agents-md|kiro`. The CLI fetches manifest + files from this repo on demand — your binary stays small and you always get the latest.

### Manual install (no nimbus binary)

#### Claude Code

```bash
mkdir -p ~/.claude/skills
git clone https://github.com/nimbus-solution/nimbus-skills.git /tmp/nimbus-skills
cp -r /tmp/nimbus-skills/dist/claude-code/* ~/.claude/skills/
```

Or per-project: copy into `.claude/skills/` at the project root.

#### Cursor

```bash
mkdir -p .cursor/rules
curl -L https://github.com/nimbus-solution/nimbus-skills/raw/main/dist/cursor/fix-failing-apex-test.mdc -o .cursor/rules/fix-failing-apex-test.mdc
curl -L https://github.com/nimbus-solution/nimbus-skills/raw/main/dist/cursor/bootstrap-nimbus.mdc -o .cursor/rules/bootstrap-nimbus.mdc
curl -L https://github.com/nimbus-solution/nimbus-skills/raw/main/dist/cursor/apex-coverage-uplift.mdc -o .cursor/rules/apex-coverage-uplift.mdc
```

#### Kiro

```bash
mkdir -p .kiro/steering
curl -L https://github.com/nimbus-solution/nimbus-skills/raw/main/dist/kiro/fix-failing-apex-test.md -o .kiro/steering/fix-failing-apex-test.md
curl -L https://github.com/nimbus-solution/nimbus-skills/raw/main/dist/kiro/bootstrap-nimbus.md -o .kiro/steering/bootstrap-nimbus.md
curl -L https://github.com/nimbus-solution/nimbus-skills/raw/main/dist/kiro/apex-coverage-uplift.md -o .kiro/steering/apex-coverage-uplift.md
```

Skills use `inclusion: manual`, so load them on demand by typing `#fix-failing-apex-test` (or another name) in your Kiro prompt.

#### Aider

```bash
curl -L https://github.com/nimbus-solution/nimbus-skills/raw/main/dist/aider/CONVENTIONS.md -o CONVENTIONS.md
aider --read CONVENTIONS.md
```

#### AGENTS.md (OpenCode, Codex, Continue, generic harnesses)

```bash
curl -L https://github.com/nimbus-solution/nimbus-skills/raw/main/dist/AGENTS.md -o AGENTS.md
```

OpenCode reads `AGENTS.md` verbatim — no further config needed.

## Repo layout

```
skills/                  # Source of truth — edit these
  fix-failing-apex-test/SKILL.md
  bootstrap-nimbus/SKILL.md
  apex-coverage-uplift/SKILL.md
dist/                    # Generated; do not edit
  claude-code/<name>/SKILL.md
  cursor/<name>.mdc
  kiro/<name>.md
  aider/CONVENTIONS.md
  AGENTS.md
manifest.json            # Generated; consumed by `nimbus skills`
scripts/build.mjs        # Renders dist/ + manifest.json from skills/
```

The build script is dependency-free Node — `node scripts/build.mjs` regenerates `dist/` and `manifest.json`. CI verifies both stay in sync with `skills/` on every PR.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). New skills are welcome if they target a real Apex workflow that benefits from sub-second iteration.

## License

MIT.

---

Built for [**Nimbus**](https://testnimbus.dev) — Apex testing, locally.
