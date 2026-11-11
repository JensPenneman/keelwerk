import type { MountContext } from '@keelwerk/core';
import { versionProjection } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { perVersionMount } from '../src/per-version-mount.ts';
import type { RestConfig } from '../src/rest-config.ts';
import { librarySurface } from './support/library-surface.ts';
import { action, none } from './support/nodes.ts';
import { withActions } from './support/with-actions.ts';

const broken = withActions(
  librarySurface,
  action('library.bookSearch', { mount: 'module', kind: 'query', input: none, output: none }),
);
const artifacts = () => [];

describe('perVersionMount checks every version at mount', () => {
  test('a refused older surface fails at once, not at its first request', () => {
    const surfaces = versionProjection(['2026-10-01', '2026-11-01'], (version) =>
      version === '2026-10-01' ? { ...broken, apiVersion: version } : librarySurface,
    );
    const ctx = { surface: librarySurface, surfaces } as unknown as MountContext<RestConfig>;
    expect(() => perVersionMount(ctx, {}, artifacts)).toThrow(
      /^nameCollision: .*\(API version 2026-10-01\)/,
    );
  });

  test('clean surfaces mount, and a context without surfaces serves its one surface', () => {
    const surfaces = versionProjection(['2026-10-01', '2026-11-01'], () => librarySurface);
    const mounts = perVersionMount(
      { surface: librarySurface, surfaces } as unknown as MountContext<RestConfig>,
      {},
      artifacts,
    );
    expect(mounts.versions).toEqual(['2026-10-01', '2026-11-01']);
    const single = perVersionMount(
      { surface: librarySurface } as unknown as MountContext<RestConfig>,
      {},
      artifacts,
    );
    expect(single.at('2026-10-01')).toBe(single.at('2026-11-01'));
  });
});
