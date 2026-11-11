import { KeelwerkError, kernelCommandId } from '@keelwerk/core';
import { describe, expect, test } from 'vitest';
import {
  ask,
  mountedGraphql,
  publicId,
  sendGraphql,
  surfaceWithAction,
  transportSurface,
  uuidOf,
} from './support/graphql-kit.ts';
import { libraryBookRow, loanRow } from './support/rows.ts';

const surface = transportSurface();

describe('commands', () => {
  const lendInput = '{ bookTitle: "T", dueAt: "2026-12-01T00:00:00Z" }';

  test('a command answers its output and the command id it ran under', async () => {
    const { handler, calls } = await mountedGraphql(surface, () => ({
      ok: true,
      value: { loanId: uuidOf(5) },
    }));
    const answer = await ask(
      handler,
      `mutation { loansLend(input: { bookTitle: "T", dueAt: "2026-12-01T00:00:00Z", commandId: "key-1" }) { __typename ... on LoansLendSuccess { commandId result { loanId } } } }`,
    );
    expect(answer.body.data.loansLend).toEqual({
      __typename: 'LoansLendSuccess',
      commandId: 'key-1',
      result: { loanId: publicId('loan', 5) },
    });
    expect(calls[0]?.commandId).toBe('key-1');
    const generated = await ask(
      handler,
      `mutation { loansLend(input: ${lendInput}) { ... on LoansLendSuccess { commandId } } }`,
    );
    expect(generated.body.data.loansLend.commandId).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[1]?.commandId).toBe(generated.body.data.loansLend.commandId);
  });

  test('an input member named value reaches the invoker for a shape input', async () => {
    const lend = surface.actions.find((candidate) => candidate.ref === 'loans.lend');
    if (lend === undefined || lend.input.kind !== 'shape') throw new Error('lend takes a shape');
    const input = {
      ...lend.input,
      fields: { ...lend.input.fields, value: lend.input.fields.bookTitle },
    };
    const { handler, calls } = await mountedGraphql(
      surfaceWithAction(surface, { input }, 'loans.lend'),
      () => ({ ok: true, value: { loanId: uuidOf(5) } }),
    );
    const answer = await ask(
      handler,
      'mutation { loansLend(input: { bookTitle: "T", dueAt: "2026-12-01T00:00:00Z", value: "kept" }) { __typename } }',
    );
    expect(answer.body.errors).toBeUndefined();
    expect(calls[0]?.input).toMatchObject({ bookTitle: 'T', value: 'kept' });
  });

  test('a command clears what the request loaded, so a later command reads afresh', async () => {
    const update = surface.actions.find((candidate) => candidate.ref === 'library.book.update');
    const loan = surface.entities.find((candidate) => candidate.ref === 'loans.loan');
    if (update === undefined || loan === undefined) throw new Error('fixture changed');
    const loanUpdate = {
      ...update,
      ref: 'loans.loan.update',
      name: 'update',
      entity: 'loans.loan',
      output: { ...update.output, fields: loan.fields },
    };
    let reads = 0;
    const { handler } = await mountedGraphql(
      { ...surface, actions: [...surface.actions, loanUpdate as never] },
      (inv) => {
        if (inv.action === 'loans.loan.update') {
          return { ok: true, value: loanRow(1, { bookId: uuidOf(11) }) };
        }
        if (inv.action === 'library.book.get') {
          reads += 1;
          return {
            ok: true,
            value: { list: [libraryBookRow(11, { title: `Read ${reads}` })], notFound: [] },
          };
        }
        return { ok: true, value: undefined };
      },
    );
    const update_ = `{ ... on LoansLoanUpdateSuccess { result { book { title } } } }`;
    const patch = `input: { id: "${publicId('book', 1)}", patch: {} }`;
    const answer = await ask(
      handler,
      `mutation { a: loansLoanUpdate(${patch}) ${update_} b: loansLoanUpdate(${patch}) ${update_} }`,
    );
    expect(answer.body.errors).toBeUndefined();
    expect(answer.body.data.a.result.book.title).toBe('Read 1');
    expect(answer.body.data.b.result.book.title).toBe('Read 2');
  });

  test('a declared error is a union member with its data', async () => {
    const { handler } = await mountedGraphql(surface, () => ({
      ok: false,
      error: new KeelwerkError({
        kind: 'conflict',
        code: 'loans.already_lent',
        message: 'This book is already lent out.',
        details: { bookTitle: 'T' },
      }),
    }));
    const answer = await ask(
      handler,
      `mutation { loansLend(input: ${lendInput}) { __typename ... on Error { code message } ... on LoansAlreadyLentError { bookTitle } } }`,
    );
    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({
      data: {
        loansLend: {
          __typename: 'LoansAlreadyLentError',
          code: 'loans.already_lent',
          message: 'This book is already lent out.',
          bookTitle: 'T',
        },
      },
    });
  });

  test('the either command honours prefer ASYNC with CommandAccepted', async () => {
    const { handler, calls } = await mountedGraphql(surface, () => ({
      ok: true,
      value: undefined,
      receipt: { commandId: 'receipt-1', status: 'accepted' },
    }));
    const answer = await ask(
      handler,
      `mutation { loansLend(input: { bookTitle: "T", dueAt: "2026-12-01T00:00:00Z", prefer: ASYNC }) { __typename ... on CommandAccepted { commandId status } } }`,
    );
    expect(answer.status).toBe(200);
    expect(answer.body.data.loansLend).toEqual({
      __typename: 'CommandAccepted',
      commandId: 'receipt-1',
      status: 'accepted',
    });
    expect(calls[0]?.prefer).toBe('async');
  });

  test('a command id in the form the kernel makes its own ids in answers core.command_id_reserved and reaches no invoker', async () => {
    const { handler, calls } = await mountedGraphql(surface, () => ({
      ok: true,
      value: { loanId: uuidOf(5) },
    }));
    for (const id of [
      kernelCommandId('reaction', 'relay.echo', 'e1'),
      kernelCommandId('continuation', 'f1'),
    ]) {
      const answer = await ask(
        handler,
        `mutation { loansLend(input: { bookTitle: "T", dueAt: "2026-12-01T00:00:00Z", commandId: "${id}" }) { __typename } }`,
      );
      expect(answer.body.errors).toHaveLength(1);
      expect(answer.body.errors[0].extensions.keelwerk.code).toBe('core.command_id_reserved');
      expect(answer.body.errors[0].extensions.code).toBe('BAD_USER_INPUT');
    }
    expect(calls).toEqual([]);
  });

  test('a command id that is empty, too long or not visible ASCII answers core.malformed_request at input.commandId', async () => {
    const { handler, calls } = await mountedGraphql(surface, () => ({
      ok: true,
      value: { loanId: uuidOf(5) },
    }));
    for (const id of ['', 'x'.repeat(256), 'two words', 'caf\u00e9']) {
      const answer = await ask(
        handler,
        'mutation($id: String) { loansLend(input: { bookTitle: "T", dueAt: "2026-12-01T00:00:00Z", commandId: $id }) { __typename } }',
        { id },
      );
      expect(answer.body.errors).toHaveLength(1);
      const { keelwerk } = answer.body.errors[0].extensions;
      expect(keelwerk.code).toBe('core.malformed_request');
      expect(keelwerk.issues[0].path).toEqual(['input', 'commandId']);
    }
    const kept = await ask(
      handler,
      'mutation { loansLend(input: { bookTitle: "T", dueAt: "2026-12-01T00:00:00Z", commandId: "x" }) { __typename } }',
    );
    expect(kept.body.errors).toBeUndefined();
    expect(calls).toHaveLength(1);
  });

  test('a declared error carries the message of the caller audience, as every other error does', async () => {
    const respond = () => ({
      ok: false as const,
      error: new KeelwerkError({
        kind: 'internal',
        code: 'loans.already_lent',
        message: 'The ledger row 17 is broken.',
      }),
    });
    const query = `mutation { loansLend(input: ${lendInput}) { ... on Error { message } } }`;
    const publicly = await mountedGraphql(surface, respond);
    expect((await ask(publicly.handler, query)).body.data.loansLend.message).toBe(
      'Internal server error.',
    );
    const developing = await mountedGraphql(surface, respond, { development: true });
    expect((await ask(developing.handler, query)).body.data.loansLend.message).toBe(
      'The ledger row 17 is broken.',
    );
  });

  test('a replayed command answers like the first run', async () => {
    const { handler } = await mountedGraphql(surface, () => ({
      ok: true,
      value: { loanId: uuidOf(5) },
      replayed: true,
    }));
    const answer = await ask(
      handler,
      `mutation { loansLend(input: { bookTitle: "T", dueAt: "2026-12-01T00:00:00Z", commandId: "again" }) { ... on LoansLendSuccess { commandId } } }`,
    );
    expect(answer.body.data.loansLend.commandId).toBe('again');
  });

  test('a command sets the cookie its hint names for a browser request', async () => {
    const { handler } = await mountedGraphql(surface, () => ({
      ok: true,
      value: { ticket: 'secret-ticket', desk: 'north' },
    }));
    const response = await sendGraphql(
      handler,
      {
        query:
          'mutation { loansOpenDesk(input: { desk: "north" }) { ... on LoansOpenDeskSuccess { result { desk ticket } } } }',
      },
      { headers: { 'sec-fetch-mode': 'navigate' } },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.loansOpenDesk.result.desk).toBe('north');
  });
});
