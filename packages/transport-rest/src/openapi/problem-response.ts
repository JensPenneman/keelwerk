import { headersOf } from './header-refs.ts';
import type { JsonObject } from './json-object.ts';
import { schemaName } from './schema-name.ts';
import { schemaRef } from './schema-ref.ts';
import { statusTitles } from './status-titles.ts';

/**
 * The problem response of a status: `Problem` alone, or a `oneOf` over the declared problems and
 * a generic `Problem` with a discriminator on `code` (section 16.5.5). Every declared schema is
 * also a `Problem`, so the generic member excludes the declared codes and the `oneOf` stays exclusive.
 */
export function problemResponse(
  status: number,
  codes: readonly string[],
  dialect: '3.1' | '3.2' = '3.1',
): JsonObject {
  const extra = status === 429 || status === 503 ? ['retryAfter'] : [];
  const content =
    codes.length === 0
      ? schemaRef('Problem')
      : {
          oneOf: [
            ...codes.map((code) => schemaRef(schemaName('problem', code))),
            {
              allOf: [schemaRef('Problem')],
              not: { required: ['code'], properties: { code: { enum: [...codes] } } },
            },
          ],
          discriminator: {
            propertyName: 'code',
            mapping: Object.fromEntries(
              codes.map((code) => [code, `#/components/schemas/${schemaName('problem', code)}`]),
            ),
            ...(dialect === '3.2' ? { defaultMapping: '#/components/schemas/Problem' } : {}),
          },
        };
  return {
    description: statusTitles[status] ?? 'Problem',
    headers: headersOf(...extra),
    content: { 'application/problem+json': { schema: content } },
  };
}
