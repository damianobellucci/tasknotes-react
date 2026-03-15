module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/tests/user-flows/**/*.test.ts?(x)'],
  setupFilesAfterEnv: ['<rootDir>/tests/user-flows/setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};
