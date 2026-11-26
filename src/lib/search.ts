import { categoryName } from '../data/catalogue';
import type { Product } from '../types';

const strip = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

export function tokenize(s: string): string[] {
  return strip(s)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Damerau-Levenshtein (optimal string alignment) distance, with an early cap. */
export function editDistance(a: string, b: string, cap = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const prev2: number[] = [];
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2]! + 1);
      }
      cur[j] = v;
    }
    prev2.length = 0;
    prev2.push(...prev);
    prev = cur;
  }
  return prev[b.length]!;
}

function allowedTypos(len: number): number {
  if (len <= 3) return 0;
  if (len <= 6) return 1;
  return 2;
}

/** Lower is better. Infinity = no match. */
function tokenScore(q: string, word: string): number {
  if (q === word) return 0;
  if (word.startsWith(q)) return 1 + (word.length - q.length) * 0.01;
  if (q.length >= 3 && word.includes(q)) return 2;
  const typos = allowedTypos(q.length);
  if (typos === 0) return Infinity;
  const d = Math.min(editDistance(q, word, typos), editDistance(q, word.slice(0, q.length + 1), typos) + 0.5);
  return d <= typos ? 3 + d : Infinity;
}

interface Indexed {
  product: Product;
  name: string[];
  other: string[];
}

const indexCache = new WeakMap<Product[], Indexed[]>();

function index(products: Product[]): Indexed[] {
  let idx = indexCache.get(products);
  if (!idx) {
    idx = products.map((product) => ({
      product,
      name: tokenize(product.name),
      other: [
        ...product.tags.flatMap(tokenize),
        ...tokenize(categoryName(product.category)),
        ...tokenize(product.blurb),
        ...product.variants.flatMap((v) => tokenize(v.label)),
      ],
    }));
    indexCache.set(products, idx);
  }
  return idx;
}

/**
 * Instant, typo-tolerant search. Every query word must match something
 * (name, tags, category, blurb, variant labels); matches in the name count
 * for more. Results come back best first; an empty query returns everything.
 */
export function searchProducts(products: Product[], query: string): Product[] {
  const qs = tokenize(query);
  if (qs.length === 0) return products;
  const scored: { product: Product; score: number }[] = [];
  for (const entry of index(products)) {
    let total = 0;
    let ok = true;
    for (const q of qs) {
      let best = Infinity;
      for (const w of entry.name) best = Math.min(best, tokenScore(q, w));
      for (const w of entry.other) best = Math.min(best, tokenScore(q, w) + 0.75);
      if (best === Infinity) {
        ok = false;
        break;
      }
      total += best;
    }
    if (ok) scored.push({ product: entry.product, score: total });
  }
  scored.sort((a, b) => a.score - b.score || a.product.name.localeCompare(b.product.name));
  return scored.map((s) => s.product);
}
