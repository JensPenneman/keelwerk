import { describe, expectTypeOf, test } from 'vitest';
import { defineVersionChange } from '../src/api-versions/define-version-change.ts';
import { defineCommand } from '../src/dsl/define-command.ts';
import { defineFlag } from '../src/dsl/define-flag.ts';
import { defineModule } from '../src/dsl/define-module.ts';
import { defineModuleBase } from '../src/dsl/define-module-base.ts';
import { defineProcess } from '../src/dsl/define-process.ts';
import { defineReaction } from '../src/dsl/define-reaction.ts';
import { defineStream } from '../src/dsl/define-stream.ts';
import { defineTopic } from '../src/dsl/define-topic.ts';
import { invoke } from '../src/dsl/invoke.ts';
import { quota } from '../src/dsl/quota.ts';
import { field } from '../src/fields/field.ts';
import { shape } from '../src/fields/shape.ts';
import type { FlagRequest } from '../src/protocol/flag-request.ts';
import { hooksBase } from './fixtures/modules/hooks/src/base.ts';
import { start } from './fixtures/modules/m2-parts/src/actions/start.ts';
import { m2PartsBase } from './fixtures/modules/m2-parts/src/base.ts';
import { task } from './fixtures/modules/m2-parts/src/entities/task.ts';
import { m2Parts } from './fixtures/modules/m2-parts/src/module.generated.ts';

