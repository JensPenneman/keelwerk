import { stderr, stdin } from 'node:process';
import { createInterface } from 'node:readline/promises';

/** One line from the terminal, echoed as it is typed; the label is printed as given. */
export async function promptLine(label: string): Promise<string> {
  const lines = createInterface({ input: stdin, output: stderr, terminal: stdin.isTTY === true });
  try {
    return await lines.question(label);
  } finally {
    lines.close();
  }
}
