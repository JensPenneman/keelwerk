/** The data of every `event: data` block of raw event-stream text. */
export function dataOfStream(text: string): readonly Record<string, unknown>[] {
  return text
    .split('\n\n')
    .filter((block) => block.split('\n').includes('event: data'))
    .map((block) => {
      const line = block.split('\n').find((candidate) => candidate.startsWith('data: '));
      return JSON.parse(line?.slice(6) ?? 'null') as Record<string, unknown>;
    });
}
