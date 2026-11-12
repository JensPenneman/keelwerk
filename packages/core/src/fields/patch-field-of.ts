import { errors } from '../errors/errors.ts';
import type { AnyField } from './field-def.ts';

/** A builder method of a patch member: it refuses, because the member is never rebuilt. */
function notRebuilt(): never {
  throw errors.internal('A patch member is not rebuilt: build the patch from the declared field.');
}

/**
 * The member of a patch (section 6.7): the field made optional and without its default, so an
 * absent member stays absent. This is the field twin of `patchMemberOf` (surface/patch-member-of.ts).
 * The builder methods of the result throw an internal error: they would rebuild the declared
 * field, and a patch built from the rebuilt field would fill the default again.
 */
export function patchFieldOf(member: AnyField): AnyField {
  const optional = member.flags.optional ? member : member.optional();
  const flags = optional.flags.defaulted ? { ...optional.flags, defaulted: false } : optional.flags;
  return {
    ...optional,
    defaultValue: undefined,
    flags,
    optional: notRebuilt,
    default: notRebuilt,
    unique: notRebuilt,
    index: notRebuilt,
    hidden: notRebuilt,
    maskable: notRebuilt,
    personal: notRebuilt,
    stateOnly: notRebuilt,
    merge: notRebuilt,
    tag: notRebuilt,
    describe: notRebuilt,
    deprecated: notRebuilt,
  };
}
