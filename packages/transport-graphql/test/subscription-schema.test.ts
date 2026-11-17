import { deriveSurface } from '@keelwerk/core';
import { getNamedType, isObjectType, isUnionType } from 'graphql';
import { describe, expect, test } from 'vitest';
import { checkGraphqlSurface } from '../src/check/check-graphql-surface.ts';
import { actionTypeName } from '../src/schema/action-type-name.ts';
import { buildGraphqlSchema } from '../src/schema/build-graphql-schema.ts';
import { rootFieldName } from '../src/schema/root-field-name.ts';
import { isSubscribed } from '../src/subscriptions/is-subscribed.ts';
import {
  graphqlConformanceApp,
  graphqlConformanceVersions,
} from './support/graphql-conformance-app.ts';
import { findAction, surfaceWithAction, transportSurface } from './support/graphql-kit.ts';

const surface = deriveSurface(
  graphqlConformanceApp as never,
  graphqlConformanceVersions.head,
).surface;
const { schema } = buildGraphqlSchema(surface);
const subscribed = surface.actions.filter(isSubscribed);

describe('the Subscription root', () => {
  test('every subscription is a Subscription field answering <Name>Event!', () => {
    const fields = schema.getSubscriptionType()?.getFields() ?? {};
    expect(subscribed.length).toBeGreaterThan(5);
    for (const action of subscribed) {
      const field = fields[rootFieldName(action)];
      expect(field?.type.toString(), action.ref).toBe(`${actionTypeName(action)}Event!`);
      expect(
        field?.args.some((arg) => arg.name === 'after'),
        action.ref,
      ).toBe(true);
    }
    expect(Object.keys(fields)).toHaveLength(subscribed.length);
  });

  test('the event union is the item, StreamHead, StreamReset and StreamGap, and every item has state', () => {
    for (const action of subscribed) {
      const union = schema.getType(`${actionTypeName(action)}Event`);
      if (!isUnionType(union)) throw new Error(`${action.ref} has no event union`);
      const names = union.getTypes().map((member) => member.name);
      expect(names.sort(), action.ref).toEqual(
        [`${actionTypeName(action)}Item`, 'StreamGap', 'StreamHead', 'StreamReset'].sort(),
      );
      const item = union.getTypes().find((member) => member.name.endsWith('Item'));
      expect(item?.getFields().state?.type.toString(), action.ref).toBe('String');
    }
    const reset = schema.getType('StreamReset');
    if (!isObjectType(reset)) throw new Error('no StreamReset');
    expect(String(getNamedType(reset.getFields().reason?.type ?? reset))).toBe('StreamResetReason');
    const reasons = schema.getType('StreamResetReason');
    expect(reasons && 'getValues' in reasons ? reasons.getValues().map((v) => v.name) : []).toEqual(
      ['OVERFLOW', 'EXPIRED', 'RESYNC'],
    );
  });

  test('a subscription whose event is no shape is unsupported', () => {
    const broken = surfaceWithAction(surface, { output: { kind: 'void' } }, 'loans.loanEvents');
    const problems = checkGraphqlSurface(broken);
    expect(problems).toMatchObject([{ code: 'unsupportedShape', subject: 'loans.loanEvents' }]);
    expect(problems[0]?.message).toBe(
      'A subscription event must be a shape to join its event union.',
    );
  });

  test('an input member named after gives way to the resume argument', () => {
    const watch = subscribed.find((action) => rootFieldName(action) === 'loansLoanWatch');
    if (watch?.input.kind !== 'shape') throw new Error('the watch takes a shape');
    expect(Object.keys(watch.input.fields)).toContain('after');
    const field = schema.getSubscriptionType()?.getFields().loansLoanWatch;
    const afters = field?.args.filter((arg) => arg.name === 'after') ?? [];
    expect(afters).toHaveLength(1);
    expect(afters[0]?.description).toBe('The state of an item or a head to resume after.');
    expect(String(afters[0]?.type)).toBe('String');
  });

  test('a module type named StreamHead is a nameCollision', () => {
    // `loans.lend` with the type name `Stream` and an enum member `head` makes the input enum `StreamHead`.
    const base = surface;
    const lend = findAction(base, 'loans.lend');
    if (lend.input.kind !== 'shape') throw new Error('lend takes a shape');
    const input = {
      ...lend.input,
      fields: {
        ...lend.input.fields,
        head: { kind: 'enum', values: ['a', 'b'], optional: true, access: 'read-write' },
      },
    };
    const clashing = surfaceWithAction(
      base,
      { input, hints: { graphql: { type: 'Stream' } } },
      'loans.lend',
    );
    expect(checkGraphqlSurface(clashing)).toMatchObject([
      { code: 'nameCollision', subject: 'loans.lend' },
    ]);
  });

  test('a schema without subscriptions has no Subscription root and no stream types', () => {
    // Every app has the status watch of the core module: without any subscription the root goes.
    const whole = transportSurface();
    const plain = buildGraphqlSchema({
      ...whole,
      actions: whole.actions.filter((action) => !isSubscribed(action)),
    }).schema;
    expect(plain.getSubscriptionType()).toBeUndefined();
    for (const name of [
      'Subscription',
      'StreamHead',
      'StreamReset',
      'StreamGap',
      'StreamResetReason',
    ]) {
      expect(plain.getType(name), name).toBeUndefined();
    }
  });
});