describe('M2 kernel contract: the parts, typed against their base', () => {
  test("a process's react receives the event, the folded state and ctx with its own event drafts", () => {
    defineProcess(m2PartsBase, {
      on: ['m2-parts.task.renamed'],
      key: (event) => event.stream.id,
      events: { stepped: shape({ step: field.integer() }) },
      initial: { steps: 0 },
      evolve: (state) => state,
      react: (event, state, ctx) => {
        expectTypeOf(event.type).toEqualTypeOf<'m2-parts.task.renamed'>();
        expectTypeOf(event.data.displayName).toEqualTypeOf<string>();
        expectTypeOf(state).toEqualTypeOf<{ steps: number }>();
        expectTypeOf(ctx.events.stepped).parameter(0).toEqualTypeOf<{ readonly step: number }>();
        // @ts-expect-error a process writes its own events only
        ctx.events.unknown({ step: 1 });
        return { events: [] };
      },
    });
  });

  test("a process's evolve folds its own events, typed by their shapes", () => {
    defineProcess(m2PartsBase, {
      on: ['m2-parts.task.renamed'],
      key: (event) => event.stream.id,
      events: {
        stepped: shape({ step: field.integer() }),
        closed: shape({ reason: field.string() }),
      },
      initial: { steps: 0 },
      evolve: (state, event) => {
        expectTypeOf(event.type).toEqualTypeOf<'stepped' | 'closed'>();
        if (event.type === 'stepped') expectTypeOf(event.data.step).toEqualTypeOf<number>();
        if (event.type === 'closed') expectTypeOf(event.data.reason).toEqualTypeOf<string>();
        return state;
      },
      react: () => ({ events: [] }),
    });
  });

  test('ctx.flags types each flag by its kind', () => {
    defineCommand(m2PartsBase, {
      decide: (_input, ctx) => {
        expectTypeOf(ctx.flags.m2Parts.beta).toEqualTypeOf<FlagRequest<boolean>>();
        expectTypeOf(ctx.flags.m2Parts.layout).toEqualTypeOf<FlagRequest<'control' | 'compact'>>();
        expectTypeOf(ctx.flags.m2Parts.limit).toEqualTypeOf<FlagRequest<number>>();
        // @ts-expect-error the module declares no such flag
        ctx.flags.m2Parts.unknown;
        return { events: [] };
      },
    });
  });

  test("ctx.flags reaches a required module's flags by its context name", () => {
    const consumerBase = defineModuleBase({
      id: 'flag-consumer',
      version: '0.1.0',
      requires: [m2Parts],
      flags: {
        own: defineFlag({
          kind: 'boolean',
          level: 'tenant',
          purpose: 'operational',
          default: true,
        }),
      },
    });
    defineCommand(consumerBase, {
      decide: (_input, ctx) => {
        expectTypeOf(ctx.flags.m2Parts.limit).toEqualTypeOf<FlagRequest<number>>();
        expectTypeOf(ctx.flags.flagConsumer.own).toEqualTypeOf<FlagRequest<boolean>>();
        // @ts-expect-error a module that is not required has no flags in the context
        ctx.flags.hooks;
        return { events: [] };
      },
    });
  });

  test('on: all is refused without observes: all', () => {
    defineReaction(m2PartsBase, { on: 'all', react: () => ({ events: [] }) });
    // @ts-expect-error hooks does not declare observes: 'all'
    defineReaction(hooksBase, { on: 'all', react: () => ({ events: [] }) });
  });

  test("on: all is refused with timing: 'inline'", () => {
    defineReaction(m2PartsBase, {
      on: 'all',
      // @ts-expect-error an observer is asynchronous
      timing: 'inline',
      react: () => ({ events: [] }),
    });
  });

  test('except is refused on a listed reaction', () => {
    defineReaction(m2PartsBase, {
      on: 'all',
      except: ['m2-parts.task.renamed'],
      react: () => ({ events: [] }),
    });
    defineReaction(m2PartsBase, {
      on: 'm2-parts.task.renamed',
      // @ts-expect-error except belongs to on: 'all'
      except: ['m2-parts.task.created'],
      react: () => ({ events: [] }),
    });
  });

  test('an observed event has string type and record data', () => {
    defineReaction(m2PartsBase, {
      on: 'all',
      react: (event) => {
        expectTypeOf(event.type).toEqualTypeOf<string>();
        expectTypeOf(event.data).toEqualTypeOf<{ readonly [field: string]: unknown }>();
        return { events: [] };
      },
    });
  });

  test('a reaction event carries causationId', () => {
    defineReaction(m2PartsBase, {
      on: 'm2-parts.task.renamed',
      timing: 'inline',
      react: (event) => {
        expectTypeOf(event.causationId).toEqualTypeOf<string | null>();
        return { events: [] };
      },
    });
  });

  test('a stream, a topic and a quota are typed by their declarations', () => {
    expectTypeOf(m2PartsBase.streams.log.kind).toEqualTypeOf<'stream'>();
    expectTypeOf(m2PartsBase.quotas.storageBytes.kind).toEqualTypeOf<'bytes'>();
    expectTypeOf(m2PartsBase.quotas.calls.kind).toEqualTypeOf<'rate'>();
    expectTypeOf(m2Parts.topics.progress.kind).toEqualTypeOf<'topic'>();
    defineStream({
      key: field.ref.own('task'),
      record: shape({ line: field.string() }),
      readAs: 'task',
    });
    defineTopic(m2PartsBase, {
      key: shape({ task: field.ref.own('task') }),
      record: shape({ step: field.integer() }),
      onFirstSubscriber: (key, ctx) => {
        expectTypeOf(key.task).toBeString();
        expectTypeOf(ctx.flags.m2Parts.beta).toEqualTypeOf<FlagRequest<boolean>>();
        return { events: [] };
      },
    });
    quota.count().default(1000);
    quota.bytes().default('10GiB');
    quota.rate().default('100/1m');
    // @ts-expect-error a count is a number
    quota.count().default('1GiB');
    // @ts-expect-error a rate is '<n>/<duration>'
    quota.rate().default('100');
  });

  test('a version change refuses a field the entity does not have', () => {
    defineVersionChange(m2PartsBase, {
      since: '1.0.0',
      surface: [{ entity: task, field: 'displayName', renamedFrom: 'name' }],
    });
    defineVersionChange(m2PartsBase, {
      since: '1.0.0',
      // @ts-expect-error the entity has no field 'nope'
      surface: [{ entity: task, field: 'nope', renamedFrom: 'name' }],
    });
  });

  test('a base gate names a boolean flag', () => {
    const flags = {
      on: defineFlag({ kind: 'boolean', level: 'tenant', purpose: 'operational', default: true }),
      layout: defineFlag({
        kind: 'variant',
        level: 'tenant',
        purpose: 'operational',
        variants: ['a', 'b'],
        default: 'a',
      }),
    };
    defineModuleBase({ id: 'gated', version: '0.1.0', flags, gate: 'on' });
    // @ts-expect-error a gate names a boolean flag
    defineModuleBase({ id: 'gated', version: '0.1.0', flags, gate: 'layout' });
  });

  test('invoke accepts an errors map', () => {
    const effect = invoke(
      start,
      { name: 'a' },
      { errors: { 'm2-parts.start_refused': 'm2-parts.failed' } },
    );
    expectTypeOf(effect.errors).toEqualTypeOf<Readonly<Record<string, string>> | undefined>();
    // @ts-expect-error codes map to codes
    invoke(start, { name: 'a' }, { errors: { 'm2-parts.start_refused': 1 } });
  });

  test('a topic or change typed against another base is refused at the mount', () => {
    const hooksTopic = defineTopic(hooksBase, {
      key: shape({ id: field.string() }),
      record: shape({ line: field.string() }),
    });
    const hooksChange = defineVersionChange(hooksBase, { since: '0.1.0', surface: [] });
    // @ts-expect-error the topic is typed against the hooks base
    defineModule(m2PartsBase, { topics: { stray: hooksTopic } });
    // @ts-expect-error the change is typed against the hooks base
    defineModule(m2PartsBase, { changes: { stray: hooksChange } });
  });
});
