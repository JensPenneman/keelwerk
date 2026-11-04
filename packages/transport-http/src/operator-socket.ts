import { chmod, lstat, mkdir, unlink } from 'node:fs/promises';
import { connect } from 'node:net';
import { dirname } from 'node:path';

async function inUse(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = connect(path);
    probe.once('connect', () => {
      probe.destroy();
      resolve(true);
    });
    probe.once('error', () => resolve(false));
  });
}

/**
 * Prepares the directory of the operator socket: a directory this process creates gets mode 0700;
 * an existing one must already be 0700 and owned by this user, because connecting to the socket is
 * proof of operator access (section 16.8.3). A stale socket file is removed, a live one refused.
 */
export async function operatorSocket(path: string, uid: number): Promise<void> {
  const directory = dirname(path);
  const created = await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(
      `The operator socket directory ${directory} must be a real directory, not a link.`,
    );
  }
  if (info.uid !== uid) {
    throw new Error(`The operator socket directory ${directory} is not owned by this user.`);
  }
  if ((info.mode & 0o077) !== 0) {
    if (created === undefined) {
      throw new Error(`The operator socket directory ${directory} must have mode 0700.`);
    }
    await chmod(directory, 0o700);
  }
  const existing = await lstat(path).catch(() => undefined);
  if (existing !== undefined) {
    if (!existing.isSocket()) {
      throw new Error(`${path} exists and is not a socket.`);
    }
    if (await inUse(path)) {
      throw new Error(`The operator socket ${path} is in use by another process.`);
    }
    await unlink(path);
  }
}
