import { defineCommand, field, shape } from '@keelwerk/core';
import { benchBase } from './bench-base.ts';
import { benchItem } from './bench-item.ts';
import { touch } from './bench-touch.ts';

const itemInput = shape({ label: field.string({ maxLength: 80 }) });
const itemOutput = shape({ itemId: field.ref.own('item') });

/** Writes one row and its event: the command job when called asynchronously, the unit of the calibration when called synchronously. */
export const record = defineCommand(benchBase, {
  input: itemInput,
  output: itemOutput,
  execution: 'either',
  auth: { public: true },
  *decide(input, ctx) {
    const id = yield* ctx.newId(benchItem);
    return {
      events: [ctx.write.bench.item.create({ id, label: input.label })],
      result: { itemId: id },
    };
  },
});

/** Writes the same row and requests one effect, which a worker runs as the effect job. */
export const request = defineCommand(benchBase, {
  input: itemInput,
  output: itemOutput,
  auth: { public: true },
  *decide(input, ctx) {
    const id = yield* ctx.newId(benchItem);
    return {
      events: [ctx.write.bench.item.create({ id, label: input.label })],
      effects: [touch({ itemId: id })],
      result: { itemId: id },
    };
  },
});
