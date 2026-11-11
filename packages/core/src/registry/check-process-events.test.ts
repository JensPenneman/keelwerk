import { describe, expect, test } from 'vitest';
import { m2Parts } from '../../test/fixtures/modules/m2-parts/src/module.generated.ts';
import { reactionRegistry } from '../../test/reaction-kit.ts';
import { appOf, makeModule } from '../../test/registry-kit.ts';
import { defineEntity } from '../dsl/define-entity.ts';
import { defineProcess } from '../dsl/define-process.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import { buildRegistry } from './build-registry.ts';
import { checkProcessEvents } from './check-process-events.ts';

const note = defineEntity({ prefix: 'nte', fields: { text: field.string() } });
const settings = defineEntity({
  prefix: 'set',
  tenancy: 'backend',
  fields: { text: field.string() },
});
const base = (
  makeModule({ id: 'logs', entities: { note, settings } }) as unknown as { base: object }
).base;

function problemsOf(spec: object) {
  const process = defineProcess(
    base as never,
    {
      on: ['logs.note.created'],
      key: () => 'k',
      events: { noted: shape({ n: field.integer() }) },
      initial: 0,
      evolve: (state: number) => state,
      react: () => undefined,
      ...spec,
    } as never,
  );
  const app = appOf([
    makeModule({ id: 'logs', entities: { note, settings } }, { reactions: { tally: process } }),
  ]);
  return checkProcessEvents(app, buildRegistry(app));
}

describe('the process event checks', () => {
  test('accepts a process whose events hold plain members, and the m2-parts fixture', () => {
    expect(problemsOf({})).toEqual([]);
    const app = appOf([m2Parts]);
    expect(checkProcessEvents(app, buildRegistry(app))).toEqual([]);
    const registry = reactionRegistry();
    expect(checkProcessEvents(appOf([]), registry)).toEqual([]);
  });

  test('refuses a secret or a verifier member, also in a list or a set', () => {
    for (const member of [
      field.secret(),
      field.verifier(),
      field.list(field.secret()),
      field.set(field.verifier()),
    ]) {
      expect(problemsOf({ events: { noted: shape({ token: member }) } })).toEqual([
        expect.objectContaining({
          code: 'processEventCredential',
          severity: 'error',
          module: 'logs',
          ref: 'logs.tally',
        }),
      ]);
    }
  });

  test('refuses a personal member unless the process names the instance key as its subject', () => {
    const events = { noted: shape({ note: field.string().personal() }) };
    expect(problemsOf({ events })).toEqual([
      expect.objectContaining({ code: 'processPersonalSubject', ref: 'logs.tally' }),
    ]);
    expect(problemsOf({ events, dataSubject: 'instanceKey' })).toEqual([]);
    expect(
      problemsOf({
        events: { noted: shape({ tags: field.list(field.string().personal()) }) },
      }),
    ).toEqual([expect.objectContaining({ code: 'processPersonalSubject' })]);
  });

  test('refuses a personal member whose field names a subject path of its own', () => {
    const events = { noted: shape({ note: field.string().personal({ subject: 'owner' }) }) };
    expect(problemsOf({ events, dataSubject: 'instanceKey' })).toEqual([
      expect.objectContaining({ code: 'processPersonalSubject', ref: 'logs.tally' }),
    ]);
  });

  test('refuses an on event of an entity that does not live in a tenant', () => {
    expect(problemsOf({ on: ['logs.settings.created'] })).toEqual([
      expect.objectContaining({ code: 'processTenancy', severity: 'error', ref: 'logs.tally' }),
    ]);
  });

  test('refuses a process that has the name of an entity', () => {
    const tally = defineEntity({ prefix: 'tly', fields: { text: field.string() } });
    const process = defineProcess(
      base as never,
      {
        on: ['logs.note.created'],
        key: () => 'k',
        events: {},
        initial: 0,
        evolve: (state: number) => state,
        react: () => undefined,
      } as never,
    );
    const app = appOf([
      makeModule({ id: 'logs', entities: { note, tally } }, { reactions: { tally: process } }),
    ]);
    expect(checkProcessEvents(app, buildRegistry(app))).toEqual([
      expect.objectContaining({ code: 'processNameTaken', ref: 'logs.tally' }),
    ]);
  });
});
