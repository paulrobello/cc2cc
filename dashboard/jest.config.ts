import type { Config } from "jest";

const config: Config = {
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/tests/setup.ts"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: { jsx: "react-jsx" } }],
  },
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    // Map @cc2cc/shared to its TypeScript source for Jest
    "^@cc2cc/shared$": "<rootDir>/../packages/shared/src/index.ts",
    // Handle ESM .js extension imports in TypeScript source
    "^(\\.{1,2}/.*)\\.js$": "$1",
    // Stub ESM-only packages that can't be processed by ts-jest
    "^react-markdown$": "<rootDir>/tests/__mocks__/react-markdown.tsx",
    "^remark-gfm$": "<rootDir>/tests/__mocks__/remark-gfm.ts",
  },
  testMatch: ["**/*.test.tsx", "**/*.test.ts"],
  passWithNoTests: true,
};

export default config;
