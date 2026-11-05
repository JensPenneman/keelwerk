import { defineCommand, field, shape } from '@keelwerk/core';
import { benchBase } from './bench-base.ts';
import { benchItem } from './bench-item.ts';

/** What the measured commands take: the rows to load, how many of them, the row to write and its new value. */
const measuredInput = shape({
  ids: field.list(field.ref.own('item')),
  requests: field.integer(),
  writeId: field.ref.own('item'),
  hits: field.integer(),
});

/** Adds one item, so the measurement has rows to load and a row to write. */
export const seedItem = defineCommand(benchBase, {
  input: shape({ label: field.string({ maxLength: 80 }) }),
  output: shape({ itemId: field.ref.own('item') }),
  auth: { public: true },
  *decide(input, ctx) {
    const id = yield* ctx.newId(benchItem);
    return {
      events: [ctx.write.bench.item.create({ id, label: input.label })],
      result: { itemId: id },
    };
  },
});

/** The plain form: no request, the decision is returned as a value. Only meaningful with 0 loads. */
export const plainDecision = defineCommand(benchBase, {
  input: measuredInput,
  output: shape({}),
  auth: { public: true },
  decide(input, ctx) {
    return { events: [ctx.write.bench.item.update(input.writeId, { hits: input.hits })] };
  },
});

/** The generator form, one `yield*` per load request (unbatched); with 0 loads it never yields. */
export const generatorUnbatched = defineCommand(benchBase, {
  input: measuredInput,
  output: shape({}),
  auth: { public: true },
  *decide(input, ctx) {
    for (let index = 0; index < input.requests; index += 1) {
      const id = input.ids[index];
      if (id !== undefined) yield* ctx.load.bench.item.byId(id);
    }
    return { events: [ctx.write.bench.item.update(input.writeId, { hits: input.hits })] };
  },
});

/** The generator form with the loads in one `ctx.all`; the members are answered one after the other. */
export const generatorAll = defineCommand(benchBase, {
  input: measuredInput,
  output: shape({}),
  auth: { public: true },
  *decide(input, ctx) {
    yield* ctx.all(input.ids.slice(0, input.requests).map((id) => ctx.load.bench.item.byId(id)));
    return { events: [ctx.write.bench.item.update(input.writeId, { hits: input.hits })] };
  },
});

/** The generator form that asks for new ids, one `yield*` each: the interpreter alone, no adapter call. */
export const generatorNewId = defineCommand(benchBase, {
  input: measuredInput,
  output: shape({}),
  auth: { public: true },
  *decide(input, ctx) {
    for (let index = 0; index < input.requests; index += 1) yield* ctx.newId(benchItem);
    return { events: [ctx.write.bench.item.update(input.writeId, { hits: input.hits })] };
  },
});

/** The generator form that reads a flag, one `yield*` each: the interpreter alone, no adapter call. */
export const generatorFlag = defineCommand(benchBase, {
  input: measuredInput,
  output: shape({}),
  auth: { public: true },
  *decide(input, ctx) {
    const flag = ctx.flags['bench']?.['enabled'];
    if (flag === undefined) throw new Error('the bench module has no flag "enabled"');
    for (let index = 0; index < input.requests; index += 1) yield* flag;
    return { events: [ctx.write.bench.item.update(input.writeId, { hits: input.hits })] };
  },
});
