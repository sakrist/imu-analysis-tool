# Agent Guidelines

This repo is a prototype, but the code should still be clean, structured, and easy to maintain.

The goal is not premature enterprise complexity. The goal is code that is easy to read, easy to change, and safe to build on when the prototype grows into a product.

## Core Principles

- Prefer simple designs with clear boundaries.
- Optimize for readability and maintainability over cleverness.
- Keep behavior stable unless the task explicitly changes product behavior.
- Make small, focused changes that are easy to review.
- Prototype quality is acceptable for UX polish and iteration speed, but not for sloppy architecture or unclear code.

## Stack Expectations

- TypeScript should stay strict. Avoid `any`, broad casts, and hidden null assumptions.
- React code should use modern function components and hooks.
- Vite is the default build/runtime environment. Do not add framework-level complexity without a strong reason.
- Keep browser-side code lightweight and understandable.

## Architecture

- Keep `App.tsx` as orchestration, not as the home for every piece of business logic.
- Put reusable domain logic in `src/lib`.
- Put reusable UI pieces in `src/components`.
- Put reusable React behavior in `src/hooks`.
- Extract logic when a component starts mixing rendering, state transitions, parsing, metrics, and event wiring in one place.
- Prefer pure helper functions for calculation-heavy code.

## React Guidelines

- Keep components focused on rendering and user interaction.
- Derive display state from source state where possible instead of duplicating state.
- Use `useMemo` and `useCallback` only when they help readability or avoid meaningful work; do not wrap everything by default.
- Keep effects narrow and intentional. Effects should synchronize with external systems, not replace normal data flow.
- Avoid large JSX blocks with embedded business rules. Move transformation logic above the return or into helpers.
- Prefer explicit prop names over ambiguous shorthand.

## State Management

- Keep state close to where it is used, but lift it when multiple areas genuinely depend on it.
- Separate raw data, derived data, and UI state.
- Avoid storing values that can be derived cheaply from existing state.
- Name state by meaning, not by implementation detail.

## TypeScript Guidelines

- Model domain concepts with explicit types.
- Prefer narrow unions and descriptive type aliases over loose primitives when meaning matters.
- Keep function signatures small and specific.
- If a return shape becomes non-trivial, introduce a named type.
- Make invalid states hard to represent.

## File and Function Design

- Functions should do one job and read in logical order.
- For calculation pipelines, structure code by stages:
  input normalization, signal extraction, detection, derived metrics, formatting/output.
- Keep helper functions near the logic they support unless they are reused across modules.
- Use descriptive names that reflect domain meaning, not temporary implementation thinking.
- Comments should explain non-obvious intent or assumptions, not restate the code.

## UI and Styling

- Preserve the current visual language unless a task explicitly asks for redesign.
- Favor clear hierarchy and legible labels over decorative UI.
- Avoid container-inside-container layouts unless the nesting adds real meaning.
- Prefer semantic HTML when it improves accessibility and structure.
- User-facing metric names should be understandable without engineering knowledge.

## Metrics and Domain Logic

- Separate player-facing terminology from sensor-level terminology.
- Be careful not to overclaim physics or biomechanics from proxy metrics.
- If a metric is an estimate or proxy, label it clearly.
- Threshold-based filtering should be easy to find and easy to tune.
- Keep metric computation deterministic and side-effect free.

## Prototype-Specific Rules

- It is acceptable to defer full abstraction if the logic is still changing quickly.
- It is not acceptable to leave behind confusing control flow, unclear naming, or dead code.
- When adding temporary heuristics, keep them centralized and document the intent.
- If a shortcut is taken because this is a prototype, make the tradeoff explicit in code comments or follow-up notes when useful.

## Validation

- Minimum validation for meaningful code changes:
  - `npm run lint`
  - `npm run build`
- If a change is not validated, call that out clearly.

## Change Style

- Prefer incremental refactors over large rewrites unless the code is actively blocking progress.
- Do not mix unrelated cleanup into feature work unless it directly improves the touched area.
- When refactoring, preserve behavior first, then improve structure.
- Keep public names stable unless renaming materially improves clarity.

## Documentation

- Keep docs concise and practical.
- Document behaviors, assumptions, thresholds, and integration expectations.
- Avoid generic architecture essays.

## Good Outcomes

Good changes in this repo usually have these qualities:

- The next person can find the logic quickly.
- Metrics and UI labels match product meaning.
- Calculation code reads top-to-bottom without mental backtracking.
- Components are easier to scan after the change than before it.
- The app still builds cleanly.
