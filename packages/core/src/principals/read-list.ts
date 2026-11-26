import { refusePrincipal } from './refuse-principal.ts';

/**
 * The members of an answered list, each read once into an array of the kernel's own: the length is
 * read once and each index once. No method of the answered value is called, so nothing it answers
 * can choose what the copy is made of.
 */
export function readList(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) return refusePrincipal(path);
  const length: unknown = value.length;
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) {
    return refusePrincipal(path);
  }
  return Array.from({ length }, (_, index) => value[index] as unknown);
}
