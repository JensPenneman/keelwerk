import { type AppType, type CommandReceipt, defineApp, type LiveFrame } from '@keelwerk/core';
import { type ConformanceApp, library, loans } from '@keelwerk/testing/fixtures';
import { describe, expectTypeOf, test } from 'vitest';
import type { LiveApp } from '../test/live-app.ts';
import type { AppClient } from './app-client.ts';
import type { DeclaredErrorOf } from './declared-error-of.ts';
import type { EffectReferences } from './effect-references.ts';
import type { EventOf } from './event-of.ts';
import type { InputOf } from './input-of.ts';
import type { InvokableRef } from './invokable-ref.ts';
import type { ResultOf } from './result-of.ts';
import type { SubscriptionRef } from './subscription-ref.ts';
import type { TaxonomyError } from './taxonomy-error.ts';

const eitherDef = defineApp({ id: 'either', modules: [library, loans] as const });
interface Either extends AppType<typeof eitherDef> {}

declare const conformance: AppClient<ConformanceApp>;
declare const live: AppClient<LiveApp>;
declare const either: AppClient<Either>;

describe('the derived client types', () => {
  test('InputOf is the in-process input', () => {
    expectTypeOf<InputOf<ConformanceApp, 'library.addBook'>>().toEqualTypeOf<{
      readonly title: string;
      readonly isbn: string;
    }>();
    expectTypeOf<InputOf<ConformanceApp, 'loans.lend'>>().toHaveProperty('dueAt');
    expectTypeOf<
      InputOf<ConformanceApp, 'loans.lend'>['dueAt']
    >().toEqualTypeOf<Temporal.Instant>();
  });

  test('ResultOf follows the execution mode and the preference', () => {
    // a query gives its output whatever the preference
    expectTypeOf<ResultOf<ConformanceApp, 'library.findByIsbn'>>().toHaveProperty('title');
    expectTypeOf<ResultOf<ConformanceApp, 'library.findByIsbn', 'async'>>().toEqualTypeOf<
      ResultOf<ConformanceApp, 'library.findByIsbn', 'sync'>
    >();
    // sync after the override
    expectTypeOf<
      ResultOf<ConformanceApp, 'loans.lend', 'async'>
    >().not.toEqualTypeOf<CommandReceipt>();
    // async whatever the caller prefers
    expectTypeOf<
      ResultOf<ConformanceApp, 'loans.closeAll', 'sync'>
    >().toEqualTypeOf<CommandReceipt>();
    expectTypeOf<
      ResultOf<ConformanceApp, 'loans.closeAll', 'async'>
    >().toEqualTypeOf<CommandReceipt>();
    // either: the caller's choice
    expectTypeOf<ResultOf<Either, 'loans.lend', 'async'>>().toEqualTypeOf<CommandReceipt>();
    expectTypeOf<ResultOf<Either, 'loans.lend', 'sync'>>().not.toEqualTypeOf<CommandReceipt>();
    expectTypeOf<ResultOf<Either, 'loans.lend', 'sync'>>().toHaveProperty('loanId');
    expectTypeOf<ResultOf<Either, 'loans.lend'>>().toEqualTypeOf<
      ResultOf<Either, 'loans.lend', 'sync'>
    >();
  });

  test('invoke types the result per call', async () => {
    const dueAt = Temporal.Instant.from('2030-01-01T00:00:00Z');
    const synced = await either.invoke('loans.lend', { bookTitle: 'x', dueAt });
    expectTypeOf(synced).toHaveProperty('loanId');
    const receipt = await either.invoke(
      'loans.lend',
      { bookTitle: 'x', dueAt },
      { prefer: 'async' },
    );
    expectTypeOf(receipt).toEqualTypeOf<CommandReceipt>();
    const closed = await conformance.invoke('loans.closeAll', { borrower: '' as never });
    expectTypeOf(closed).toEqualTypeOf<CommandReceipt>();
    // @ts-expect-error a string is not an instant
    await conformance.invoke('loans.lend', { bookTitle: 'x', dueAt: '2030-01-01T00:00:00Z' });
    // @ts-expect-error there is no such action
    await conformance.invoke('loans.nothing', {});
  });

  test('attempt types the declared errors of the action', async () => {
    type AddBookError = DeclaredErrorOf<ConformanceApp, 'library.addBook'>;
    expectTypeOf<AddBookError['code']>().toEqualTypeOf<'library.isbn_taken'>();
    expectTypeOf<AddBookError['details']>().toEqualTypeOf<{ readonly isbn: string }>();
    expectTypeOf<DeclaredErrorOf<ConformanceApp, 'library.findByIsbn'>>().toBeNever();
    const outcome = await conformance.attempt('library.addBook', { title: 't', isbn: 'i' });
    if (!outcome.ok) {
      expectTypeOf(outcome.error).toEqualTypeOf<AddBookError | TaxonomyError>();
      if (outcome.error.code === 'library.isbn_taken') {
        expectTypeOf(outcome.error.details).toEqualTypeOf<{ readonly isbn: string }>();
      }
    }
  });

  test('attempt and waitForEffects share the effect reference type', async () => {
    const outcome = await conformance.attempt('library.addBook', { title: 't', isbn: 'i' });
    if (outcome.ok) {
      expectTypeOf(outcome.commandId).toEqualTypeOf<string | undefined>();
      expectTypeOf(outcome.effects).toEqualTypeOf<EffectReferences | undefined>();
    }
    expectTypeOf<EffectReferences>().toEqualTypeOf<readonly string[]>();
    expectTypeOf(conformance.waitForEffects).parameter(0).toEqualTypeOf<EffectReferences>();
  });

  test('subscriptions are apart from invokable actions', () => {
    expectTypeOf<'loans.loanEvents'>().toExtend<SubscriptionRef<LiveApp>>();
    expectTypeOf<'loans.loanEvents'>().not.toExtend<InvokableRef<LiveApp>>();
    expectTypeOf<'loans.lend'>().toExtend<InvokableRef<LiveApp>>();
    expectTypeOf<'loans.lend'>().not.toExtend<SubscriptionRef<LiveApp>>();
    expectTypeOf<SubscriptionRef<ConformanceApp>>().toBeNever();
    expectTypeOf<EventOf<LiveApp, 'loans.loanEvents'>>().toHaveProperty('loanId');
    expectTypeOf(live.subscribe('loans.loanEvents', undefined as never)).toExtend<
      AsyncIterable<LiveFrame<EventOf<LiveApp, 'loans.loanEvents'>>>
    >();
    // @ts-expect-error a subscription is not invoked
    void live.invoke('loans.loanEvents', {});
    // @ts-expect-error a command is not subscribed to
    void live.subscribe('loans.lend', {});
  });

  test('as returns a client of the same app', () => {
    expectTypeOf(conformance.as({ tenant: 'acme' })).toEqualTypeOf<AppClient<ConformanceApp>>();
  });
});
