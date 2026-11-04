import type { DecideContext, ExternalEffect, PrepareContext } from '@keelwerk/core';
import { describe, expectTypeOf, test } from 'vitest';
import type { exchangeCode } from './github/exchange-code.ts';
import type { GithubBase } from './github/github-base.ts';
import type { Performs } from './inline-before-load/performs.ts';

type OutputOf<E> = E extends ExternalEffect<infer O> ? O : never;

describe('what each form asks of the types', () => {
  test('the decide context has no perform; the prepare context has it', () => {
    expectTypeOf<DecideContext<GithubBase>>().not.toHaveProperty('perform');
    expectTypeOf<PrepareContext<GithubBase>>().toHaveProperty('perform');
  });

  test('the inline form adds the member through its own interface, not through the context', () => {
    expectTypeOf<DecideContext<GithubBase> & Performs>().toHaveProperty('perform');
    expectTypeOf<Performs['perform']>().toBeFunction();
  });

  test('the effect carries its output type into the outcome both forms see', () => {
    expectTypeOf<OutputOf<ReturnType<typeof exchangeCode>>>().toEqualTypeOf<{
      readonly accountLogin: string;
      readonly token: string;
      readonly scopes: string;
    }>();
  });

  test('prepared is the value prepare returns, and undefined without a prepare', () => {
    expectTypeOf<DecideContext<GithubBase>['prepared']>().toEqualTypeOf<undefined>();
    expectTypeOf<DecideContext<GithubBase, readonly [], 'a' | 'b'>['prepared']>().toEqualTypeOf<
      'a' | 'b'
    >();
  });
});
