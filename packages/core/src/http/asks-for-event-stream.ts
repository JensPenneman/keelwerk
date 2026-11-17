/** Whether `Accept` names `text/event-stream` (case-insensitive, parameters allowed) with a quality above zero. */
export function asksForEventStream(request: Request): boolean {
  const accept = request.headers.get('accept');
  if (accept === null) return false;
  return accept.split(',').some((range) => {
    const [type = '', ...parameters] = range.split(';').map((part) => part.trim());
    if (type.toLowerCase() !== 'text/event-stream') return false;
    for (const parameter of parameters) {
      const [name = '', value = ''] = parameter.split('=').map((part) => part.trim());
      if (name.toLowerCase() === 'q') {
        const quality = Number(value);
        return Number.isFinite(quality) && quality > 0;
      }
    }
    return true;
  });
}
