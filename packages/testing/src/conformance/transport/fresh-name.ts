/** A name no earlier test used, so scenarios sharing one deployment never see each other's rows. */
export function freshName(label: string): string {
  return `${label}-${crypto.randomUUID().slice(0, 8)}`;
}
