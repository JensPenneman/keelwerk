import { describe, expect, test } from 'vitest';
import { accounts } from '../../test/fixtures/modules/accounts/src/module.generated.ts';
import { auth } from '../../test/fixtures/modules/auth/src/module.generated.ts';
import { defineApp } from '../dsl/define-app.ts';
import { liveQueriesOf } from './live-queries-of.ts';

const { registry } = defineApp({ id: 'portal', modules: [accounts, auth] });

function queriesOf(module: string) {
  const entry = registry.modules.find((one) => one.id === module);
  if (entry === undefined) throw new Error(`no module ${module}`);
  return liveQueriesOf(registry, entry) as unknown as {
    entity(module: string, entity: string, options?: object): unknown;
  };
}

describe('ctx.live.entity at run time (15.4.11)', () => {
  test("accepts the module's own entities and those of its dependencies", () => {
    expect(queriesOf('auth').entity('auth', 'session')).toMatchObject({
      kind: 'liveSource',
      source: { kind: 'entity', entity: 'auth.session' },
    });
    expect(queriesOf('auth').entity('accounts', 'profile')).toMatchObject({
      source: { entity: 'accounts.profile' },
    });
  });

  test('refuses the entity of a module it does not depend on, and one the app lacks, as internal', () => {
    // accounts is required by auth, not the other way round.
    expect(() => queriesOf('accounts').entity('auth', 'session')).toThrow(
      expect.objectContaining({ kind: 'internal' }),
    );
    expect(() => queriesOf('auth').entity('auth', 'nothing')).toThrow(
      expect.objectContaining({ kind: 'internal' }),
    );
  });
});
