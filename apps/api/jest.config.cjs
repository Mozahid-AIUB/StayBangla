module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: "src",
  testMatch: ["**/*.spec.ts"],
  collectCoverageFrom: ["**/*.ts", "!**/*.spec.ts", "!main.ts", "!**/*.module.ts"],
  coverageThreshold: {
    global: { branches: 70, functions: 70, lines: 70, statements: 70 },
  },
};
