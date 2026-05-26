module.exports = {
  testEnvironment: 'node',
  clearMocks: true,
  watchman: false,
  modulePathIgnorePatterns: ['<rootDir>/export_for_chatgpt/'],
  testPathIgnorePatterns: ['<rootDir>/export_for_chatgpt/'],
  collectCoverageFrom: [
    'server.js',
    'routes/**/*.js',
    'models/**/*.js',
  ],
};
