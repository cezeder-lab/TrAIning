import { describe, expect, it } from 'vitest';
import { defaultPortionsFor, expandQuery } from '../src/index.ts';

describe('portions usuelles et synonymes', () => {
  it('propose des portions selon le nom', () => {
    expect(defaultPortionsFor('Oeuf, cru')[0]).toEqual({ label: '1 œuf moyen', grams: 50 });
    expect(defaultPortionsFor('Yaourt à la grecque, nature')[0]).toEqual({ label: '1 pot', grams: 150 });
    expect(defaultPortionsFor('Yaourt nature')[0]!.grams).toBe(125);
    expect(defaultPortionsFor('Pâtes sèches, cuites')[0]!.label).toBe('1 assiette');
    expect(defaultPortionsFor('Pomme de terre, frite, cuite')).toEqual([]);
    expect(defaultPortionsFor('Oeuf, jaune, cru')).toEqual([]);
    expect(defaultPortionsFor('Huile d’olive vierge extra')[0]!.label).toBe('1 cuillère à soupe');
  });
  it('étend la requête avec les synonymes', () => {
    expect(expandQuery('Yaourt grec')).toEqual(expect.arrayContaining(['yaourt grec', 'yogourt grec', 'yaourt grecque']));
    expect(expandQuery('blanc de poulet')).toContain('poulet filet');
    expect(expandQuery('riz')).toEqual(['riz']);
  });
});
