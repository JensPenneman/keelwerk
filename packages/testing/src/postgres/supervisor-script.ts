/**
 * The entrypoint of a restartable container: the image's own entrypoint runs in the background and
 * this shell stays as the container's first process. After the server was shut down by `stopServer`
 * the container goes on, and a stop of the container (INT or TERM) shuts a running server down fast
 * before the shell ends.
 */
export const supervisorScript = [
  'down() {',
  '  if [ -r "$PGDATA/postmaster.pid" ]; then',
  '    kill -INT "$(head -n 1 "$PGDATA/postmaster.pid")" 2>/dev/null',
  '    while [ -r "$PGDATA/postmaster.pid" ]; do sleep 1; done',
  '  fi',
  '  exit 0',
  '}',
  'trap down INT TERM',
  'docker-entrypoint.sh "$@" &',
  'while :; do sleep 1 & wait $!; done',
].join('\n');
