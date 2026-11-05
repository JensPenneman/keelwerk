import { domainToASCII } from 'node:url';

/**
 * `email`: trimmed, NFC, the domain through `domainToASCII`, all lower case (14.7.9.3), so
 * `Jens@JensPenneman.com` and `jens@jenspenneman.com` are one value. The part after the last `@`
 * is the domain; a text without `@` is only trimmed, normalised and lower-cased. A domain
 * `domainToASCII` rejects stays as written in lower case.
 */
export function email(value: string): string {
  const text = value.trim().normalize('NFC');
  const at = text.lastIndexOf('@');
  if (at < 0) return text.toLowerCase();
  const domain = text.slice(at + 1);
  const ascii = domainToASCII(domain);
  return `${text.slice(0, at).toLowerCase()}@${(ascii === '' ? domain : ascii).toLowerCase()}`;
}
