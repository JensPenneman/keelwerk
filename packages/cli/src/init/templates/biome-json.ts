/** `biome.json`: the framework's preset, which carries the rules and the plugins (section 13.9). */
export function biomeJson(): unknown {
  return {
    $schema: './node_modules/@biomejs/biome/configuration_schema.json',
    vcs: { enabled: true, clientKind: 'git', useIgnoreFile: true },
    extends: ['@keelwerk/biome-config/biome'],
    files: { includes: ['**', '!**/dist', '!**/generated', '!**/pnpm-lock.yaml'] },
  };
}
