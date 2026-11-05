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
    expect(() => runtime.surface('nobody')).toThrow(RangeError);
  });
});
