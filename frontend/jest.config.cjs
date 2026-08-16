module.exports = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.js'],
  modulePaths: ['<rootDir>/node_modules', '<rootDir>/../../node_modules'],
  moduleNameMapper: {
    '\\.(css|less|scss|sass)$': 'identity-obj-proxy'
  },
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': '@swc/jest'
  },
  testMatch: ['**/__tests__/**/*.test.[jt]s?(x)'],
  collectCoverageFrom: ['src/**/*.{js,jsx,ts,tsx}', '!src/main.jsx', '!**/node_modules/**']
};
