module.exports = {
  testEnvironment: 'node',
  clearMocks: true,
  watchman: false,
  collectCoverageFrom: [
    'server.js',
    'routes/**/*.js',
    'models/**/*.js',
  ],
};
