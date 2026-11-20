/** The first `max` code points of `text`, counted as the validation of a string field counts them. */
export function clipText(text: string, max: number): string {
  const points = [...text];
  return points.length <= max ? text : points.slice(0, max).join('');
}
