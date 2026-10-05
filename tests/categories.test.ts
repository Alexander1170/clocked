import { describe, expect, it } from 'vitest';
import type { Category } from '../shared/types.ts';
import { CATEGORY_ICONS, DEFAULT_CATEGORIES, findCategory, guessIcon, nextCustomSort } from '../src/lib/categories.ts';
import { MAPPED_CATEGORY_IDS } from '../server/categorize.ts';

const custom = (id: string, name: string, sort: number): Category => ({ id, updatedAt: 1, name, icon: 'other', sort });

describe('categories', () => {
  it('has unique built-in ids, real icons, and Other last', () => {
    const ids = DEFAULT_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of DEFAULT_CATEGORIES) expect(CATEGORY_ICONS[c.icon], c.id).toBeDefined();
    const last = [...DEFAULT_CATEGORIES].sort((a, b) => a.sort - b.sort).at(-1);
    expect(last?.id).toBe('cat_other');
  });

  it('only files bank transactions under categories every device seeds', () => {
    const ids = new Set(DEFAULT_CATEGORIES.map((c) => c.id));
    for (const id of MAPPED_CATEGORY_IDS) expect(ids.has(id), id).toBe(true);
  });

  it('suggests an icon from the name', () => {
    expect(guessIcon('Coffee')).toBe('coffee');
    expect(guessIcon('Rent')).toBe('key');
    expect(guessIcon('Gym membership')).toBe('dumbbell');
    expect(guessIcon('Dog food')).toBe('paw');
    expect(guessIcon('Car insurance')).toBe('shield');
    expect(guessIcon('Barber shop')).toBe('scissors');
    expect(guessIcon('Credit card')).toBe('card');
    expect(guessIcon('Theater')).toBeUndefined();
    // "rent" inside another word doesn't count.
    expect(guessIcon('Parents')).toBeUndefined();
  });

  it('finds a category by name, ignoring case and spacing', () => {
    expect(findCategory(DEFAULT_CATEGORIES, '  food AND   drink ')?.id).toBe('cat_food');
    expect(findCategory(DEFAULT_CATEGORIES, 'Coffee')).toBeUndefined();
    expect(findCategory(DEFAULT_CATEGORIES, '   ')).toBeUndefined();
  });

  it('puts new categories after the built-in ones and before Other', () => {
    expect(nextCustomSort(DEFAULT_CATEGORIES)).toBe(50);
    expect(nextCustomSort([...DEFAULT_CATEGORIES, custom('a', 'Coffee', 50)])).toBe(51);
    expect(nextCustomSort([...DEFAULT_CATEGORIES, custom('a', 'Coffee', 50), custom('b', 'Kids', 53)])).toBe(54);
  });
});
