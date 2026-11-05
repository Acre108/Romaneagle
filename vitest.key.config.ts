import { defineConfig } from "vite";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/tests/abilities.test.ts",
      "src/tests/ammunitionSystem.test.ts",
      "src/tests/campaignCatalog.test.ts",
      "src/tests/campaignProgress.test.ts",
      "src/tests/formationPathfinding.test.ts",
      "src/tests/formationTerrain.test.ts",
      "src/tests/hadriansWallScenario.test.ts",
      "src/tests/isometricProjection.test.ts",
      "src/tests/movementControl.test.ts",
      "src/tests/simulation.test.ts",
      "src/tests/specialistBalance.test.ts",
      "src/tests/testScenario.test.ts",
      "src/tests/unitStatus.test.ts",
      "src/tests/unitArchetypes.test.ts",
    ],
    testNamePattern: /\[key\]/,
  },
});
