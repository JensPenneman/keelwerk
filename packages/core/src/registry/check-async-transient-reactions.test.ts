import { describe, expect, test } from 'vitest';
import { appOf, makeModule } from '../../test/registry-kit.ts';
import { defineEntity } from '../dsl/define-entity.ts';
import { defineReaction } from '../dsl/define-reaction.ts';
import { field } from '../fields/field.ts';
import { buildRegistry } from './build-registry.ts';
import { checkAsyncTransientReactions } from './check-async-transient-reactions.ts';
import { m2ComposeChecks } from './m2-compose-checks.ts';

const visit = defineEntity({
  prefix: 'vst',
  dataSubject: 'owner',
  fields: { owner: field.subject(), note: field.string() },
  history: 'state',
});
const entry = defineEntity({
  prefix: 'ent',
  dataSubject: 'owner',
  fields: { owner: field.subject(), note: field.string() },
});
const base = (makeModule({ id: 'logs', entities: { visit, entry } }) as unknown as { base: object })
  .base;
const react = (): undefined => undefined;
const reaction = (spec: object): object =>
  defineReaction(base as never, { react, ...spec } as never);

function problemsOf(reactions: Record<string, object>) {
  const app = appOf([makeModule({ id: 'logs', entities: { visit, entry } }, { reactions })]);
  return checkAsyncTransientReactions(app, buildRegistry(app));
}

describe('the compose check for asynchronous reactions on transient records', () => {
  test("refuses an async reaction on the created event of a history: 'state' entity", () => {
    const problems = problemsOf({ seen: reaction({ on: 'logs.visit.created', timing: 'async' }) });
    expect(problems).toEqual([
      {
        code: 'asyncReactionTransient',
        severity: 'error',
        module: 'logs',
        ref: 'logs.seen',
        message:
          "The reaction 'logs.seen' is asynchronous and reacts to 'logs.visit.created', a record of the history: 'state' entity 'logs.visit': such records are transient and reach inline reactions only.",
      },
    ]);
  });

  test('a reaction with no timing is asynchronous and is refused as well', () => {
    const problems = problemsOf({ seen: reaction({ on: 'logs.visit.created' }) });
    expect(problems.map((problem) => problem.code)).toEqual(['asyncReactionTransient']);
  });

  test('accepts an inline reaction on it', () => {
    expect(problemsOf({ seen: reaction({ on: 'logs.visit.created', timing: 'inline' }) })).toEqual(
      [],
    );
  });

  test("accepts on: 'all'", () => {
    expect(problemsOf({ seen: reaction({ on: 'all', timing: 'async' }) })).toEqual([]);
  });

  test('accepts an async reaction on a chain entity', () => {
    expect(problemsOf({ seen: reaction({ on: 'logs.entry.created', timing: 'async' }) })).toEqual(
      [],
    );
  });

  test('is one of the checks of the compose step', () => {
    expect(m2ComposeChecks).toContain(checkAsyncTransientReactions);
  });
});
