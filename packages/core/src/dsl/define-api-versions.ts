import type { Check } from '../model/check.ts';
import { compositionRefusal } from './composition-refusal.ts';

const dateFormat = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(text: string): boolean {
  if (!dateFormat.test(text)) {
    return false;
  }
  try {
    return Temporal.PlainDate.from(text, { overflow: 'reject' }).toString() === text;
  } catch {
    return false;
  }
}

function refuse(message: string, ref: string): never {
  throw compositionRefusal({ code: 'invalidApiVersions', severity: 'error', message, ref });
}

type BadDates<V> = Exclude<keyof V & string, ApiVersionDate>;

/** A dated API version: `YYYY-MM-DD` (section 18.2). */
type ApiVersionDate = `${number}-${number}-${number}`;

/** One dated version: when it is deprecated and retired, and the app-level changes it adopts. */
export interface ApiVersionEntry {
  readonly deprecated?: { readonly at: string; readonly sunset: string };
  readonly changes?: readonly object[];
}

/** The versions of an app by date, oldest first. */
export type ApiVersionMap = { readonly [date: string]: ApiVersionEntry };

/** The dated API versions of an app or of the core (section 18.2). */
export interface ApiVersions<V extends ApiVersionMap = ApiVersionMap> {
  readonly kind: 'apiVersions';
  readonly versions: V;
  /** The dates, oldest first; the last one is the head. */
  readonly dates: readonly string[];
  /** The newest date. */
  readonly head: string;
}

/**
 * Declares an app's dated API versions, oldest first (section 18.2). The head is the last date.
 * Dates must be calendar dates in strictly increasing order, and a deprecated version names a
 * `sunset` after `at`.
 */
export function defineApiVersions<const V extends ApiVersionMap>(
  versions: V & Check<BadDates<V>, 'invalidApiVersions'>,
): ApiVersions<V> {
  const dates = Object.keys(versions);
  if (dates.length === 0) {
    refuse('defineApiVersions needs at least one version.', 'apiVersions');
  }
  let previous = '';
  for (const date of dates) {
    if (!isCalendarDate(date)) {
      refuse(`'${date}' is not a YYYY-MM-DD calendar date.`, date);
    }
    if (date <= previous) {
      refuse(`'${date}' does not come after '${previous}': versions are oldest first.`, date);
    }
    previous = date;
    const deprecated = versions[date]?.deprecated;
    if (deprecated !== undefined) {
      if (!(isCalendarDate(deprecated.at) && isCalendarDate(deprecated.sunset))) {
        refuse(`The deprecation of '${date}' needs calendar dates.`, date);
      }
      if (deprecated.sunset <= deprecated.at) {
        refuse(`The sunset of '${date}' must come after its deprecation date.`, date);
      }
    }
  }
  return {
    kind: 'apiVersions',
    versions,
    dates,
    head: previous,
  };
}
