import { describe, expect, test } from 'vitest';
import { appOf, contributionTo, makeModule, shop } from '../../test/registry-kit.ts';
import { core } from '../core-module/module.ts';
import { defineRule } from '../dsl/define-rule.ts';
import type { AnyModule } from '../model/any-module.ts';
import { buildRegistry } from './build-registry.ts';

const coreModule = core as unknown as AnyModule;
const toolsBase = (module: AnyModule): object => (module as unknown as { base: object }).base;

function ruleOn(base: object, target: unknown): object {
  return defineRule(
    base as never,
    target as never,
    { effect: 'allow', principal: 'user' } as never,
  );
}

/** A module whose contribution to `to` mounts `policies`, and the registry problems it causes. */
function problemsOf(to: AnyModule, policies: (base: object) => object): readonly string[] {
  const base = {
    id: 'tools',
    requires: to === coreModule ? [] : [shop],
    contributions: { toTarget: contributionTo(to, {}) },
  };
  const probe = makeModule(base);
  const tools = makeModule(base, {
    contributes: { toTarget: { policies: policies(toolsBase(probe)) } },
  });
  return buildRegistry(appOf(to === coreModule ? [tools] : [shop, tools])).problems.map(
    (problem) => `${problem.code}:${problem.ref ?? ''}`,
  );
}

describe('a contribution to the core mounts a rule on core.eraseSubject only (8.7, decision A)', () => {
  const eraseSubject = (): unknown => core.actions.eraseSubject;

  test('a rule under eraseSubject in a contribution to the core composes', () => {
    const base = { id: 'tools', contributions: { toCore: contributionTo(coreModule, {}) } };
    const probe = makeModule(base);
    const tools = makeModule(base, {
      contributes: {
        toCore: {
          policies: {
            eraseSubject: { selfErase: ruleOn(toolsBase(probe), eraseSubject()) },
          },
        },
      },
    });
    const registry = buildRegistry(appOf([tools]));
    expect(registry.problems.filter((problem) => problem.severity === 'error')).toEqual([]);
    const rule = registry.rules.get('tools.core.eraseSubject.selfErase');
    expect(rule).toMatchObject({
      module: 'tools',
      contributedBy: 'tools',
      subject: { module: 'core' },
      actions: ['eraseSubject'],
    });
  });

  test('a rule on another core action is unknownPolicyTargets, contributed or not', () => {
    expect(
      problemsOf(coreModule, (base) => ({
        introspect: { open: ruleOn(base, core.actions.introspect) },
      })),
    ).toContain('unknownPolicyTargets:introspect.open');
  });

  test('a top-level rule on core.eraseSubject is unknownPolicyTargets', () => {
    const tools = makeModule(
      { id: 'tools' },
      {
        policies: {
          eraseSubject: {
            selfErase: ruleOn(toolsBase(makeModule({ id: 'tools' })), eraseSubject()),
          },
        },
      },
    );
    expect(
      buildRegistry(appOf([tools])).problems.map((problem) => `${problem.code}:${problem.ref}`),
    ).toContain('unknownPolicyTargets:eraseSubject.selfErase');
  });

  test('a rule on core.eraseSubject under another key is unknownPolicyTargets', () => {
    expect(
      problemsOf(coreModule, (base) => ({ erase: { selfErase: ruleOn(base, eraseSubject()) } })),
    ).toContain('unknownPolicyTargets:erase.selfErase');
  });

  test('a contribution to another module cannot mount a rule on core.eraseSubject', () => {
    expect(
      problemsOf(shop, (base) => ({
        eraseSubject: { selfErase: ruleOn(base, eraseSubject()) },
      })),
    ).toContain('unknownPolicyTargets:eraseSubject.selfErase');
  });
});
