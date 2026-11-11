import { describe, expect, test } from 'vitest';
import { processShapeId } from './process-shape-id.ts';

describe('the stored shape id of a process event', () => {
  test('golden: the hash of the process id and its tracks, 64 lower-case hex characters', () => {
    expect(processShapeId('relay.tally')).toBe(
      '255c4b01143e0956fc30bfbbc397b6f126e18bda7d3a6e93c7b61e3bbe46f954',
    );
    expect(processShapeId('logs.tally')).toBe(
      'd83d140b629172f2d1f7350cfef18035021b941d651fd66a456de129d4ead771',
    );
  });
});
