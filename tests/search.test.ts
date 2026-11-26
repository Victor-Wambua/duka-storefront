import { describe, expect, it } from 'vitest';
import { PRODUCTS } from '../src/data/catalogue';
import { editDistance, searchProducts, tokenize } from '../src/lib/search';

const names = (q: string) => searchProducts(PRODUCTS, q).map((p) => p.slug);

describe('catalogue sanity', () => {
  it('has around forty products with unique ids and integer prices', () => {
    expect(PRODUCTS.length).toBeGreaterThanOrEqual(40);
    expect(new Set(PRODUCTS.map((p) => p.id)).size).toBe(PRODUCTS.length);
    const variantIds = PRODUCTS.flatMap((p) => p.variants.map((v) => v.id));
    expect(new Set(variantIds).size).toBe(variantIds.length);
    for (const p of PRODUCTS) {
      for (const v of p.variants) {
        expect(Number.isInteger(v.price) && v.price > 0).toBe(true);
        expect(Number.isInteger(v.stock) && v.stock >= 0).toBe(true);
      }
    }
  });
});

describe('editDistance', () => {
  it('counts insertions, deletions, substitutions and transpositions', () => {
    expect(editDistance('sufuria', 'sufuria')).toBe(0);
    expect(editDistance('sufria', 'sufuria')).toBe(1);
    expect(editDistance('sufuira', 'sufuria')).toBe(1); // transposition
    expect(editDistance('sugar', 'sukari')).toBeGreaterThan(1);
  });
});

describe('searchProducts', () => {
  it('returns everything for an empty query', () => {
    expect(searchProducts(PRODUCTS, '  ')).toHaveLength(PRODUCTS.length);
  });
  it('matches by name prefix as you type', () => {
    expect(names('suf')[0]).toBe('sufuria');
    expect(names('mai')).toContain('maize-flour');
  });
  it('matches Swahili and common alternative names via tags', () => {
    expect(names('unga')[0]).toBe('maize-flour');
    expect(names('chai')).toContain('tea-leaves');
    expect(names('mchele')[0]).toBe('pishori-rice');
  });
  it('tolerates typos', () => {
    expect(names('sufria')[0]).toBe('sufuria');
    expect(names('cookng oil')[0]).toBe('cooking-oil');
    expect(names('blenket')).toContain('fleece-blanket');
    expect(names('kahwa')).toContain('ground-coffee');
  });
  it('requires every word to match', () => {
    expect(names('maize flour')[0]).toBe('maize-flour');
    expect(names('maize sufuria')).toEqual([]);
  });
  it('matches variant labels, such as colours', () => {
    expect(names('teal')).toContain('plastic-basin');
  });
  it('does not fuzzy-match very short words', () => {
    expect(names('xq')).toEqual([]);
  });
  it('ranks name matches above tag matches', () => {
    const r = names('soap');
    expect(['laundry-bar', 'bathing-soap']).toContain(r[0]);
  });
  it('ignores diacritics and case', () => {
    expect(tokenize('Sautéed CHAI')).toEqual(['sauteed', 'chai']);
    expect(names('CHAI')).toContain('tea-leaves');
  });
});
