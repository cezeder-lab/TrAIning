import { describe, expect, it } from 'vitest';
import { offByBarcode, offSearch } from '../src/index.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Réponse réelle de search.openfoodfacts.org (relevée le 28/09/2026), abrégée. */
const HITS = {
  hits: [
    {
      code: '5690845000621',
      brands: ['isey skyr'],
      quantity: '400 g',
      nutriments: { carbohydrates_100g: 3.8, 'energy-kcal_100g': 71, fat_100g: 2.2, proteins_100g: 9, salt_100g: 0.128, 'saturated-fat_100g': 1.4, sugars_100g: 2.9 },
      product_name: 'Skyr Stracciatella',
      product_name_fr: 'Skyr Stracciatella',
    },
    { code: '3760002444093', quantity: '110 g', product_name: 'skyr', product_name_fr: 'skyr' },
  ],
  page: 1,
  page_size: 2,
  count: 1550,
};

describe('Open Food Facts', () => {
  it('recherche via search-a-licious (marques en tableau, produits sans valeurs ignorés)', async () => {
    const urls: string[] = [];
    const res = await offSearch(async (url) => (urls.push(url), json(HITS)), 'skyr');
    expect(urls[0]).toMatch(/^https:\/\/search\.openfoodfacts\.org\/search\?q=skyr&langs=fr/);
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ sourceRef: '5690845000621', name: 'Skyr Stracciatella', brand: 'isey skyr', kcal: 71, proteinG: 9 });
    expect(res[0]!.portions).toEqual([{ label: 'Produit entier (400 g)', grams: 400 }]);
  });

  it("repli sur l'ancienne recherche quand le nouveau service renvoie 503", async () => {
    const urls: string[] = [];
    const res = await offSearch(async (url) => {
      urls.push(url);
      return url.includes('search.openfoodfacts.org')
        ? new Response('Service Unavailable', { status: 503 })
        : json({ products: [{ code: '1', product_name: 'Skyr nature', brands: 'Siggi, Autre', nutriments: { 'energy-kcal_100g': 60, proteins_100g: 10, fat_100g: 0.2 } }] });
    }, 'skyr');
    expect(urls).toHaveLength(2);
    expect(urls[1]).toContain('/cgi/search.pl');
    expect(res[0]).toMatchObject({ name: 'Skyr nature', brand: 'Siggi', kcal: 60 });
  });

  it('message explicite si les deux recherches échouent', async () => {
    await expect(offSearch(async () => new Response('', { status: 503 }), 'skyr')).rejects.toThrow(/HTTP 503.*réessayez plus tard/);
  });

  it('code-barres', async () => {
    const p = await offByBarcode(
      async () => json({ status: 1, product: { product_name: 'Nutella', brands: 'Nutella, Ferrero', quantity: '400 g e', nutriments: { 'energy-kcal_100g': 539, proteins_100g: 6.3, fat_100g: 30.9 } } }),
      '3017620422003',
    );
    expect(p).toMatchObject({ sourceRef: '3017620422003', name: 'Nutella', brand: 'Nutella', kcal: 539 });
  });
});
