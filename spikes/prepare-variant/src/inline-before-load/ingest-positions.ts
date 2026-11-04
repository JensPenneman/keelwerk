import { defineCommand, field, shape } from '@keelwerk/core';
import { deviceUnknown } from '../trail/device-unknown.ts';
import { positionFix } from '../trail/position-fix.ts';
import { trailBase } from '../trail/trail-base.ts';

/** Trail's position ingest in the inline form: no effect, so `decide` is the same as in the separate form. */
export const ingestPositions = defineCommand(trailBase, {
  input: shape({
    deviceId: field.ref.own('device'),
    fixes: field.list(field.json(positionFix)),
  }),
  output: shape({ stored: field.integer(), skipped: field.integer() }),
  errors: [deviceUnknown],
  auth: { public: true },
  *decide(input, ctx) {
    const device = yield* ctx.load.trail.device.byId(input.deviceId);
    if (device === undefined) throw deviceUnknown({ deviceId: input.deviceId });
    const times = input.fixes.map((fix) => Temporal.Instant.from(fix.at));
    const known = yield* ctx.load.trail.position.many({
      where: { deviceId: input.deviceId, at: { in: times } },
      limit: 1000,
    });
    const taken = new Set(known.map((row) => row.at.epochMilliseconds));
    const fresh = input.fixes.filter((fix) => {
      const key = Temporal.Instant.from(fix.at).epochMilliseconds;
      if (taken.has(key)) return false;
      taken.add(key);
      return true;
    });
    if (fresh.length === 0) return { result: { stored: 0, skipped: input.fixes.length } };
    const latest = fresh
      .map((fix) => Temporal.Instant.from(fix.at))
      .reduce((a, b) => (Temporal.Instant.compare(a, b) >= 0 ? a : b));
    return {
      events: [
        ...fresh.map((fix) =>
          ctx.write.trail.position.create({
            deviceId: input.deviceId,
            at: Temporal.Instant.from(fix.at),
            lat: fix.lat,
            lon: fix.lon,
          }),
        ),
        ctx.write.trail.device.updated(device, { lastSeenAt: latest, added: fresh.length }),
      ],
      result: { stored: fresh.length, skipped: input.fixes.length - fresh.length },
    };
  },
});
