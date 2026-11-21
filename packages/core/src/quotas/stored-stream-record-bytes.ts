import { processStateStream } from '../reactions/process-state-stream.ts';

/**
 * What stream records cost under `core.eventBytes`: the bytes of each record as the JSON text the
 * store keeps (sealed, as it is stored). Zero for the process state cache, which the framework
 * replaces itself at every fold (`writeProcessStateCache` purges the instance's records first).
 * Every other stream, the effect attempts included, keeps its records until a declared retention
 * or an erasure removes them.
 */
export function storedStreamRecordBytes(stream: string, records: readonly unknown[]): bigint {
  if (stream === processStateStream) return 0n;
  let bytes = 0n;
  for (const record of records) bytes += BigInt(Buffer.byteLength(JSON.stringify(record)));
  return bytes;
}
