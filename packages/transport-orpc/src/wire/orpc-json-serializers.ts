import { binaryCodec, dateCodec, instantCodec } from '@keelwerk/core/wire';
import type { RPCHandlerOptions } from '@orpc/server/fetch';

/** The wire string of a custom type, which the serialiser sends and the client revives; anything else is a protocol breach. */
function textOf(serialized: unknown, type: string): string {
  if (typeof serialized !== 'string') {
    throw new TypeError(`A ${type} is carried as a string.`);
  }
  return serialized;
}

function revived<T>(value: T | undefined, type: string): T {
  if (value === undefined) {
    throw new TypeError(`The string is not a valid ${type}.`);
  }
  return value;
}

/**
 * The custom types the oRPC serialiser carries beside its own (section 16.7.3): type 20 is a
 * `Temporal.Instant` (RFC 3339 in UTC), 21 a `Temporal.PlainDate` (`YYYY-MM-DD`) and 22 a
 * `Uint8Array` (unpadded base64url), because oRPC carries none of them. Clients pass this list as
 * `RPCLink({ customJsonSerializers: orpcJsonSerializers })`. `deserialize` throws a `TypeError` on a
 * value that is not a string or does not decode.
 */
export const orpcJsonSerializers: NonNullable<
  RPCHandlerOptions<Record<never, never>>['customJsonSerializers']
> = [
  {
    type: 20,
    condition: (data) => data instanceof Temporal.Instant,
    serialize: (data: Temporal.Instant) => instantCodec.toWire(data),
    deserialize: (serialized: unknown) =>
      revived(instantCodec.fromWire(textOf(serialized, 'instant')), 'instant'),
  },
  {
    type: 21,
    condition: (data) => data instanceof Temporal.PlainDate,
    serialize: (data: Temporal.PlainDate) => dateCodec.toWire(data),
    deserialize: (serialized: unknown) =>
      revived(dateCodec.fromWire(textOf(serialized, 'date')), 'date'),
  },
  {
    type: 22,
    condition: (data) => data instanceof Uint8Array,
    serialize: (data: Uint8Array) => binaryCodec.toWire(data),
    deserialize: (serialized: unknown) =>
      revived(binaryCodec.fromWire(textOf(serialized, 'binary value')), 'binary value'),
  },
];
