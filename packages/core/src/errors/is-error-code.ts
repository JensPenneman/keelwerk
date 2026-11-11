const codePattern = /^[a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*\.[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/;

/** The longest stable error code a record or a wire error carries. */
const maxLength = 128;

/**
 * Whether `code` has the form of a registered stable error code (section 10): `<module>.<snake_case>`
 * in lower-case ASCII, so no space, "@" or other free text, and of bounded length.
 */
export function isErrorCode(code: string): boolean {
  return code.length <= maxLength && codePattern.test(code);
}
