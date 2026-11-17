import {
  defineApp,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  field,
} from '@keelwerk/core';
import { startTransportRuntime, type TransportRuntime } from '@keelwerk/testing';
import { httpHost } from '@keelwerk/transport-http';
import { afterAll, describe, expect, test } from 'vitest';
import { graphql } from '../src/module.ts';

// A card whose `shown` field defaults to true: the default may fill a create and must never be written over a stored value by an update.
const card = defineEntity({
  prefix: 'card',
  fields: {
    owner: field.string().index(),
    title: field.string(),
    shown: field.boolean().default(true),
  },
  generated: { watch: false },
});
const boardBase = defineModuleBase({ id: 'board', version: '0.1.0', entities: { card } });
const board = defineModule(boardBase, {
  policies: {
    card: {
      writers: defineRule(boardBase, card, {
        effect: 'allow',
        actions: ['read', 'write'],
        principal: 'user',
        reason: 'A signed-in user reads and edits cards.',
      }),
    },
  },
});
const cardApp = defineApp({ id: 'card-board', modules: [board, graphql] });

const runtime: TransportRuntime = await startTransportRuntime({
  app: cardApp,
  host: httpHost(),
  config: { graphql: { cors: [] } },
  tenants: ['acme'],
});
afterAll(() => runtime.stop());

async function operate(query: string, variables: Record<string, unknown>): Promise<unknown> {
  const response = await runtime.fetch(
    new Request(`https://${runtime.domains.acme}/graphql`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-test-principal': JSON.stringify({ subject: 'ada', roles: [], claims: {} }),
      },
      body: JSON.stringify({ query, variables }),
    }),
  );
  const body = (await response.json()) as { data?: unknown; errors?: unknown };
  expect(body.errors, JSON.stringify(body)).toBeUndefined();
  return body.data;
}

const create =
  'mutation($input: BoardCardCreateInput!) { boardCardCreate(input: $input) { __typename ... on BoardCardCreateSuccess { result { id title shown } } } }';
const update =
  'mutation($input: BoardCardUpdateInput!) { boardCardUpdate(input: $input) { __typename ... on BoardCardUpdateSuccess { result { id title shown } } } }';
const read = 'query($id: ID!) { node(id: $id) { ... on BoardCard { title shown } } }';

describe('a generated update over GraphQL', () => {
  test('a generated update of the title leaves a hidden card hidden', async () => {
    const created = (await operate(create, { input: { owner: 'ada', title: 'A' } })) as {
      boardCardCreate: { result: { id: string; shown: boolean } };
    };
    const { id } = created.boardCardCreate.result;
    expect(created.boardCardCreate.result.shown).toBe(true);
    await operate(update, { input: { id, patch: { shown: false } } });
    const updated = (await operate(update, { input: { id, patch: { title: 'B' } } })) as {
      boardCardUpdate: { result: { shown: boolean; title: string } };
    };
    expect(updated.boardCardUpdate.result).toMatchObject({ title: 'B', shown: false });
    expect(await operate(read, { id })).toEqual({ node: { title: 'B', shown: false } });
  });
});
