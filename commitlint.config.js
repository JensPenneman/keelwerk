export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    // Advisory: warn (level 1) on unknown scopes, never block.
    'scope-enum': [
      1,
      'always',
      ['core', 'data', 'testing', 'biome-config', 'deps', 'ci', 'docs', 'release', 'main'],
    ],
  },
};
