module.exports = {
  testEnvironment: 'node',
  clearMocks: true,
  watchman: false,
  // .claude/ holds Claude Code worktrees with stale copies of the tests.
  modulePathIgnorePatterns: ['<rootDir>/.claude/'],
  testPathIgnorePatterns: ['<rootDir>/.claude/'],
  collectCoverageFrom: [
    'server.js',
    'routes/**/*.js',
    'models/**/*.js',
  ],
};
