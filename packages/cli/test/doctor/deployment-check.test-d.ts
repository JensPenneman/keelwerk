import { expectTypeOf, test } from 'vitest';
import { defineCheck } from '../../src/doctor/define-check.ts';
import { checkOf, type DeploymentCheck, type Needs } from '../../src/doctor/deployment-check.ts';
import type {
  DeploymentFacts,
  FactValues,
  ProcessFact,
} from '../../src/doctor/deployment-facts.ts';
import { factsOf } from '../support/facts-of.ts';

test('a judge receives the plain values of the facts it named and nothing else', () => {
  defineCheck({
    group: 'g',
    name: 'n',
    needs: ['processes'],
    judge: (values) => {
      expectTypeOf(values.processes).toEqualTypeOf<readonly ProcessFact[]>();
      return [];
    },
  });
  defineCheck({
    group: 'g',
    name: 'n',
    needs: ['processes'],
    // @ts-expect-error a fact the check did not name is not there
    judge: (values) => (values.heldTenants.length > 0 ? [] : []),
  });
  defineCheck({
    group: 'g',
    name: 'n',
    needs: ['processes'],
    // @ts-expect-error the value is plain: it is no `Fact`
    judge: (values) => (values.processes.known ? [] : []),
  });
});

test('the facts of a deployment have no optional member', () => {
  const { heldTenants: _left, ...rest } = factsOf();
  // @ts-expect-error a facts object without a member does not compile
  const missing: DeploymentFacts = rest;
  expectTypeOf(missing).toEqualTypeOf<DeploymentFacts>();
});

test('only the constructors make a check', () => {
  // @ts-expect-error an object literal is no check: its judge could read any fact
  const literal: DeploymentCheck = {
    kind: 'judged',
    group: 'g',
    name: 'n',
    needs: ['processes'],
    applies: undefined,
    judge: () => [],
  };
  expectTypeOf(literal).toEqualTypeOf<DeploymentCheck>();
});

test('a needs list that is not a tuple literal is refused', () => {
  const wide = (needs: Needs): DeploymentCheck =>
    defineCheck({
      group: 'g',
      name: 'n',
      // @ts-expect-error the wide list would let the judge read every fact
      needs,
      judge: () => [],
    });
  expectTypeOf(wide).returns.toEqualTypeOf<DeploymentCheck>();
});

test('a needs list with a union element is refused', () => {
  const union = (need: keyof FactValues): DeploymentCheck =>
    defineCheck({
      group: 'g',
      name: 'n',
      // @ts-expect-error the element could be any fact, so the judge would be handed all of them
      needs: [need],
      judge: () => [],
    });
  expectTypeOf(union).returns.toEqualTypeOf<DeploymentCheck>();
});

test('a needs list that is a union of tuples is refused, as inferred and as a type argument', () => {
  const inferred = (both: boolean): DeploymentCheck =>
    defineCheck({
      group: 'g',
      name: 'n',
      // @ts-expect-error the list could be either tuple, so the judge would be handed the facts of both
      needs: both ? ['processes', 'heldTenants'] : ['processes'],
      judge: () => [],
    });
  const explicit = (): DeploymentCheck =>
    defineCheck<readonly ['processes'] | readonly ['processes', 'heldTenants']>({
      group: 'g',
      name: 'n',
      // @ts-expect-error a union of tuples is refused as an explicit type argument too
      needs: ['processes'],
      judge: () => [],
    });
  expectTypeOf(inferred).returns.toEqualTypeOf<DeploymentCheck>();
  expectTypeOf(explicit).returns.toEqualTypeOf<DeploymentCheck>();
});

test('checkOf takes a judge that reads no more than the facts it names', () => {
  const stray = (): DeploymentCheck =>
    checkOf({
      kind: 'judged',
      group: 'g',
      name: 'n',
      needs: ['processes'],
      applies: undefined,
      // @ts-expect-error the judge reads a fact the check did not name
      judge: (values: Pick<FactValues, 'masterKey'>) => (values.masterKey.declared ? [] : []),
    });
  expectTypeOf(stray).returns.toEqualTypeOf<DeploymentCheck>();
});
