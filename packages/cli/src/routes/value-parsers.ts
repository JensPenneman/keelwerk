import { parseTypeId } from '@keelwerk/core';
import type { CliContext } from '../context/cli-context.ts';
import { usageFailure } from '../context/usage-failure.ts';
import { readArgumentText } from './read-argument-text.ts';
import type { ValueParser } from './value-parser.ts';

function timeZones(): readonly string[] {
  return ['UTC', ...Intl.supportedValuesOf('timeZone')];
}

/** The parsers of the CLI column of section 16.2.3; each returns the wire form. */
interface ValueParsers {
  readonly string: ValueParser;
  readonly text: ValueParser;
  readonly integer: ValueParser;
  readonly wideInteger: ValueParser;
  readonly decimal: ValueParser;
  readonly float: ValueParser;
  readonly boolean: ValueParser;
  readonly instant: ValueParser;
  readonly date: ValueParser;
  readonly timeZone: ValueParser;
  readonly timeZoneNames: (partial: string) => readonly string[];
  readonly typeId: (prefix: string) => ValueParser;
  readonly json: ValueParser;
  readonly binary: ValueParser;
  readonly richText: ValueParser;
}

export const valueParsers: ValueParsers = {
  string: (input) => input,
  /** `text`, `json`, `binary` and `richText` accept `@file`. */
  text: async function (this: CliContext, input: string) {
    return await readArgumentText(this, input);
  },
  integer: (input) => {
    if (!/^-?\d+$/.test(input) || !Number.isSafeInteger(Number(input))) {
      throw usageFailure(`"${input}" is not an integer.`);
    }
    return Number(input);
  },
  /** A wide integer travels as a decimal string. */
  wideInteger: (input) => {
    try {
      return BigInt(input).toString();
    } catch {
      throw usageFailure(`"${input}" is not an integer.`);
    }
  },
  decimal: (input) => {
    if (!/^-?\d+(\.\d+)?$/.test(input)) {
      throw usageFailure(`"${input}" is not a decimal number.`);
    }
    return input;
  },
  float: (input) => {
    const number = Number(input);
    if (input.trim() === '' || !Number.isFinite(number)) {
      throw usageFailure(`"${input}" is not a number.`);
    }
    return number;
  },
  boolean: (input) => {
    if (['true', 'yes', '1'].includes(input.toLowerCase())) {
      return true;
    }
    if (['false', 'no', '0'].includes(input.toLowerCase())) {
      return false;
    }
    throw usageFailure(`"${input}" is not true or false.`);
  },
  /** RFC 3339 or `now`, normalised to UTC with `Z`. */
  instant: function (this: CliContext, input: string) {
    if (input === 'now') {
      return Temporal.Instant.fromEpochMilliseconds(this.host.now()).toString();
    }
    try {
      return Temporal.Instant.from(input).toString();
    } catch {
      throw usageFailure(`"${input}" is not an RFC 3339 instant (2026-11-05T09:30:00Z) or "now".`);
    }
  },
  date: (input) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
      throw usageFailure(`"${input}" is not a date (YYYY-MM-DD).`);
    }
    try {
      return Temporal.PlainDate.from(input).toString();
    } catch {
      throw usageFailure(`"${input}" is not a calendar date.`);
    }
  },
  timeZone: (input) => {
    if (!timeZones().includes(input)) {
      throw usageFailure(`"${input}" is not an IANA time zone.`);
    }
    return input;
  },
  /** The completions for a time zone flag. */
  timeZoneNames: (partial: string): readonly string[] =>
    timeZones().filter((name) => name.toLowerCase().startsWith(partial.toLowerCase())),
  /** A TypeID with the entity's prefix (section 4.4). */
  typeId: (prefix) => (input) => {
    if (parseTypeId(input, prefix) === undefined) {
      throw usageFailure(`"${input}" is not an id of the form ${prefix}_<26 characters>.`);
    }
    return input;
  },
  /** A JSON value, inline or `@file`. */
  json: async function (this: CliContext, input: string) {
    const text = await readArgumentText(this, input);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw usageFailure('The value is not valid JSON.');
    }
  },
  /** Binary data from `@file`, as base64url. */
  binary: async function (this: CliContext, input: string) {
    if (!input.startsWith('@') || input.startsWith('@@')) {
      throw usageFailure('Binary values are given as @file.');
    }
    const path = input.slice(1);
    const bytes = await this.host.files.readBytes(
      path.startsWith('/') ? path : `${this.host.cwd}/${path}`,
    );
    return Buffer.from(bytes).toString('base64url');
  },
  /** Rich text from `@file`. */
  richText: async function (this: CliContext, input: string) {
    if (!input.startsWith('@') || input.startsWith('@@')) {
      throw usageFailure('Rich text values are given as @file.');
    }
    return await readArgumentText(this, input);
  },
};
