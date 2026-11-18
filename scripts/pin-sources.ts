/** The values every hand-written copy follows, read from the root package.json and the two source Dockerfiles. */
export interface PinSources {
  readonly biome: string; // devDependencies['@biomejs/biome']
  readonly knip: string; // devDependencies.knip
  readonly nodeImage: string; // the FROM line of pins/node.Dockerfile, a full image reference
  readonly npm: string; // pins.npm
  readonly pnpm: string; // packageManager without 'pnpm@' and without a '+<hash>' suffix
  readonly postgresImage: string; // the FROM line of pins/postgres.Dockerfile, a full image reference
  readonly typescript: string; // devDependencies.typescript
  readonly typesNode: string; // devDependencies['@types/node']
  readonly vitest: string; // devDependencies.vitest
}
