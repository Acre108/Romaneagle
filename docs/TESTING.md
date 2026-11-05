# Test programme

The default test command runs the complete regression suite:

```powershell
npm test
```

The suite covers:

- campaign progression and save persistence;
- three-mission Roman campaign order, sequential unlocking, deployment validity, mission dialogue coverage, and save progression;
- Mission One battlefield structure, legal formation placement, campaign routing, and deterministic reconstruction;
- Mission Two river/ford structure, legal bridgehead placement, deterministic reconstruction, and preservation of the prototype TEST SCENARIO;
- Mission Three fort/gate/road structure, legal finale placement, deterministic reconstruction, and test-map isolation;
- Mission One force, terrain, garrison, and Pict-identity invariants;
- grid movement, narrow-passage reordering, reordered Fall back, shared movement/combat confirmation previews, terrain capacity and overflow;
- deterministic formation AI selection, obstacle detours, ranged targeting, charges, and engaged combat execution;
- representative melee, formation-derived Pressure and Resistance, Attack/Armour/Defence, multi-HP models, model-size capacity, equipment abilities, morale-gated Battle retreats, gap-closing Battle contacts, complete file follow-through, formation-wide infantry and cavalry charges, routing, casualty, and battle-outcome behaviour;
- deterministic isometric projection, picking, and soldier-mark layout.

The browser smoke test plays the real game in your installed Chrome. It covers consecutive battles, input during the computer's turn, the reset confirmation, the debrief preview, and the sandbox deployment:

```powershell
npm run test:smoke
```

Use the smallest relevant area suite while developing:

```powershell
npm run test:campaign
npm run test:grid
```

Run the complete suite before completing a change:

```powershell
npm test
```

For a narrow fix, Vitest can still run one file or test name directly.
