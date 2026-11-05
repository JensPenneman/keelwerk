import type { CliContext } from '../context/cli-context.ts';
import { outputFormats } from '../output/output-formats.ts';
import type { FlagParameter } from './flag-parameter.ts';
import { valueParsers } from './value-parsers.ts';

function parsed(
  brief: string,
  placeholder: string,
  parse: (this: CliContext, input: string) => unknown = (input) => input,
  inferEmpty = false,
): FlagParameter {
  return {
    kind: 'parsed',
    parse,
    brief,
    placeholder,
    optional: true,
    ...(inferEmpty && { inferEmpty }),
  } as unknown as FlagParameter;
}

/** Seconds to wait; the flag without a value means no limit. */
function waitSeconds(this: CliContext, input: string): unknown {
  return input === '' ? null : valueParsers.integer.call(this, input);
}

function toggle(brief: string): FlagParameter {
  return { kind: 'boolean', brief, optional: true, withNegated: false } as unknown as FlagParameter;
}

/** The flags of every action command (section 16.9.4). Backend, tenant and profile are read before the tree is built. */
export function commonFlags(): Readonly<Record<string, FlagParameter>> {
  return {
    profile: parsed('The profile to use.', 'name'),
    backend: parsed('The backend to address.', 'id'),
    tenant: parsed('The tenant to address.', 'id'),
    socket: parsed('The operator socket to use instead of a profile.', 'path'),
    config: parsed('The deployment file of the project.', 'path'),
    output: {
      kind: 'enum',
      values: outputFormats,
      brief: 'The output format.',
      optional: true,
    } as unknown as FlagParameter,
    fields: parsed('The fields to print, comma separated.', 'a,b'),
    input: parsed('The whole input as JSON, @file or - for standard input.', 'json|@file|-'),
    async: toggle('Accept the command and return its receipt.'),
    wait: parsed(
      'Waits until an accepted command settles, then prints its value or error; no limit without seconds.',
      'seconds',
      waitSeconds,
      true,
    ),
    'wait-effects': parsed(
      'Refused in this release: live updates are not served.',
      'seconds',
      waitSeconds,
      true,
    ),
    'command-id': parsed('The command id; defaults to a fresh UUIDv7.', 'uuid'),
    'if-version': parsed(
      'Apply only if the row is still at this version.',
      'version',
      valueParsers.integer,
    ),
    explain: toggle('Print the pipeline stages and matched rules (operator and development).'),
    trace: toggle('Print the trace id.'),
  };
}
