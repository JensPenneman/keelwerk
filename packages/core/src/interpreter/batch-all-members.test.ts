import { describe, expect, test } from 'vitest';
import { appOf, makeModule, widget } from '../../test/registry-kit.ts';
import { defineEntity } from '../dsl/define-entity.ts';
import { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { RecordedRead } from '../events/recorded-read.ts';
import { field } from '../fields/field.ts';
import type { AnswerContext } from '../kernel/answer-context.ts';
import type { AllRequest } from '../protocol/all-request.ts';
import type { AnyRequest } from '../protocol/any-request.ts';
import type { LoadRequest } from '../protocol/load-request.ts';
import { buildRegistry } from '../registry/build-registry.ts';
import type { AnswerDeps } from './answer-deps.ts';
import { batchAllMembers } from './batch-all-members.ts';
import { createRequest } from './create-request.ts';
import { refuseRequest } from './refuse-request.ts';
import type { RequestAuthorities } from './request-authorities.ts';

const gadget = defineEntity({ prefix: 'gdg', fields: { name: field.string() } });
const shopModule = makeModule({ id: 'shop', entities: { widget, gadget } });
const registry = buildRegistry(
  appOf([shopModule, makeModule({ id: 'store', requires: [shopModule] })]),
);

interface Kit {
  readonly authorities: RequestAuthorities;
  readonly reads: RecordedRead[];
  readonly manyLoads: LoadRequest[];
  readonly aloneLoads: LoadRequest[];
  readonly context: AnswerContext;
  readonly deps: AnswerDeps;
  member(
    id: string,
    over?: Partial<LoadRequest> & { readonly authority?: string; readonly entity?: string },
  ): LoadRequest;
  all(...members: unknown[]): AllRequest;
}

/** `missing` ids are absent from the answer of a `many`; `refuseMany` makes it refuse. */
function kit(
  options: { missing?: readonly string[]; refuseMany?: boolean; at?: RecordedRead } = {},
): Kit {
  const authorities: RequestAuthorities = new WeakMap();
  const reads: RecordedRead[] = [];
  const manyLoads: LoadRequest[] = [];
  const aloneLoads: LoadRequest[] = [];
  let alone = 0;
  const at = options.at ?? { at: 7n };
  const context = {
    registry,
    module: 'shop',
    form: 'decide',
    record: { read: (read: RecordedRead) => reads.push(read) },
    async answer(request: AnyRequest): Promise<unknown> {
      if (request.kind !== 'load') return `other:${request.kind}`;
      aloneLoads.push(request);
      alone += 1;
      context.record.read({ at: BigInt(100 + alone) });
      return `alone:${String(request.args[0])}`;
    },
  } as unknown as AnswerContext;
  const deps = {
    authorities,
    answerer: {
      async load(request: LoadRequest, derived: AnswerContext): Promise<unknown> {
        if (request.op !== 'many') throw new Error('expected many');
        if (options.refuseMany) throw refuseRequest('load.many', 'refused');
        manyLoads.push(request);
        derived.record.read(at);
        const spec = request.args[0] as { where: { id: { in: string[] } } };
        return spec.where.id.in
          .filter((id) => !(options.missing ?? []).includes(id))
          .map((id) => ({ id }));
      },
    },
  } as unknown as AnswerDeps;
  return {
    authorities,
    reads,
    manyLoads,
    aloneLoads,
    context,
    deps,
    member: (id, over = {}) => {
      const { authority, entity, ...rest } = over;
      return createRequest<LoadRequest>(
        authorities,
        {
          kind: 'load',
          module: 'shop',
          entity: entity ?? 'widget',
          op: 'byId',
          args: [id],
          view: 'module',
          forUpdate: false,
          ...rest,
        },
        authority,
      );
    },
    all: (...members) => ({ kind: 'all', requests: members }) as unknown as AllRequest,
  };
}

const uuid = (n: number): string => `0190a5b2-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
const u = {
  a: uuid(1),
  b: uuid(2),
  c: uuid(3),
  d: uuid(4),
  e: uuid(5),
  g: uuid(6),
  l: uuid(7),
  x: uuid(8),
};
const ids = [u.a, u.b, u.c, u.d, u.e];

describe('batchAllMembers', () => {
  test('five byId members of one entity are one many load with an in condition on id', async () => {
    const k = kit();
    const answers = await batchAllMembers(
      k.all(...ids.map((id) => k.member(id))),
      k.context,
      k.deps,
    );
    expect(k.manyLoads).toHaveLength(1);
    expect(k.manyLoads[0]).toMatchObject({
      kind: 'load',
      op: 'many',
      view: 'module',
      forUpdate: false,
      args: [{ where: { id: { in: ids } }, limit: 5 }],
    });
    expect(k.aloneLoads).toEqual([]);
    expect(answers).toEqual(ids.map((id) => ({ id })));
  });

  test("each member records the batch's read once, in member order", async () => {
    const k = kit();
    await batchAllMembers(k.all(...ids.map((id) => k.member(id))), k.context, k.deps);
    expect(k.reads).toEqual(ids.map(() => ({ at: 7n })));
    const scoped = kit({ at: { scope: 'backend', at: 7n } });
    await batchAllMembers(
      scoped.all(...ids.map((id) => scoped.member(id))),
      scoped.context,
      scoped.deps,
    );
    expect(scoped.reads).toEqual(ids.map(() => ({ scope: 'backend', at: 7n })));
  });

  test('a missing id answers undefined', async () => {
    const k = kit({ missing: [u.e] });
    const answers = await batchAllMembers(
      k.all(...ids.map((id) => k.member(id))),
      k.context,
      k.deps,
    );
    expect(answers.slice(0, 4)).toEqual([u.a, u.b, u.c, u.d].map((id) => ({ id })));
    expect(answers[4]).toBeUndefined();
  });

  test('a one load by id joins the batch, a one load on another field does not', async () => {
    const k = kit();
    const byName = k.member(u.x, { op: 'one', args: [{ where: { name: 'x' } }] });
    const oneById = k.member(u.b, { op: 'one', args: [{ where: { id: u.b } }] });
    const answers = await batchAllMembers(k.all(k.member(u.a), byName, oneById), k.context, k.deps);
    expect(k.manyLoads[0]?.args).toEqual([{ where: { id: { in: [u.a, u.b] } }, limit: 2 }]);
    expect(k.aloneLoads).toEqual([byName]);
    expect(answers).toEqual([{ id: u.a }, expect.stringContaining('alone:'), { id: u.b }]);
  });

  test('members of two entities fall back to one load each', async () => {
    const k = kit();
    const one = k.member(u.a);
    const other = k.member(u.g, { entity: 'gadget' });
    await batchAllMembers(k.all(one, other), k.context, k.deps);
    expect(k.manyLoads).toEqual([]);
    expect(k.aloneLoads).toEqual([one, other]);
    const pair = kit();
    await batchAllMembers(
      pair.all(pair.member(u.a), pair.member(u.g, { entity: 'gadget' }), pair.member(u.b)),
      pair.context,
      pair.deps,
    );
    expect(pair.manyLoads).toHaveLength(1);
    expect(pair.aloneLoads).toHaveLength(1);
  });

  test('a locked member is never batched', async () => {
    const k = kit();
    const locked = k.member(u.l, { forUpdate: true });
    const answers = await batchAllMembers(
      k.all(k.member(u.a), locked, k.member(u.b)),
      k.context,
      k.deps,
    );
    expect(k.aloneLoads).toEqual([locked]);
    expect(k.manyLoads[0]?.args).toEqual([{ where: { id: { in: [u.a, u.b] } }, limit: 2 }]);
    expect(answers[1]).toBe(`alone:${u.l}`);
  });

  test('members of other views do not share a batch', async () => {
    const k = kit();
    await batchAllMembers(
      k.all(k.member(u.a), k.member(u.b, { view: 'caller' }), k.member(u.c)),
      k.context,
      k.deps,
    );
    expect(k.manyLoads).toHaveLength(1);
    expect(k.manyLoads[0]?.args).toEqual([{ where: { id: { in: [u.a, u.c] } }, limit: 2 }]);
    expect(k.aloneLoads).toHaveLength(1);
  });

  test('members of other authorities do not share a batch', async () => {
    const k = kit();
    await batchAllMembers(
      k.all(
        k.member(u.a),
        k.member(u.b),
        k.member(u.c, { authority: 'store' }),
        k.member(u.d, { authority: 'store' }),
      ),
      k.context,
      k.deps,
    );
    expect(k.aloneLoads).toEqual([]);
    expect(k.manyLoads.map((load) => load.args)).toEqual([
      [{ where: { id: { in: [u.a, u.b] } }, limit: 2 }],
      [{ where: { id: { in: [u.c, u.d] } }, limit: 2 }],
    ]);
    expect(k.manyLoads.map((load) => k.authorities.get(load))).toEqual(['shop', 'store']);
  });

  test('ids that are not canonical lowercase uuids are answered alone', async () => {
    const k = kit();
    const upper = k.member(u.a.toUpperCase());
    await batchAllMembers(
      k.all(upper, k.member(u.b), k.member(u.c), k.member('nope')),
      k.context,
      k.deps,
    );
    expect(k.aloneLoads).toEqual([upper, expect.objectContaining({ args: ['nope'] })]);
    expect(k.manyLoads[0]?.args).toEqual([{ where: { id: { in: [u.b, u.c] } }, limit: 2 }]);
  });

  test('other members keep their turn and their reads stay in member order', async () => {
    const k = kit();
    const count = k.member(u.x, { op: 'count', args: [{}] });
    await batchAllMembers(k.all(k.member(u.a), count, k.member(u.b)), k.context, k.deps);
    expect(k.reads).toEqual([{ at: 7n }, { at: 101n }, { at: 7n }]);
  });

  test("a refused batch answers the member's own refusal", async () => {
    const k = kit({ refuseMany: true });
    k.context.answer = async (request) => {
      throw refuseRequest(`load.${(request as LoadRequest).op}`, 'own');
    };
    const failure = await batchAllMembers(
      k.all(k.member(u.a), k.member(u.b)),
      k.context,
      k.deps,
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(KeelwerkError);
    expect((failure as KeelwerkError).code).toBe('core.request_not_allowed');
    expect((failure as KeelwerkError).details).toMatchObject({ request: 'load.byId' });
  });

  test('a non-request member is refused', async () => {
    const k = kit();
    const failure = await batchAllMembers(
      k.all(k.member(u.a), k.member(u.b), 42),
      k.context,
      k.deps,
    ).catch((error: unknown) => error);
    expect((failure as KeelwerkError).code).toBe('core.request_not_allowed');
    expect((failure as KeelwerkError).details).toMatchObject({ request: 'all' });
  });

  test('a group above 1000 distinct ids splits into chunks', async () => {
    const k = kit();
    const many = Array.from({ length: 1001 }, (_, index) => uuid(1000 + index));
    const answers = await batchAllMembers(
      k.all(...many.map((id) => k.member(id))),
      k.context,
      k.deps,
    );
    expect(k.manyLoads.map((load) => (load.args[0] as { limit: number }).limit)).toEqual([1000, 1]);
    expect(answers).toHaveLength(1001);
    expect(k.reads).toHaveLength(1001);
  });

  test('two members asking the same id share one row', async () => {
    const k = kit();
    const answers = await batchAllMembers(
      k.all(k.member(u.a), k.member(u.b), k.member(u.a)),
      k.context,
      k.deps,
    );
    expect(k.manyLoads[0]?.args).toEqual([{ where: { id: { in: [u.a, u.b] } }, limit: 2 }]);
    expect(answers[0]).toBe(answers[2]);
  });
});
