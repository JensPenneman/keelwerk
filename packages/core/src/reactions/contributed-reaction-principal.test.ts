import { describe, expect, test } from 'vitest';
import { noteEvent } from '../../test/reaction-kit.ts';
import {
  appOf,
  command,
  contributionTo,
  makeModule,
  shop,
  shopBase,
  widget,
} from '../../test/registry-kit.ts';
import { effectiveRules } from '../authorization/effective-rules.ts';
import { normalizeRule } from '../authorization/normalize-rule.ts';
import type { NormalizedRule } from '../authorization/normalized-rule.ts';
import { defineReaction } from '../dsl/define-reaction.ts';
import { authorizeInvoke } from '../effects/authorize-invoke.ts';
import { buildRegistry } from '../registry/build-registry.ts';
import { moduleServicePrincipal } from './module-service-principal.ts';
import { reactionJob } from './reaction-job.ts';
import { reactionJobAction } from './reaction-job-action.ts';

const noted = defineReaction(
  shopBase as never,
  { on: 'shop.widget.created', react: () => ({ events: [] }) } as never,
);
// `extra` contributes a reaction to the namespace module `shop`, and has an action of its own.
const extra = makeModule(
  { id: 'extra', requires: [shop], contributions: { toShop: contributionTo(shop, {}) } },
  { actions: { own: command() }, contributes: { toShop: { reactions: { noted } } } },
);
const shopWithAction = makeModule(
  { id: 'shop', entities: { widget } },
  { actions: { act: command() } },
);
const registry = buildRegistry(appOf([shopWithAction, extra]));
const scope = {
  level: 'tenant',
  backendId: '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a01',
  tenantId: '0197a1c2-7b3e-7c11-9a55-3f2e8d6b4a02',
} as const;

/** The job of the contributed reaction `shop.noted`, as the dispatcher builds it. */
const job = reactionJob({
  reaction: registry.reactions.get('shop.noted') as never,
  event: noteEvent({ scope: scope as never }),
  declaredKey: undefined,
  build: { id: 'build-1', revision: 1 },
  now: Temporal.Instant.from('2026-03-01T08:00:01Z'),
});
/** The principal the job carries, minted as the worker mints it from the job's reference. */
const jobPrincipal = moduleServicePrincipal(job.principal.principalId.replace(/\.system$/, ''), {
  scope: { backend: null, tenant: null },
});

/** One ordinary rule: the service principals may run the module-level action `shop.act`. */
const grantsAct: NormalizedRule = normalizeRule({
  id: 'app.extraRunsAct',
  module: 'app',
  effect: 'allow',
  subject: { module: 'shop' },
  actions: ['act'],
  principal: 'service',
  when: (context) =>
    Reflect.get(Reflect.get(context as object, 'principal') as object, 'id') === 'extra.system',
  disabled: false,
});

function invoke(
  ref: string,
  principal: ReturnType<typeof moduleServicePrincipal>,
  caller: string,
  extraRules: readonly NormalizedRule[] = [],
) {
  const action = registry.actions.get(ref);
  if (action === undefined) throw new Error(`no action ${ref}`);
  authorizeInvoke({
    registry,
    rules: [...effectiveRules(registry), ...extraRules],
    action,
    principal,
    scope,
    input: {},
    caller,
  });
}

describe('the principal of a contributed reaction (the contributor, not the namespace module)', () => {
  const reaction = registry.reactions.get('shop.noted');

  test('the reaction is mounted under the namespace module and belongs to the contributor', () => {
    expect(reaction).toMatchObject({ id: 'shop.noted', module: 'extra', contributedBy: 'extra' });
  });

  test('its job carries the contributor as its principal, and the reaction itself passes the default rule', () => {
    expect(job.principal).toMatchObject({ principalId: 'extra.system' });
    expect(jobPrincipal.id).toBe('extra.system');
    expect(reactionJobAction(registry, 'shop.noted', scope, '2026-01-01')).toMatchObject({
      module: 'extra',
      ref: 'shop.noted',
    });
  });

  test("the contributor's own actions pass by the default rule, for the principal the job carries", () => {
    expect(() => invoke('extra.own', jobPrincipal, 'extra')).not.toThrow();
  });

  test('an action of the namespace module needs an ordinary rule and is refused without one', () => {
    expect(() => invoke('shop.act', jobPrincipal, 'extra')).toThrow(
      expect.objectContaining({ kind: 'forbidden', code: 'core.forbidden' }),
    );
  });

  test('an ordinary rule that allows the contributor to run the namespace action lets the job through', () => {
    expect(() => invoke('shop.act', jobPrincipal, 'extra', [grantsAct])).not.toThrow();
  });

  test("the namespace module's principal does not reach the contributor's actions either", () => {
    const principal = moduleServicePrincipal('shop', { scope: { backend: null, tenant: null } });
    expect(() => invoke('shop.act', principal, 'shop')).not.toThrow();
    expect(() => invoke('extra.own', principal, 'shop')).toThrow(
      expect.objectContaining({ kind: 'forbidden' }),
    );
  });
});
