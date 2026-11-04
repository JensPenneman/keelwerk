import type { StandardSchemaV1 } from '@keelwerk/core';

/** One GPS fix as a client posts it. */
export interface PositionFix {
  readonly at: string;
  readonly lat: number;
  readonly lon: number;
}

function isFix(value: unknown): value is PositionFix {
  if (typeof value !== 'object' || value === null) return false;
  const { at, lat, lon } = value as Record<string, unknown>;
  return typeof at === 'string' && typeof lat === 'number' && typeof lon === 'number';
}

const fixJsonSchema = {
  type: 'object',
  required: ['at', 'lat', 'lon'],
  properties: { at: { type: 'string' }, lat: { type: 'number' }, lon: { type: 'number' } },
};

const standard = {
  version: 1 as const,
  vendor: 'spike',
  validate: (value: unknown) =>
    isFix(value)
      ? { value }
      : { issues: [{ message: 'A fix needs a time (text), lat and lon (numbers).' }] },
  /** Standard JSON Schema, so the surface can describe the field. */
  jsonSchema: { input: () => fixJsonSchema, output: () => fixJsonSchema },
};

/** The input schema of one fix, checked by hand so the spike needs no schema library. */
export const positionFix: StandardSchemaV1<unknown, PositionFix> = { '~standard': standard };
