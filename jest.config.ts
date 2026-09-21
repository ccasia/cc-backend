import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  setupFiles: ['<rootDir>/test/setup/noNetwork.ts'],
  testMatch: ['**/__tests__/**/*.+(ts|tsx|js)', '**/?(*.)+(spec|test).+(ts|tsx|js)'],
  transform: {
    // isolatedModules skips full type checking. Types are checked by
    // `yarn typecheck`; loading the generated Prisma client types in every
    // worker is far too slow and memory hungry to do here.
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      { tsconfig: '<rootDir>/tsconfig.jest.json', isolatedModules: true },
    ],
  },
  moduleNameMapper: {
    '^@controllers/(.*)$': '<rootDir>/src/controller/$1',
    '^@routes/(.*)$': '<rootDir>/src/routes/$1',
    '^@constants/(.*)$': '<rootDir>/src/constants/$1',
    '^@configs/(.*)$': '<rootDir>/src/config/$1',
    '^@middlewares/(.*)$': '<rootDir>/src/middleware/$1',
    '^@services/(.*)$': '<rootDir>/src/service/$1',
    '^@utils/(.*)$': '<rootDir>/src/utils/$1',
    '^@helper/(.*)$': '<rootDir>/src/helper/$1',
    '^@modules/(.*)$': '<rootDir>/src/modules/$1',
    '^@/(.*)$': '<rootDir>/$1',
  },
  clearMocks: true,
  maxWorkers: 2,
};

export default config;
