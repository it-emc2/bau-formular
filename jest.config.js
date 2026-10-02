module.exports = {
  testEnvironment: 'node',
  clearMocks: true,
  watchman: false,
  // .claude/ holds Claude Code worktrees with stale copies of the tests.
  modulePathIgnorePatterns: ['<rootDir>/export_for_chatgpt/', '<rootDir>/.claude/'],
  testPathIgnorePatterns: ['<rootDir>/export_for_chatgpt/', '<rootDir>/.claude/'],
  collectCoverageFrom: [
    'server.js',
    'routes/**/*.js',
    'models/**/*.js',
  ],
};
