import { type DeprecationNotice, sunsetDayOfHeader } from '@keelwerk/core';

function dayOfSeconds(text: string): string | undefined {
  const match = /^@(\d+)$/.exec(text.trim());
  if (match === null) return undefined;
  return Temporal.Instant.fromEpochMilliseconds(Number(match[1]) * 1000)
    .toZonedDateTimeISO('UTC')
    .toPlainDate()
    .toString();
}

/** The notice of an `/invoke` answer: `Deprecation: @<s>` → at (UTC date), `Sunset` → the sunset date (`sunsetDayOfHeader`), a Link to `/_keelwerk/v1/capabilities` → `apiVersion` from `keelwerk-version`, any other deprecation Link → `action`. An action deprecated without a date answers a deprecation Link and no `Deprecation`: its notice has no `at`. Undefined when neither header is there. */
export function deprecationOfHeaders(
  headers: Headers,
  action: string,
): DeprecationNotice | undefined {
  const deprecation = headers.get('deprecation');
  const at = deprecation === null ? undefined : dayOfSeconds(deprecation);
  const links = (headers.get('link') ?? '')
    .split(/,(?=\s*<)/)
    .filter((link) => /rel="?deprecation"?/.test(link));
  const ofVersion = links.some((link) => link.includes('/_keelwerk/v1/capabilities'));
  if (at === undefined && (links.length === 0 || ofVersion)) return undefined;
  const sunsetHeader = headers.get('sunset');
  const sunset = sunsetHeader === null ? undefined : sunsetDayOfHeader(sunsetHeader);
  const version = headers.get('keelwerk-version');
  return {
    kind: 'deprecation',
    ...(ofVersion && version !== null ? { apiVersion: version } : { action }),
    ...(at === undefined ? {} : { at }),
    ...(sunset === undefined ? {} : { sunset }),
  };
}
