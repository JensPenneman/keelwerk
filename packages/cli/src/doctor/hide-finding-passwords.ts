import type { DoctorFinding } from './doctor-finding.ts';

/** `scheme://user:`. The lookbehind lets a match start only at the start of a scheme, so a long text is read once. */
const userinfo = /(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:/gi;

const word = /\S*/y;

/** What follows the colon when it is a port: digits, then a slash or the end of the word. */
const port = /\d+(?:\/|\s|$)/y;

/** A key that ends in `password` (any case: password, sslpassword, PGPASSWORD), an equals sign or a colon, and the value: bare, or in single or double quotes. */
const passwordKey = /(password["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s&;,"'}]*)/gi;

/** The password of each `scheme://user:password@host`: everything from the colon after the user to the last at sign of the word, slashes included. Each word is scanned once, whatever the number of schemes in it. */
function hideUserinfoPasswords(text: string): string {
  let hidden = '';
  let copied = 0;
  let wordEnd = -1;
  let at = -1;
  for (const match of text.matchAll(userinfo)) {
    const from = match.index + match[0].length;
    if (match.index < copied) continue;
    port.lastIndex = from;
    if (port.test(text)) continue;
    if (from > wordEnd) {
      word.lastIndex = from;
      wordEnd = from + (word.exec(text)?.[0].length ?? 0);
      const lastAt = text.slice(from, wordEnd).lastIndexOf('@');
      at = lastAt < 0 ? -1 : from + lastAt;
    }
    if (at < from) continue;
    hidden += `${text.slice(copied, from)}[hidden]`;
    copied = at;
  }
  return hidden + text.slice(copied);
}

function hidePasswords(text: string): string {
  return hideUserinfoPasswords(text).replace(passwordKey, '$1[hidden]');
}

/**
 * The finding with, in its subject, message and fix, the password of anything shaped like
 * `scheme://user:password@` and the value of a key that ends in `password` hidden. These shapes
 * are all it knows: a password quoted bare, anywhere else, is not recognised; the value of
 * `password = true` is hidden with the rest; and a password made of digits before a slash is read
 * as a port and not hidden.
 */
export function hideFindingPasswords(finding: DoctorFinding): DoctorFinding {
  return {
    ...finding,
    subject: hidePasswords(finding.subject),
    message: hidePasswords(finding.message),
    fix: hidePasswords(finding.fix),
  };
}
