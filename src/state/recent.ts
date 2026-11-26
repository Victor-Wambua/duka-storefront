import { createStore } from '../lib/persist';

const MAX = 8;

export const recentStore = createStore<string[]>({
  key: 'duka.recent',
  version: 1,
  initial: () => [],
  validate: (d) => (Array.isArray(d) ? d.filter((x): x is string => typeof x === 'string').slice(0, MAX) : null),
});

export function pushRecent(list: string[], slug: string): string[] {
  return [slug, ...list.filter((s) => s !== slug)].slice(0, MAX);
}

export function trackViewed(slug: string): void {
  const cur = recentStore.get();
  if (cur[0] === slug) return;
  recentStore.set(pushRecent(cur, slug));
}
