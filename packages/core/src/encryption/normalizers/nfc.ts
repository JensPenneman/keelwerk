/** `nfc`, the default of string fields: Unicode normalisation form C, so a composed and a decomposed "é" are equal (14.7.9.3). */
export function nfc(value: string): string {
  return value.normalize('NFC');
}
