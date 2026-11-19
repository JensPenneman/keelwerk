import { readFileSync } from 'node:fs';
import { renderAppGeneratedFile } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { createTrpcAdapter } from '../src/create-trpc-adapter.ts';
import { trpcConformanceSurface } from './support/trpc-kit.ts';

const fragmentLine = 'export type TrpcRouter = TrpcRouterOf<App>';

describe('the type fragment of the router', () => {
  test('the adapter answers one fragment for the head', () => {
    expect(createTrpcAdapter().artifacts(trpcConformanceSurface())).toEqual([
      {
        kind: 'type-fragment',
        module: '@keelwerk/transport-trpc',
        names: ['TrpcRouterOf'],
        content: fragmentLine,
      },
    ]);
  });

  test('the json transformer writes TrpcRouterOf<App, false>', () => {
    expect(
      createTrpcAdapter({ transformer: 'json' }).artifacts(trpcConformanceSurface()),
    ).toMatchObject([{ content: 'export type TrpcRouter = TrpcRouterOf<App, false>' }]);
  });

  test('the rendered generated file carries the fragment line the committed support file declares', () => {
    const fragment = createTrpcAdapter().artifacts(trpcConformanceSurface())[0];
    if (fragment?.kind !== 'type-fragment') throw new Error('the adapter wrote no fragment');
    const rendered = renderAppGeneratedFile({
      appFile: './app.ts',
      appType: 'TrpcConformanceApp',
      apiVersion: '2026-11-11',
      hash: 'hash',
      fragments: [
        {
          module: fragment.module ?? '',
          names: fragment.names ?? [],
          declaration: fragment.content,
        },
      ],
    });
    expect(rendered).toContain("import type { TrpcRouterOf } from '@keelwerk/transport-trpc';");
    expect(rendered).toContain(`${fragmentLine};\n`);
    const committed = readFileSync(
      new URL('./support/trpc-conformance-router.ts', import.meta.url),
      'utf8',
    );
    expect(committed.trimEnd().split('\n').at(-1)).toBe(`${fragmentLine};`);
  });
});
