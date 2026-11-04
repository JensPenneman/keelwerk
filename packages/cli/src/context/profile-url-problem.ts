/** Whether a host name is a loopback address (`localhost`, 127.0.0.0/8, `::1`). */
function isLoopback(hostname: string): boolean {
  const host = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  return host === 'localhost' || host === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/**
 * Why a profile URL is refused, or `undefined` when it is fine: `https://`, `unix://`, and
 * `http://` only for loopback hosts (section 16.9.6, S-42).
 */
export function profileUrlProblem(text: string): string | undefined {
  if (!URL.canParse(text)) {
    return `"${text}" is not a URL.`;
  }
  const url = new URL(text);
  if (url.protocol === 'https:') {
    return undefined;
  }
  if (url.protocol === 'unix:') {
    return url.pathname.length > 1 ? undefined : 'A unix:// URL needs a socket path.';
  }
  if (url.protocol === 'http:') {
    return isLoopback(url.hostname)
      ? undefined
      : `http:// is accepted for loopback hosts only; use https:// for ${url.hostname}.`;
  }
  return `Unsupported scheme "${url.protocol.slice(0, -1)}"; use https://, unix:// or http:// to a loopback host.`;
}
