import type { StandardIssue, StandardSchemaV1 } from '../fields/standard-schema-v1.ts';

const mostMembers = 1000;
const mostKeyLength = 200;
const mostValueLength = 40;

const documentSchema = {
  type: 'object',
  maxProperties: mostMembers,
  propertyNames: { minLength: 1, maxLength: mostKeyLength },
  additionalProperties: {
    type: 'string',
    minLength: 1,
    maxLength: mostValueLength,
    not: { const: 'default' },
  },
};

const standard = {
  version: 1 as const,
  vendor: 'keelwerk',
  validate: (value: unknown) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { issues: [{ message: 'Expected an object of dimensions and limits.' }] };
    }
    const entries = Object.entries(value);
    if (entries.length > mostMembers) {
      return { issues: [{ message: `At most ${mostMembers} dimensions are allowed.` }] };
    }
    const issues: StandardIssue[] = [];
    const checked: [string, string][] = [];
    for (const [dimension, limit] of entries) {
      if (dimension.length < 1 || dimension.length > mostKeyLength) {
        issues.push({
          message: `A dimension is 1 to ${mostKeyLength} characters.`,
          path: [dimension],
        });
      } else if (typeof limit !== 'string') {
        issues.push({ message: 'A limit is a text.', path: [dimension] });
      } else if (limit === 'default') {
        issues.push({ message: 'Leave the dimension out to read the default.', path: [dimension] });
      } else if (limit.length < 1 || limit.length > mostValueLength) {
        issues.push({
          message: `A limit is 1 to ${mostValueLength} characters.`,
          path: [dimension],
        });
      } else {
        checked.push([dimension, limit]);
      }
    }
    return issues.length > 0 ? { issues } : { value: Object.fromEntries(checked) };
  },
  jsonSchema: { input: () => documentSchema, output: () => documentSchema },
};

/**
 * `config.core.quotas` as the shape holds it: a plain object of at most 1000 members, from a
 * dimension (1 to 200 characters) to a limit text (a string of 1 to 40 characters that is not
 * `default`; a dimension left out reads the default). That the dimension exists and the text
 * parses is checked at creation against the backend's app. The value returned is a copy.
 */
export const backendQuotasSchema: StandardSchemaV1<
  Record<string, string>,
  Record<string, string>
> = {
  '~standard': standard,
};
