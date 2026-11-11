import type { ActionRef, Row } from '@keelwerk/core';
import { describe, expectTypeOf, test } from 'vitest';
import type { Versioned } from './app.ts';
import type {
  Actions,
  App,
  Client,
  Entities,
  ActionRef as GeneratedActionRef,
  RowOf,
} from './keelwerk.generated.ts';

describe('the versioned fixture app', () => {
  test('is the roster module: the head names the field displayName', () => {
    expectTypeOf<Row<Versioned, 'roster.contact'>['displayName']>().toEqualTypeOf<string>();
    expectTypeOf<'roster.contact.create'>().toExtend<ActionRef<Versioned>>();
  });

  test('its generated file folds the same app type', () => {
    expectTypeOf<App>().toEqualTypeOf<Versioned>();
    expectTypeOf<GeneratedActionRef>().toExtend<string>();
    expectTypeOf<keyof Entities>().toExtend<string>();
    expectTypeOf<keyof Actions>().toExtend<string>();
    expectTypeOf<RowOf<'roster.contact'>>().toExtend<object>();
    expectTypeOf<Client>().toHaveProperty('invoke');
  });
});
