import type { StandardSchemaV1 } from '../../fields/standard-schema-v1.ts';

const standard = {
  version: 1 as const,
  vendor: 'keelwerk',
  validate: (value: unknown) =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? { value: { ...value } as Record<string, unknown> }
      : { issues: [{ message: 'Expected an object of module configuration.' }] },
  /** Standard JSON Schema, so the surface can describe the field (section 16.2.3). */
  jsonSchema: {
    input: () => ({ type: 'object' }),
    output: () => ({ type: 'object' }),
  },
};

/** The schema of a backend's `config`: a record of per-module configuration, checked per module at `compose`. */
export const configSchema: StandardSchemaV1<Record<string, unknown>, Record<string, unknown>> = {
  '~standard': standard,
};
