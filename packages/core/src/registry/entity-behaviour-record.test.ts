import { describe, expect, test } from 'vitest';
import { accounts } from '../../test/fixtures/modules/accounts/src/module.generated.ts';
import { auth } from '../../test/fixtures/modules/auth/src/module.generated.ts';
import { hooks } from '../../test/fixtures/modules/hooks/src/module.generated.ts';
import { teams } from '../../test/fixtures/modules/teams/src/module.generated.ts';
import { defineApp } from '../dsl/define-app.ts';
import { registryBehaviours } from '../write-path/registry-behaviours.ts';
import { buildRegistry } from './build-registry.ts';

const fullApp = defineApp({ id: 'full', modules: [accounts, teams, auth, hooks] });
const registry = buildRegistry(fullApp);

describe('what the registry records on an entity (F-10 change note, WP-43)', () => {
  test('fieldTracks names the track of every field: the owner own, a contribution its own', () => {
    const profile = registry.entities.get('accounts.profile');
    expect(profile?.fieldTracks).toMatchObject({
      displayName: 'accounts',
      email: 'accounts',
      deactivatedAt: 'accounts',
    });
    const contributed = Object.entries(profile?.fieldTracks ?? {}).filter(
      ([, track]) => track !== 'accounts',
    );
    expect(contributed.length).toBeGreaterThan(0);
    for (const [field, track] of contributed) {
      const contributor = profile?.origin[field];
      expect(track).toContain(String(contributor));
    }
    expect(Object.keys(profile?.fieldTracks ?? {}).sort()).toEqual(
      Object.keys(profile?.descriptor.fields ?? {})
        .filter((name) => profile?.fieldTracks?.[name] !== undefined)
        .sort(),
    );
  });

  test('behaviour carries the author evolve and the defaults of every active source', () => {
    const profile = registry.entities.get('accounts.profile');
    expect(Object.keys(profile?.behaviour?.evolve ?? {})).toEqual(['deactivated']);
    expect(profile?.behaviour?.invariant).toBeNull();
    const tenant = registry.entities.get('core.tenant');
    expect(tenant?.behaviour?.defaults).toEqual({ status: 'active' });
  });

  test('registryBehaviours reads them by entity reference', () => {
    const behaviours = registryBehaviours(registry);
    expect(behaviours('core.backend')?.defaults).toEqual({ status: 'active' });
    expect(behaviours('nope.nothing')).toBeUndefined();
  });
});
