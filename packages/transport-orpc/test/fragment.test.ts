import { describe, expect, test } from 'vitest';
import { createOrpcAdapter } from '../src/create-orpc-adapter.ts';

const surface = {} as never;

describe('the type fragment', () => {
  test('artifacts are the one type fragment, per serializer', () => {
    expect(createOrpcAdapter().artifacts(surface)).toEqual([
      {
        kind: 'type-fragment',
        module: '@keelwerk/transport-orpc',
        names: ['OrpcRouterOf'],
        content: 'export type OrpcRouter = OrpcRouterOf<App>',
      },
    ]);
    expect(createOrpcAdapter({ serializer: 'orpc' }).artifacts(surface)).toEqual(
      createOrpcAdapter().artifacts(surface),
    );
    expect(createOrpcAdapter({ serializer: 'json' }).artifacts(surface)).toEqual([
      {
        kind: 'type-fragment',
        module: '@keelwerk/transport-orpc',
        names: ['OrpcRouterOf'],
        content: "export type OrpcRouter = OrpcRouterOf<App, 'json'>",
      },
    ]);
  });

  test('one line under 100 characters, no semicolon', () => {
    for (const serializer of ['orpc', 'json'] as const) {
      for (const artifact of createOrpcAdapter({ serializer }).artifacts(surface)) {
        if (artifact.kind !== 'type-fragment') throw new Error('Expected a type fragment.');
        expect(artifact.content).not.toContain('\n');
        expect(artifact.content.length).toBeLessThan(100);
        expect(artifact.content).not.toContain(';');
        expect(artifact.content).not.toMatch(/\/\/|\/\*/);
      }
    }
  });
});
