/** Splits text chunks into lines: `push` hands over every complete line, `flush` the rest. */
export interface LineBuffer {
  push(text: string): void;
  flush(): void;
}

export function lineBuffer(onLine: (line: string) => void): LineBuffer {
  let rest = '';
  return {
    push: (text) => {
      const lines = `${rest}${text}`.split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) onLine(line.replace(/\r$/, ''));
    },
    flush: () => {
      if (rest !== '') onLine(rest);
      rest = '';
    },
  };
}
