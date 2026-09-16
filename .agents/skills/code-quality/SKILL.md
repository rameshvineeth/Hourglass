---
name: code-quality
description: >-
  Use this skill when auditing code quality, running lint checks, formatting files,
  or refactoring code in the Hourglass project.
---

# Code Quality & Refactoring Skill

This skill defines rules and procedures for reviewing, linting, and ensuring high code standards across the **Hourglass** codebase.

## 1. Code Review Checklist

When reviewing or refactoring code:
- **Readability**: Are function and variable names descriptive and intent-revealing?
- **DRY (Don't Repeat Yourself)**: Are duplicated timer or state logic centralized into reusable utilities?
- **Error Boundaries**: Are asynchronous operations and potential exceptions caught with user-friendly handling?
- **Performance**: Are expensive computations or timer re-renders debounced / memoized?

---

## 2. Refactoring Guidelines

1. Ensure existing tests or verification procedures pass before refactoring.
2. Apply changes incrementally in small, focused edits rather than sweeping multi-file rewrites.
3. Keep public API surfaces and function signatures backwards-compatible unless a breaking change is explicitly requested.

---

## 3. Linting & Formatting Verification

- Check files for trailing whitespace, consistent indentation, and syntax consistency.
- Run project linters or formatters (`npm run lint` or `npx prettier --check .` if configured).
