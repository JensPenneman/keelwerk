import { describe, expect, test } from 'vitest';
import { m2Parts } from '../../test/fixtures/modules/m2-parts/src/module.generated.ts';
import { appOf, makeModule } from '../../test/registry-kit.ts';
import { defineEntity } from '../dsl/define-entity.ts';
import { defineStream } from '../dsl/define-stream.ts';
import { field } from '../fields/field.ts';
import { shape } from '../fields/shape.ts';
import { buildRegistry } from './build-registry.ts';
import { checkStreamDeclarations } from './check-stream-declarations.ts';

const note = defineEntity({ prefix: 'nte', fields: { text: field.string() } });

function problemsOf(streams: object, entities: object = { note }) {
  const app = appOf([makeModule({ id: 'logs', entities, streams })]);
  return checkStreamDeclarations(app, buildRegistry(app));
}

describe('the stream declaration checks', () => {
  test('refuses a key that is no reference', () => {
    const log = defineStream({
      key: field.string(),
      record: shape({ line: field.string() }),
      readAs: 'note',
    });
    expect(problemsOf({ log })).toEqual([
      expect.objectContaining({
        code: 'streamKeyNotReference',
        severity: 'error',
        module: 'logs',
        ref: 'logs.log',
      }),
    ]);
  });

  test('refuses readAs naming no entity', () => {
    const log = defineStream({
      key: field.ref.own('note'),
      record: shape({ line: field.string() }),
      readAs: 'missing',
    });
    expect(problemsOf({ log })).toEqual([
      expect.objectContaining({ code: 'streamReadAsUnknown', ref: 'logs.log' }),
    ]);
  });

  test('refuses readAs naming another entity than the key', () => {
    const other = defineEntity({ prefix: 'oth', fields: { text: field.string() } });
    const log = defineStream({
      key: field.ref.own('note'),
      record: shape({ line: field.string() }),
      readAs: 'other',
    });
    expect(problemsOf({ log }, { note, other })).toEqual([
      expect.objectContaining({ code: 'streamReadAsNotKeyed', ref: 'logs.log' }),
    ]);
  });

  test('refuses a personal member whose subject path does not resolve', () => {
    const log = defineStream({
      key: field.ref.own('note'),
      record: shape({ line: field.string().personal({ subject: 'nowhere' }) }),
      readAs: 'note',
    });
    expect(problemsOf({ log })).toEqual([
      expect.objectContaining({ code: 'streamDataSubject', ref: 'logs.log' }),
    ]);
  });

  test('refuses a personal element a list member holds when its subject path does not resolve', () => {
    const log = defineStream({
      key: field.ref.own('note'),
      record: shape({ to: field.list(field.string().personal({ subject: 'nowhere' })) }),
      readAs: 'note',
    });
    expect(problemsOf({ log })).toEqual([
      expect.objectContaining({ code: 'streamDataSubject', ref: 'logs.log' }),
    ]);
  });

  test('accepts a personal list element whose subject resolves', () => {
    const log = defineStream({
      key: field.ref.own('note'),
      record: shape({ to: field.list(field.string().personal()) }),
      readAs: 'note',
    });
    expect(problemsOf({ log })).toEqual([]);
  });

  test('refuses a credential member, also inside a list or set', () => {
    const log = defineStream({
      key: field.ref.own('note'),
      record: shape({ line: field.string(), token: field.secret() }),
      readAs: 'note',
    });
    const listed = defineStream({
      key: field.ref.own('note'),
      record: shape({ hashes: field.list(field.verifier()) }),
      readAs: 'note',
    });
    expect(problemsOf({ log })).toEqual([
      expect.objectContaining({ code: 'streamRecordCredential', ref: 'logs.log' }),
    ]);
    expect(problemsOf({ listed })).toEqual([
      expect.objectContaining({ code: 'streamRecordCredential', ref: 'logs.listed' }),
    ]);
  });

  test('refuses a stream named like an entity of its module', () => {
    const noteStream = defineStream({
      key: field.ref.own('note'),
      record: shape({ line: field.string() }),
      readAs: 'note',
    });
    expect(problemsOf({ note: noteStream })).toEqual([
      expect.objectContaining({ code: 'streamNameTaken', ref: 'logs.note' }),
    ]);
  });

  test('passes core.effectAttempt and m2-parts.log', () => {
    const app = appOf([m2Parts]);
    const registry = buildRegistry(app);
    expect([...registry.streams.keys()]).toEqual(
      expect.arrayContaining(['core.effectAttempt', 'm2-parts.log']),
    );
    expect(checkStreamDeclarations(app, registry)).toEqual([]);
  });
});
