import { AppNotServedError, coreApiVersions, defineApiVersions, defineApp } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import { conformanceApp, libraryApp } from '../../src/fixtures/index.ts';
import { withTestResolver } from '../../src/harness/with-test-resolver.ts';
import { boot, deploymentOf } from './support/runtime-kit.ts';

describe('the surface of the app core, which the operator socket serves', () => {
  test('with one served app it is that app at its own head', async () => {
    const runtime = await boot(deploymentOf('memory'));
    expect(runtime.surface('core').app).toBe('library');
  });

  test('with two served apps it is the core module alone and never throws', async () => {
    const runtime = await boot(
      deploymentOf('memory', {
        apps: [withTestResolver(libraryApp), withTestResolver(conformanceApp)],
      }),
    );
    const core = runtime.surface('core');
    expect(core.app).toBe('core');
    expect(core.actions.some((action) => action.ref === 'core.capabilities')).toBe(true);
    expect(core.actions.some((action) => action.ref.startsWith('library.'))).toBe(false);
    // The HTTP transport recognises an app that is not served by AppNotServedError; any other
    // failure of the surface answers 500 there.
    expect(() => runtime.surface('nobody')).toThrow(AppNotServedError);
    expect(() => runtime.surface('nobody')).toThrow(RangeError);
    expect(() => runtime.surface('nobody')).toThrow('The process does not serve app "nobody".');
    expect(() => runtime.registry('nobody')).toThrow(AppNotServedError);
  });

  test('with one served app whose calendar lacks the core dates it still serves a session of the core calendar', async () => {
    const dated = withTestResolver(
      defineApp({ id: 'dated', modules: [], api: defineApiVersions({ '2026-11-05': {} }) }),
    );
    const runtime = await boot(deploymentOf('memory', { apps: [dated] }));
    const coreDate = coreApiVersions.dates.at(-1) ?? '';
    expect(dated.api?.dates).not.toContain(coreDate);
    const atCore = runtime.surface('core', coreDate);
    expect(atCore.apiVersion).toBe(coreDate);
    expect(atCore.actions.some((action) => action.ref === 'core.backend.create')).toBe(true);
    expect(runtime.surface('core')).toBe(runtime.surface('core', '2026-11-05'));
    expect(runtime.surface('core', coreDate)).toBe(atCore);
    expect(() => runtime.surface('core', '2020-01-01')).toThrow(RangeError);
  });
});
