#!/usr/bin/env node
// Render dist/* from skills/*. Source of truth lives in skills/<name>/SKILL.md
// using Claude Code's YAML-frontmatter format. Other agents get mechanical
// re-encodings of the same body — never edit dist/* by hand.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS_DIR = join(ROOT, 'skills');
const DIST_DIR = join(ROOT, 'dist');

function parseFrontmatter(md) {
  if (!md.startsWith('---\n')) return { frontmatter: {}, body: md };
  const end = md.indexOf('\n---\n', 4);
  if (end === -1) return { frontmatter: {}, body: md };
  const yaml = md.slice(4, end);
  const body = md.slice(end + 5).replace(/^\n+/, '');
  const frontmatter = {};
  for (const line of yaml.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    frontmatter[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { frontmatter, body };
}

function loadSkills() {
  const skills = [];
  for (const name of readdirSync(SKILLS_DIR).sort()) {
    const skillPath = join(SKILLS_DIR, name);
    if (!statSync(skillPath).isDirectory()) continue;
    const file = join(skillPath, 'SKILL.md');
    const raw = readFileSync(file, 'utf8');
    const { frontmatter, body } = parseFrontmatter(raw);
    if (!frontmatter.name || !frontmatter.description) {
      throw new Error(`${file}: missing 'name' or 'description' frontmatter`);
    }
    skills.push({ name, frontmatter, body, raw });
  }
  return skills;
}

function writeClaudeCode(skills) {
  const dir = join(DIST_DIR, 'claude-code');
  for (const s of skills) {
    const target = join(dir, s.name);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'SKILL.md'), s.raw);
  }
}

function writeCursor(skills) {
  const dir = join(DIST_DIR, 'cursor');
  mkdirSync(dir, { recursive: true });
  for (const s of skills) {
    const mdc = `---
description: ${s.frontmatter.description}
globs:
alwaysApply: false
---

${s.body}`;
    writeFileSync(join(dir, `${s.name}.mdc`), mdc);
  }
}

// Strip the body's leading H1 (it duplicates the skill-name section we emit
// ourselves) and demote every remaining heading by one level so the result
// nests cleanly under our H2 skill section.
function demoteHeadings(body) {
  const stripped = body.replace(/^# [^\n]*\n+/, '');
  return stripped.replace(/^(#+) /gm, (_, hashes) => `${hashes}# `);
}

function writeAider(skills) {
  const dir = join(DIST_DIR, 'aider');
  mkdirSync(dir, { recursive: true });
  const sections = skills.map(s =>
    `## Skill: ${s.frontmatter.name}\n\n_${s.frontmatter.description}_\n\n${demoteHeadings(s.body)}`
  );
  const out = `# Nimbus Conventions for Aider

These conventions tell Aider how to use Nimbus when working on Apex code in this project.
Load with: \`aider --read CONVENTIONS.md\`

${sections.join('\n\n---\n\n')}
`;
  writeFileSync(join(dir, 'CONVENTIONS.md'), out);
}

function writeAgentsMd(skills) {
  const sections = skills.map(s =>
    `## ${s.frontmatter.name}\n\n_${s.frontmatter.description}_\n\n${demoteHeadings(s.body)}`
  );
  const out = `# AGENTS.md — Nimbus

Generic agent instructions for working on Apex code in this project with Nimbus.
Compatible with any agent that reads AGENTS.md (Codex, Continue, generic harnesses).

${sections.join('\n\n---\n\n')}
`;
  writeFileSync(join(DIST_DIR, 'AGENTS.md'), out);
}

// The manifest is the contract between this repo and the `nimbus skills` CLI.
// Bumping `version` is a breaking change; add fields under existing skills
// instead. Paths are relative to the repo root; the CLI prepends the raw.gh URL.
function writeManifest(skills) {
  const manifest = {
    version: 1,
    ref: 'main',
    skills: skills.map(s => ({
      name: s.frontmatter.name,
      description: s.frontmatter.description,
      agents: {
        'claude-code': `dist/claude-code/${s.name}/SKILL.md`,
        cursor: `dist/cursor/${s.name}.mdc`,
      },
    })),
    bundles: {
      aider: 'dist/aider/CONVENTIONS.md',
      'agents-md': 'dist/AGENTS.md',
    },
  };
  writeFileSync(join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
}

function main() {
  rmSync(DIST_DIR, { recursive: true, force: true });
  mkdirSync(DIST_DIR, { recursive: true });
  const skills = loadSkills();
  if (skills.length === 0) {
    console.error('No skills found in', SKILLS_DIR);
    process.exit(1);
  }
  writeClaudeCode(skills);
  writeCursor(skills);
  writeAider(skills);
  writeAgentsMd(skills);
  writeManifest(skills);
  console.log(`Built ${skills.length} skills → dist/ + manifest.json`);
  for (const s of skills) console.log(`  - ${s.name}`);
}

main();
