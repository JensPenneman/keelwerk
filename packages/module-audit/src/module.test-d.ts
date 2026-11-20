import { defineApp, defineReaction, type ObservedEvent } from '@keelwerk/core';
import type { ExpectValidApp, HasEntity } from '@keelwerk/testing/types';
import { describe, expectTypeOf, test } from 'vitest';
import { auditBase } from './base.ts';
import { type Audit, audit } from './module.generated.ts';

describe('the audit manifest', () => {
  test('is the module audit', () => {
    expectTypeOf<Audit['id']>().toEqualTypeOf<'audit'>();
  });

  test('audit composes alone and the reaction event is an ObservedEvent', () => {
    const alone = defineApp({ id: 'alone', modules: [audit] as const });
    expectTypeOf<ExpectValidApp<typeof alone>>().toEqualTypeOf<true>();
    expectTypeOf<HasEntity<typeof alone, 'audit.entry'>>().toEqualTypeOf<true>();
    defineReaction(auditBase, {
      on: 'all',
      react: (event) => {
        expectTypeOf(event).toEqualTypeOf<ObservedEvent>();
        return { events: [] };
      },
    });
  });
});
