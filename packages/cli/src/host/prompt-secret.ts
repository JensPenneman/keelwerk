import { stderr, stdin } from 'node:process';

/** One line from the terminal without echo; Ctrl-C ends the prompt as an interrupt. */
export function promptSecret(label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    stderr.write(`${label}: `);
    let secret = '';
    if (!stdin.isTTY) {
      reject(new Error('Standard input is not a terminal.'));
      return;
    }
    stdin.setRawMode(true);
    stdin.resume();
    const onData = (chunk: Buffer) => {
      for (const character of chunk.toString('utf8')) {
        if (character === '\u0003') {
          finish();
          reject(Object.assign(new Error('Interrupted.'), { name: 'AbortError' }));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          resolve(secret);
          return;
        }
        secret = character === '\u007f' ? secret.slice(0, -1) : secret + character;
      }
    };
    const finish = () => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stderr.write('\n');
    };
    stdin.on('data', onData);
  });
}
