# Project purpose

This repository contains a turn-based grid formation tactics game set in Britain around AD 400, called The Last Eagle. Players and the computer alternate activating formations, and a short Roman campaign links the battles.

The project is a gameplay prototype, not a production game. Its current purpose is to test whether commanding dense formations of tiny soldiers is legible and satisfying.

## Working priorities

In order:

1. Playability.
2. Formation behaviour.
3. Visual clarity.
4. Performance.
5. Simple maintainable code.
6. Historical flavour.
7. Polish.

Do not prioritise visual ornament over readable gameplay.

## Simulation rules

- Formations and their blocks are the primary simulation entities.
- Individual soldiers are subordinate visual occupants of blocks.
- Do not introduce independent soldier pathfinding or tactical AI.
- Prefer unit-level calculations over soldier-level calculations.
- Gameplay systems should remain deterministic where practical.
- Keep combat abstract until the formation game is proven.
- All battle state changes go through `executeCommand`. `planOrder` and AI planning must not mutate the state they are given.

## Technical constraints

- TypeScript strict mode must remain enabled.
- Use PixiJS for battlefield rendering, and import it only from `src/gridBattle/rendering/`.
- UI may use ordinary HTML and CSS.
- Do not add production dependencies without explaining why.
- Avoid allocations in hot update and render loops.
- Do not couple simulation state to rendering state unnecessarily.
- Keep game logic testable without requiring the browser canvas.

## Scope rules

The game already has a campaign, characters, a browser-local campaign save and a local map editor. Extend them only when explicitly requested.

Do not add inventory, multiplayer, backend or cloud-save systems unless explicitly requested.

When asked for a feature that expands scope:

1. State the smallest implementation that tests the idea.
2. Implement that version.
3. Record omitted extensions in documentation rather than building them.

## Quality checks

Before completing a task, run:

- npm run typecheck
- npm run lint
- npm run test
- npm run build
- npm run test:smoke, when the change affects visible or interactive behaviour

Also manually launch the game when the change affects visible or interactive behaviour.

## Completion reports

Summaries must distinguish:

- Implemented and verified.
- Implemented but not manually verified.
- Planned but not implemented.
- Known defects.

Never say all acceptance criteria pass unless each has been checked.
