# AGENTS.md — Operational Directives for Hourglass

Welcome to the **Hourglass** workspace. This document establishes core standards, behavioral rules, and architectural guidelines that all AI agents (including Google Antigravity and automated assistants) must adhere to when operating in this codebase.

---

## 1. Core Operating Principles

1. **Verify Before and After**:
   - Inspect existing files and structure before proposing or writing code.
   - Always run linting, type-checking, or tests after making modifications.
2. **Minimal & Surgical Changes**:
   - Do not perform broad, unnecessary refactors when addressing targeted requests.
   - Preserve existing comments, docstrings, and established code patterns unless explicitly directed.
3. **No Unverified Assumptions**:
   - Verify environment dependencies, runtime commands, and library versions before executing commands or updating configurations.
4. **Documentation Integrity**:
   - Keep `README.md` and related docs updated whenever project structure or commands change.

---

## 2. Workspace & File Organization

- **Specifications & Architecture**: Located under `.specify/` (see `constitution.md`, `spec.md`, and `plan.md`).
- **Customizations & Skills**: Kept under `.agents/` (e.g., `.agents/skills/<skill-name>/SKILL.md`).
- **Source Code**: Located in `src/`. Keep code modular, cohesive, and clearly separated by concern (components, state, utils, api).
- **Assets**: Static assets, icons, soundscapes, and public files belong in `public/` or `assets/`.
- **Tests**: Unit and integration tests reside in `tests/` or alongside source files as `*.test.*` / `*.spec.*`.

---

## 3. Coding Standards & Conventions

### Language & Modern Idioms
- Write clean, modern, and readable code. Use typed interfaces (e.g., TypeScript or modern type annotations) when applicable.
- Avoid deprecated APIs or fragile monkey-patching.

### UI & Styling Guidelines
- If creating web or desktop interfaces, prioritize visual excellence: modern typography, curated color palettes, accessible contrast ratios, and responsive layouts.
- Avoid generic browser default styling; ensure a polished, premium aesthetic.

### Error Handling & Resilience
- Gracefully handle asynchronous failures, network timeouts, and invalid user input.
- Avoid swallowing errors silently without actionable logging or user feedback.

---

## 4. Agent Tool Usage & Safety

- **Terminal Commands**: Keep command executions deterministic. Avoid interactive commands that block without timeout.
- **Destructive Actions**: Always confirm before deleting non-trivial directories or overwriting unversioned user assets.
- **Progressive Skill Loading**: Use skills under `.agents/skills/` for recurring multi-step workflows.

---

## 5. Verification Checklist

Before completing any task, verify:
- [ ] Code compiles/transpiles without syntax or type errors.
- [ ] Any newly introduced dependencies are declared in the project configuration.
- [ ] Changes do not break existing functionality or introduce regressions.
- [ ] Relevant documentation or skills have been updated if workflows changed.
