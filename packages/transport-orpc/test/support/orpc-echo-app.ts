import {
  defineApiVersions,
  defineApp,
  defineCommand,
  defineEffect,
  defineEffectExecutor,
  defineModule,
  defineModuleBase,
  defineQuery,
  errors,
  field,
  type ModuleBaseType,
  type ModuleType,
  type StandardSchemaV1,
  shape,
} from '@keelwerk/core';
import { live } from '@keelwerk/live';
import type { TestApp } from '@keelwerk/testing';
import { library, loans } from '@keelwerk/testing/fixtures';
import type { OrpcStaticOptions } from '../../src/orpc-static-options.ts';
import { orpcTransport } from '../../src/orpc-transport.ts';
import { performedEffects } from './performed-effects.ts';

interface EchoBase extends ModuleBaseType<typeof echoBaseDef> {}
const echoBaseDef = defineModuleBase({ id: 'echo', version: '0.1.0' });
const echoBase: EchoBase = echoBaseDef;

const kinds = shape({
  at: field.instant(),
  on: field.date(),
  big: field.integer({ wide: true }),
  bytes: field.binary(),
  tags: field.set(field.string()),
  label: field.string(),
});

/** Answers its input: every kind oRPC does not carry on its own, in and out. */
const mirror = defineQuery(echoBase, {
  auth: { public: true },
  input: kinds,
  output: kinds,
  read: (input) => input,
});

/** Always refused with a rate limit that names a wait. */
const limited = defineQuery(echoBase, {
  auth: { public: true },
  input: shape({}),
  output: shape({ done: field.boolean() }),
  read: () => {
    throw errors.rate_limited('Slow down.', { retryAfter: 7 });
  },
});

/** Always fails with something the taxonomy does not know. */
const broken = defineQuery(echoBase, {
  auth: { public: true },
  input: shape({}),
  output: shape({ done: field.boolean() }),
  read: () => {
    throw new Error('secret detail of the failure');
  },
});

/** A schema that accepts any value as it is, so the output is not read before oRPC encodes it. */
const anything = {
  '~standard': {
    version: 1,
    vendor: 'test',
    validate: (value: unknown) => ({ value }),
    jsonSchema: { input: () => ({}), output: () => ({}) },
  },
} as unknown as StandardSchemaV1<unknown, unknown>;

/**
 * Runs without a failure and answers a value that oRPC's own encoding of the output cannot read: a
 * member whose getter raises a `TypeError`, which the wire encoding of the output does not touch.
 */
const unencodable = defineQuery(echoBase, {
  auth: { public: true },
  input: shape({}),
  output: shape({ payload: field.json(anything) }),
  read: () => ({
    payload: Object.defineProperty({}, 'n', {
      enumerable: true,
      get(): never {
        throw new TypeError('output encoding failed (test)');
      },
    }),
  }),
});

/** A deferred effect without input: running a command with it lists the effect id. */
const ping = defineEffect(echoBase, { input: shape({}), output: shape({}) });
const pingExecutor = defineEffectExecutor(echoBase, ping, {
  run: async (_input, ctx) => {
    performedEffects.push({ id: ctx.effect.id, scope: ctx.scope });
    return {};
  },
});

/** Plans two deferred effects, so its answer carries `Keelwerk-Effects` as a list. */
const notify = defineCommand(echoBase, {
  auth: { public: true },
  input: shape({}),
  output: shape({ done: field.boolean() }),
  decide() {
    return { events: [], effects: [ping({}), ping({})], result: { done: true } };
  },
});

/** A command that always runs asynchronously: it answers its receipt whether or not the client preferred it. */
const settle = defineCommand(echoBase, {
  auth: { public: true },
  input: shape({}),
  output: shape({ done: field.boolean() }),
  execution: 'async',
  decide() {
    return { events: [], result: { done: true } };
  },
});

const echoDef = defineModule(echoBase, {
  actions: { broken, limited, mirror, notify, settle, unencodable },
  effects: { ping },
  executors: { ping: pingExecutor },
});
interface Echo extends ModuleType<typeof echoDef> {}
const echo: Echo = echoDef;

/** The fixture modules and the kinds module with the oRPC module composed in under the given static options. */
export function orpcEchoApp(options: OrpcStaticOptions = {}): TestApp {
  return defineApp({
    id: 'orpc-echo',
    modules: [live, library, loans, echo, orpcTransport(options)],
    execution: { 'loans.lend': 'either' },
    api: defineApiVersions({
      '2026-11-04': { deprecated: { at: '2026-11-05', sunset: '2099-12-31' } },
      '2026-11-11': {},
    }),
  });
}
