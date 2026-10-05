import {
  Banknote,
  BookOpen,
  Car,
  CircleDashed,
  Coffee,
  Fuel,
  Gamepad2,
  Gift,
  HeartPulse,
  House,
  PawPrint,
  Plane,
  Percent,
  Receipt,
  Repeat,
  Scissors,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Utensils,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { Category } from '../../shared/types.ts';

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  utensils: Utensils,
  cart: ShoppingCart,
  fuel: Fuel,
  car: Car,
  bag: ShoppingBag,
  receipt: Receipt,
  repeat: Repeat,
  gamepad: Gamepad2,
  health: HeartPulse,
  home: House,
  coffee: Coffee,
  gift: Gift,
  plane: Plane,
  paw: PawPrint,
  book: BookOpen,
  shirt: Shirt,
  phone: Smartphone,
  zap: Zap,
  cash: Banknote,
  scissors: Scissors,
  fees: Percent,
  other: CircleDashed,
};

export const categoryIcon = (name: string | undefined): LucideIcon => CATEGORY_ICONS[name ?? ''] ?? CircleDashed;

/** Built-in categories. Fixed ids so every device seeds the same records. */
export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'cat_food', name: 'Food and drink', icon: 'utensils', sort: 1 },
  { id: 'cat_groceries', name: 'Groceries', icon: 'cart', sort: 2 },
  { id: 'cat_gas', name: 'Gas', icon: 'fuel', sort: 3 },
  { id: 'cat_transport', name: 'Car and transport', icon: 'car', sort: 4 },
  { id: 'cat_shopping', name: 'Shopping', icon: 'bag', sort: 5 },
  { id: 'cat_bills', name: 'Bills', icon: 'receipt', sort: 6 },
  { id: 'cat_subs', name: 'Subscriptions', icon: 'repeat', sort: 7 },
  { id: 'cat_fun', name: 'Fun', icon: 'gamepad', sort: 8 },
  { id: 'cat_health', name: 'Health', icon: 'health', sort: 9 },
  { id: 'cat_home', name: 'Home', icon: 'home', sort: 10 },
  { id: 'cat_personal', name: 'Personal care', icon: 'scissors', sort: 11 },
  { id: 'cat_travel', name: 'Travel', icon: 'plane', sort: 12 },
  { id: 'cat_cash', name: 'Cash', icon: 'cash', sort: 13 },
  { id: 'cat_fees', name: 'Bank fees', icon: 'fees', sort: 14 },
  { id: 'cat_other', name: 'Other', icon: 'other', sort: 99 },
].map((c) => ({ ...c, updatedAt: 1 }));

export const FALLBACK_CATEGORY = 'cat_other';
