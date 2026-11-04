import { kebab } from '@keelwerk/core';
import { usageFailure } from '../context/usage-failure.ts';
import { isModuleId } from './is-module-id.ts';

const SEGMENT = /^[A-Za-z][A-Za-z0-9]*(-[A-Za-z0-9]+)*$/;

/** A reference split into the module (or app, script) id and the kebab-case names after it. */
export interface ParsedReference {
  readonly target: string;
  readonly names: readonly string[];
}

/**
 * `mail-store.mailboxEntry` becomes `mail-store` and `['mailbox-entry']` (section 23.14). The
 * first segment is an id and stays as written; every later segment is a name, camel or kebab.
 */
export function parseReference(text: string): ParsedReference {
  const [target, ...rest] = text.split('.');
  if (target === undefined || !isModuleId(target)) {
    throw usageFailure(`"${text}" does not start with a kebab-case module id.`);
  }
  for (const segment of rest) {
    if (!SEGMENT.test(segment)) {
      throw usageFailure(`"${segment}" in "${text}" is not a name in camel case or kebab-case.`);
    }
  }
  return { target, names: rest.map((segment) => kebab(segment)) };
}
