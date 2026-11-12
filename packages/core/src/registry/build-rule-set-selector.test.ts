import { describe, expect, test } from 'vitest';
import { addedRule, appOf, makeModule, shop, shopBase, widget } from '../../test/registry-kit.ts';
import { defineRule } from '../dsl/define-rule.ts';
import { buildRegistry } from './build-registry.ts';

function shopWith(selector: object, spec: object): ReturnType<typeof makeModule> {
  return makeModule(
    { id: 'shop', entities: { widget } },
    { policies: { frozen: defineRule(shopBase as never, selector as never, spec as never) } },
  );
}

describe('a rule over a selector (section 8.1)', () => {
  test('a selector rule becomes a rule entry with its selector subject and every action', () => {
    const registry = buildRegistry(
      appOf([
        shopWith(
          { kinds: ['command'] },
          { effect: 'deny', reason: 'Nothing is written while frozen.' },
        ),
      ]),
    );
    const entry = registry.rules.get('shop.frozen');
    expect(registry.problems).toEqual([]);
    expect(entry?.subject).toEqual({ kinds: ['command'] });
    expect(entry?.actions).toEqual(['*']);
    expect(entry?.effect).toBe('deny');
    expect(entry?.module).toBe('shop');
  });

  test('a selector names only the members it was given', () => {
    const registry = buildRegistry(
      appOf([shopWith({ transports: ['cli'] }, { effect: 'deny', reason: 'Not on the cli.' })]),
    );
    expect(registry.rules.get('shop.frozen')?.subject).toEqual({ transports: ['cli'] });
  });

  test('an allow over a selector is refused at compose, whatever built it', () => {
    const built = buildRegistry(
      appOf([shopWith({ kinds: ['command'] }, { effect: 'allow', principal: 'user' })]),
    );
    expect(built.problems.map((p) => [p.code, p.severity, p.ref])).toEqual([
      ['selectorRuleAllows', 'error', 'shop.frozen'],
    ]);
    const added = buildRegistry(
      appOf([shop], {
        policies: {
          add: [{ ...addedRule, id: 'app.everything', subject: { transports: ['imap'] } }],
        },
      }),
    );
    expect(added.problems.map((p) => [p.code, p.ref])).toEqual([
      ['selectorRuleAllows', 'app.everything'],
    ]);
  });

  test('a disabled allow over a selector grants nothing and is not refused', () => {
    const registry = buildRegistry(
      appOf([shopWith({ kinds: ['command'] }, { effect: 'allow' })], {
        policies: { disable: ['shop.frozen'] },
      }),
    );
    expect(registry.problems).toEqual([]);
  });
});
