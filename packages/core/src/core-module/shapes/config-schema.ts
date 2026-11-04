import type { StandardSchemaV1 } from '../../fields/standard-schema-v1.ts';

/** The schema of a backend's `config`: a record of per-module configuration, checked per module at `compose`. */
export const configSchema: StandardSchemaV1<Record<string, unknown>, Record<string, unknown>> = {
  '~standard': {
    version: 1,
    vendor: 'keelwerk',
    validate: (value) =>
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? { value: { ...value } }
        : { issues: [{ message: 'Expected an object of module configuration.' }] },
  },
};
