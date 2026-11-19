import { binaryCodec } from '@keelwerk/core/wire';
import SuperJson from 'superjson';

/**
 * A superjson instance that knows the Temporal types and bytes of the wire (section 16.7.3):
 * `Temporal.Instant`, `Temporal.PlainDate` and `Uint8Array` travel as custom types, and `bigint`,
 * `Set` and `Map` as superjson carries them. A new instance per call, never the global one, so
 * importing this package changes nothing; a client passes the same as its `transformer`.
 */
export function keelwerkSuperjson(): SuperJson {
  const instance = new SuperJson();
  instance.registerCustom<Temporal.Instant, string>(
    {
      isApplicable: (value): value is Temporal.Instant => value instanceof Temporal.Instant,
      serialize: (instant) => instant.toString(),
      deserialize: (text) => Temporal.Instant.from(text),
    },
    'Temporal.Instant',
  );
  instance.registerCustom<Temporal.PlainDate, string>(
    {
      isApplicable: (value): value is Temporal.PlainDate => value instanceof Temporal.PlainDate,
      serialize: (date) => date.toString({ calendarName: 'never' }),
      deserialize: (text) => Temporal.PlainDate.from(text),
    },
    'Temporal.PlainDate',
  );
  instance.registerCustom<Uint8Array, string>(
    {
      isApplicable: (value): value is Uint8Array => value instanceof Uint8Array,
      serialize: (bytes) => binaryCodec.toWire(bytes),
      // Text that is no unpadded base64url stays as given, so the core's decode refuses it as
      // validation; it is never turned into empty bytes.
      deserialize: (text) => binaryCodec.fromWire(text) ?? (text as unknown as Uint8Array),
    },
    'Uint8Array',
  );
  return instance;
}
