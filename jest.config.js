module.exports = {
  testMatch: ['<rootDir>/tests/**/*.test.js'],
  transform: {
    '\\.js$': ['babel-jest', { plugins: ['@babel/plugin-transform-modules-commonjs'] }],
  },
  transformIgnorePatterns: ['/node_modules/'],
  moduleNameMapper: {
    '\\$:/core/modules/utils/diff-match-patch/diff_match_patch\\.js': '<rootDir>/tests/dmp-shim.js',
  },
  setupFiles: ['<rootDir>/tests/setup.js'],
  collectCoverageFrom: [
    'plugins/mblackman/revision-history/src/**/*.js',
  ],
  coverageDirectory: 'coverage',
};
