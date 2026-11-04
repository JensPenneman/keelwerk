import { defineCommand, field, shape } from '@keelwerk/core';
import { device } from './device.ts';
import { trailBase } from './trail-base.ts';

/** Adds a device, so the ingest has one to write to. */
export const registerDevice = defineCommand(trailBase, {
  input: shape({ name: field.string({ maxLength: 80 }) }),
  output: shape({ deviceId: field.ref.own('device') }),
  auth: { public: true },
  *decide(input, ctx) {
    const id = yield* ctx.newId(device);
    return {
      events: [ctx.write.trail.device.create({ id, name: input.name })],
      result: { deviceId: id },
    };
  },
});
