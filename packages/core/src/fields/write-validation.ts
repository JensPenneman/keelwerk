import type { StandardValidateOptions } from './standard-schema-v1.ts';

/**
 * The options a write passes to a schema's `~standard.validate`: a keelwerk shape then refuses a
 * subject id that is not in lower case (decision 24), and any other schema ignores them. A shape a
 * module builds by hand, not through `shape()`, receives the option and may ignore it; the refusal
 * at the store is the backstop for that case.
 */
export const writeValidation: StandardValidateOptions = {
  libraryOptions: { keelwerkWrite: true },
};
