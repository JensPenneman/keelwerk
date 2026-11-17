/** A leaf as a description whose items fit the event, so that only the plan can refuse it. */
export const forgedLeaf = (source: unknown) =>
  ({
    kind: 'liveSource',
    source: { kind: 'liveSource', source },
    map: (item: { readonly id: string }) => ({ id: item.id }),
  }) as never;
