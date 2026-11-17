import { deriveSurface } from '@keelwerk/core';
import { describe, expect, it } from 'vitest';
import { createGraphqlAdapter } from '../src/create-graphql-adapter.ts';
import { buildGraphqlSchema } from '../src/schema/build-graphql-schema.ts';
import { graphqlSdlOf } from '../src/sdl/graphql-sdl-of.ts';
import {
  graphqlConformanceApp,
  graphqlConformanceVersions,
} from './support/graphql-conformance-app.ts';

const surfaceAt = (version: string) =>
  deriveSurface(graphqlConformanceApp as never, version).surface;

// Regenerate the committed files with: pnpm vitest run --project transport-graphql test/sdl.test.ts -u
describe('the committed SDL', () => {
  for (const version of Object.values(graphqlConformanceVersions)) {
    it(`the printed schema of API version ${version} equals the committed SDL`, async () => {
      const sdl = graphqlSdlOf(buildGraphqlSchema(surfaceAt(version)));
      await expect(sdl).toMatchFileSnapshot(
        `./generated/graphql/graphql-conformance/${version}.graphql`,
      );
    });
  }

  it('the adapter writes the SDL at generated/graphql/<app>/<version>.graphql with the printed schema as content', () => {
    const surface = surfaceAt(graphqlConformanceVersions.head);
    const [artifact, ...rest] = createGraphqlAdapter().artifacts(surface);
    expect(rest).toEqual([]);
    expect(artifact).toEqual({
      kind: 'file',
      path: `generated/graphql/graphql-conformance/${graphqlConformanceVersions.head}.graphql`,
      contentType: 'application/graphql',
      content: graphqlSdlOf(buildGraphqlSchema(surface)),
    });
  });

  it('is sorted, ends with one newline and declares the keelwerk scalars and the subscription types', () => {
    const sdl = graphqlSdlOf(buildGraphqlSchema(surfaceAt(graphqlConformanceVersions.head)));
    expect(sdl.endsWith('\n')).toBe(true);
    expect(sdl.endsWith('\n\n')).toBe(false);
    expect(sdl).not.toContain('\r');
    for (const name of ['Instant', 'LocalDate', 'SafeInt', 'JSON', 'StreamHead', 'Subscription']) {
      expect(sdl).toMatch(new RegExp(`^(scalar|type) ${name}\\b`, 'm'));
    }
  });
});
