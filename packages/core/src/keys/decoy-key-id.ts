/**
 * The id of a data key that no row holds. A lookup by a personal value that finds no row reads it
 * through the unit's key cache, where a found row reads the key of its sealed column, so the two
 * lookups make the same call on the key store. The store answers nothing for it.
 */
export const decoyKeyId: string = '00000000-0000-4000-8000-00000000dec1';
