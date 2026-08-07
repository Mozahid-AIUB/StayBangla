/**
 * Tests for the logic that sits under the pages — money formatting, dates,
 * seasons. Not the components: rendering React needs jsdom and a transform
 * chain for JSX, and nothing here has needed it yet.
 *
 * Matches packages/shared-types' setup rather than introducing a second test
 * runner into the repository. `.spec.ts` only, so a `.spec.tsx` added later
 * fails to run rather than half-running.
 */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/**/*.spec.ts"],
};
