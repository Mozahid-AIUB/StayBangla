module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "src",
  testMatch: ["**/*.spec.ts"],
  // Excludes are thin wiring/adapters with no branching logic of their own —
  // fully exercised by e2e tests (test/*.e2e-spec.ts), not unit tests.
  collectCoverageFrom: [
    "**/*.ts",
    "!**/*.spec.ts",
    "!main.ts",
    "!**/*.module.ts",
    "!bootstrap/configure-app.ts",
    "!health/health.controller.ts",
    "!prisma/prisma.service.ts",
    "!common/redis/redis.service.ts",
    "!**/*.port.ts",
  ],
  coverageThreshold: {
    global: { branches: 80, functions: 80, lines: 80, statements: 80 },
  },
};
