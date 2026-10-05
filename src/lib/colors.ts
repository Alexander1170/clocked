/** The 8 categorical slots, in their validated order. Jobs keep their slot forever. */
export const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export const SLOT_NAMES = ['Blue', 'Orange', 'Aqua', 'Yellow', 'Magenta', 'Green', 'Violet', 'Red'];

export const slotColor = (n: number) => `var(--s${(((n - 1) % 8) + 8) % 8 + 1})`;

export function nextSlot(used: number[]): number {
  return SLOTS.find((s) => !used.includes(s)) ?? 1;
}
