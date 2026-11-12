import {
  defineApp,
  defineEntity,
  defineModule,
  defineModuleBase,
  defineRule,
  field,
} from '@keelwerk/core';
import { httpHost } from '@keelwerk/transport-http';
import { rest } from '@keelwerk/transport-rest';
import { startTestRuntime } from '../../../src/harness/start-test-runtime.ts';
import { testPrincipalHeader } from '../../../src/harness/test-principal-header.ts';
import type { TestRuntime } from '../../../src/harness/test-runtime.ts';
import type { TestRuntimeOptions } from '../../../src/harness/test-runtime-options.ts';

const url = 'https://card-board.example.test';

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

/** An app with one entity whose `shown` field defaults to true, served over the invocation protocol and REST. */
export const cardBoardApp = defineApp({ id: 'card-board', modules: [board, rest] });

/** Starts the card board on the given storage, with the HTTP host. */
export function startCardBoard(
  options: Pick<TestRuntimeOptions, 'adapter' | 'external'>,
): Promise<TestRuntime<typeof cardBoardApp>> {
  return startTestRuntime(cardBoardApp, {
    ...options,
    host: httpHost(),
    config: { rest: { docs: false, cors: [] } },
  });
}

/** One request to the card board as the test principal `ada` of tenant `acme`. */
export function sendToCardBoard(
  runtime: TestRuntime<typeof cardBoardApp>,
  path: string,
  init: {
    readonly method?: string;
    readonly body?: unknown;
    readonly contentType?: string;
  } = {},
): Promise<Response> {
  return runtime.fetch(
    new Request(`${url}${path}`, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: {
        'content-type': init.contentType ?? 'application/json',
        'x-tenant': runtime.tenants.acme?.id ?? '',
        [testPrincipalHeader]: JSON.stringify({ subject: 'ada', roles: [], claims: {} }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    }),
  );
}
