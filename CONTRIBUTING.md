# Contributing

## Proposing a new skill

A skill belongs in this repo if it:

1. Targets a concrete Apex workflow (a thing a Salesforce developer does on a Tuesday afternoon).
2. Benefits materially from Nimbus's sub-second test loop or MCP tools — not just generic Apex advice.
3. Has hard rules. Skills that say "use your judgment" without listing the bad alternatives are not useful guardrails.

Open an issue describing the workflow and the failure modes you want the skill to prevent before sending a PR.

## Editing skills

Skills live in `skills/<name>/SKILL.md`. The format is Claude Code's: YAML frontmatter with `name` and `description`, then a Markdown body.

```markdown
---
name: my-skill
description: Use when… (one paragraph; this is what the agent reads to decide whether to load the skill)
---

# Title

Body…
```

After editing, regenerate `dist/`:

```bash
node scripts/build.mjs
```

CI fails if `dist/` is out of sync with `skills/` — never commit changes to `skills/` without rebuilding `dist/`.

## Style

- **Imperative voice.** "Run `nimbus test`" not "you should run `nimbus test`".
- **Numbered loops, not prose.** Agents follow numbered steps better than paragraphs.
- **Hard rules section.** List what the agent must *not* do. This is where most of the safety value lives.
- **Verification section.** State the conditions under which the skill is "done". Without this, agents stop too early or too late.
- **No marketing.** Don't say Nimbus is fast or great — show it by recommending a workflow that depends on speed.

## License

By contributing, you agree your contributions are MIT-licensed.
