import type { KeelwerkError } from '../errors/keelwerk-error.ts';
import type { AnyField } from '../fields/field-def.ts';
import { compositionRefusal } from './composition-refusal.ts';
import { isPlainName } from './is-plain-name.ts';

/** A TypeID prefix: lower-case letters and underscores, starting and ending with a letter (TypeID 0.3.0). */
const typeIdPrefix = /^[a-z](?:[a-z_]{0,61}[a-z])?$/;

/** The longest text a `contains` capability may cover (section 14.7.9.2, decision point 72). */
const containsMaxLength = 1024;

function problem(
  name: string,
  entityPrefix: string,
  field: string | null,
  message: string,
): KeelwerkError {
  return compositionRefusal({
    code: name,
    severity: 'error',
    message,
    ref: field === null ? entityPrefix : `${entityPrefix}.${field}`,
  });
}

/**
 * The refusals of `defineEntity` (sections 14.7.9.2 and 6.4), each a named compose problem:
 * `invalidTypeIdPrefix`, `uniquePersonalFieldTruncatedTags` (`eq.bits`),
 * `uniquePersonalFieldSubjectKeys` (`keys: 'subject'`), `containsNeedsMaxLength` and
 * `invalidFieldName` (14.4.2).
 */
export function refuseEntityDefinition(definition: {
  readonly prefix: string;
  readonly fields: { readonly [name: string]: AnyField };
  readonly indexes?: readonly {
    readonly fields: readonly string[];
    readonly unique?: boolean;
  }[];
}): void {
  const { prefix } = definition;
  if (!typeIdPrefix.test(prefix)) {
    throw problem(
      'invalidTypeIdPrefix',
      prefix,
      null,
      `'${prefix}' is not a TypeID prefix: lower-case letters and underscores, starting and ending with a letter.`,
    );
  }
  for (const name of Object.keys(definition.fields)) {
    if (!isPlainName(name)) {
      throw problem(
        'invalidFieldName',
        prefix,
        name,
        `'${name}' must be camelCase without consecutive capitals, because physical names snake-case it.`,
      );
    }
  }
  const uniqueByIndex = new Set(
    (definition.indexes ?? []).filter((index) => index.unique === true).flatMap((i) => i.fields),
  );
  for (const [name, member] of Object.entries(definition.fields)) {
    const options = member.personalOptions;
    if (options === null) continue;
    const unique =
      member.flags.unique || member.flags.merge === 'exclusive' || uniqueByIndex.has(name);
    if (unique && options.eq?.bits !== undefined) {
      throw problem(
        'uniquePersonalFieldTruncatedTags',
        prefix,
        name,
        `'${name}' is unique, so its equality tag keeps all 128 bits; eq.bits is refused.`,
      );
    }
    if (unique && options.keys === 'subject') {
      throw problem(
        'uniquePersonalFieldSubjectKeys',
        prefix,
        name,
        `'${name}' is unique, so its tags sit under a tenant key; keys: 'subject' is refused.`,
      );
    }
    if (options.queries?.includes('contains') === true) {
      const maxLength = (member.options as { readonly maxLength?: number } | undefined)?.maxLength;
      if (maxLength === undefined || maxLength > containsMaxLength) {
        throw problem(
          'containsNeedsMaxLength',
          prefix,
          name,
          `'${name}' declares contains, which needs a maxLength of at most ${containsMaxLength}; longer text uses search.`,
        );
      }
    }
  }
}
