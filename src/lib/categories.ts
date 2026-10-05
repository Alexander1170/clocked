import {
  Baby,
  Banknote,
  Bike,
  BookOpen,
  Briefcase,
  Bus,
  Car,
  CircleDashed,
  Coffee,
  CreditCard,
  Dumbbell,
  Film,
  Fuel,
  Gamepad2,
  Gift,
  GraduationCap,
  HandHeart,
  Heart,
  HeartPulse,
  House,
  KeyRound,
  Landmark,
  Laptop,
  Music,
  Package,
  PawPrint,
  Percent,
  Pill,
  Pizza,
  Plane,
  Receipt,
  Repeat,
  Scissors,
  Shield,
  Shirt,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sofa,
  Sparkles,
  Ticket,
  Tv,
  Utensils,
  Wifi,
  Wine,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { Category } from '../../shared/types.ts';

/**
 * Icons a category can use, in the order the icon picker shows them. The keys
 * are saved on category records, so never rename one.
 */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  utensils: Utensils,
  coffee: Coffee,
  pizza: Pizza,
  wine: Wine,
  cart: ShoppingCart,
  fuel: Fuel,
  car: Car,
  bus: Bus,
  bike: Bike,
  plane: Plane,
  home: House,
  key: KeyRound,
  zap: Zap,
  wifi: Wifi,
  phone: Smartphone,
  sofa: Sofa,
  wrench: Wrench,
  receipt: Receipt,
  repeat: Repeat,
  cash: Banknote,
  card: CreditCard,
  fees: Percent,
  shield: Shield,
  landmark: Landmark,
  bag: ShoppingBag,
  shirt: Shirt,
  gift: Gift,
  package: Package,
  laptop: Laptop,
  health: HeartPulse,
  pill: Pill,
  dumbbell: Dumbbell,
  scissors: Scissors,
  sparkles: Sparkles,
  gamepad: Gamepad2,
  film: Film,
  music: Music,
  tv: Tv,
  ticket: Ticket,
  book: BookOpen,
  school: GraduationCap,
  paw: PawPrint,
  baby: Baby,
  heart: Heart,
  donate: HandHeart,
  briefcase: Briefcase,
  other: CircleDashed,
};

export const categoryIcon = (name: string | undefined): LucideIcon => CATEGORY_ICONS[name ?? ''] ?? CircleDashed;

/**
 * Built-in categories. Fixed ids so every device seeds the same records. Each
 * device only seeds ids it doesn't have, so later additions use in-between
 * sort numbers to land in the right spot without renumbering older ones.
 */
export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'cat_food', name: 'Food and drink', icon: 'utensils', sort: 1 },
  { id: 'cat_groceries', name: 'Groceries', icon: 'cart', sort: 2 },
  { id: 'cat_gas', name: 'Gas', icon: 'fuel', sort: 3 },
  { id: 'cat_transport', name: 'Car and transport', icon: 'car', sort: 4 },
  { id: 'cat_shopping', name: 'Shopping', icon: 'bag', sort: 5 },
  { id: 'cat_clothes', name: 'Clothes', icon: 'shirt', sort: 5.5 },
  { id: 'cat_bills', name: 'Bills', icon: 'receipt', sort: 6 },
  { id: 'cat_rent', name: 'Rent and housing', icon: 'key', sort: 6.1 },
  { id: 'cat_utilities', name: 'Utilities', icon: 'zap', sort: 6.2 },
  { id: 'cat_phone', name: 'Phone and internet', icon: 'phone', sort: 6.3 },
  { id: 'cat_insurance', name: 'Insurance', icon: 'shield', sort: 6.4 },
  { id: 'cat_debt', name: 'Loans and debt', icon: 'card', sort: 6.5 },
  { id: 'cat_subs', name: 'Subscriptions', icon: 'repeat', sort: 7 },
  { id: 'cat_fun', name: 'Fun', icon: 'gamepad', sort: 8 },
  { id: 'cat_health', name: 'Health', icon: 'health', sort: 9 },
  { id: 'cat_home', name: 'Home', icon: 'home', sort: 10 },
  { id: 'cat_personal', name: 'Personal care', icon: 'scissors', sort: 11 },
  { id: 'cat_pets', name: 'Pets', icon: 'paw', sort: 11.5 },
  { id: 'cat_travel', name: 'Travel', icon: 'plane', sort: 12 },
  { id: 'cat_gifts', name: 'Gifts and donations', icon: 'gift', sort: 12.5 },
  { id: 'cat_cash', name: 'Cash', icon: 'cash', sort: 13 },
  { id: 'cat_fees', name: 'Bank fees', icon: 'fees', sort: 14 },
  { id: 'cat_other', name: 'Other', icon: 'other', sort: 99 },
].map((c) => ({ ...c, updatedAt: 1 }));

export const FALLBACK_CATEGORY = 'cat_other';

/** Categories you add go after the built-in ones and before Other. */
const CUSTOM_SORT = 50;

export function nextCustomSort(cats: Category[]): number {
  return Math.max(CUSTOM_SORT, ...cats.filter((c) => c.sort >= CUSTOM_SORT && c.sort < 99).map((c) => Math.floor(c.sort) + 1));
}

/** A category with this name, ignoring case and extra spaces. */
export function findCategory(cats: Category[], name: string): Category | undefined {
  const n = name.trim().replace(/\s+/g, ' ').toLowerCase();
  return n ? cats.find((c) => c.name.trim().replace(/\s+/g, ' ').toLowerCase() === n) : undefined;
}

/**
 * Words in a category name that suggest its icon. The first match wins, so
 * specific things ("gym", "dog") come before catch-alls ("membership", "food").
 */
const ICON_HINTS: Array<[RegExp, string]> = [
  [/coffee|caf[eé]|starbucks|dunkin/, 'coffee'],
  [/pizza|take-?out|fast food|door ?dash|uber ?eats/, 'pizza'],
  [/\bbars?\b|beer|wine|liquor|alcohol|drinks/, 'wine'],
  [/\bpets?\b|\bdogs?\b|\bcats?\b|\bvet\b/, 'paw'],
  [/baby|\bkids?\b|child|daycare/, 'baby'],
  [/grocer|supermarket/, 'cart'],
  [/restaurant|food|\beat|dining|lunch|dinner|breakfast|snack/, 'utensils'],
  [/insurance/, 'shield'],
  [/electric|power|utilit|water|trash|\bheat(ing)?\b/, 'zap'],
  [/\bgas\b|fuel/, 'fuel'],
  [/uber|lyft|\bbus\b|train|transit|subway|taxi|transport/, 'bus'],
  [/bike|scooter/, 'bike'],
  [/\bcars?\b|auto|vehicle|parking|toll/, 'car'],
  [/flight|travel|trip|vacation|hotel/, 'plane'],
  [/\brent\b|mortgage|housing|apartment/, 'key'],
  [/internet|wi-?fi|cable/, 'wifi'],
  [/phone|cell|mobile/, 'phone'],
  [/furniture|decor/, 'sofa'],
  [/repair|maintenance|tools|oil change/, 'wrench'],
  [/home|house/, 'home'],
  [/gift|present|birthday|christmas|holiday/, 'gift'],
  [/donat|charit|church|tith/, 'donate'],
  [/cloth|shoes|apparel/, 'shirt'],
  [/tech|computer|electronic|laptop|software/, 'laptop'],
  [/pharm|medic|prescription|\bmeds\b/, 'pill'],
  [/doctor|dentist|dental|health|hospital|therapy/, 'health'],
  [/\bgym\b|fitness|workout|\bsports?\b/, 'dumbbell'],
  [/hair|barber|nails?\b|salon/, 'scissors'],
  [/beauty|makeup|skin|cosmetic/, 'sparkles'],
  [/\bgames?\b|gaming|xbox|playstation|steam/, 'gamepad'],
  [/movie|cinema|film/, 'film'],
  [/music|spotify|concert/, 'music'],
  [/\btv\b|netflix|hulu|disney/, 'tv'],
  [/\bevents?\b|tickets?\b|\bshows?\b/, 'ticket'],
  [/\bbooks?\b|reading|kindle/, 'book'],
  [/school|tuition|\bclass(es)?\b|college|education|student/, 'school'],
  [/\bdates?\b|\blove\b|partner|girlfriend|boyfriend|wife|husband/, 'heart'],
  [/\bwork\b|business|office/, 'briefcase'],
  [/subscription|membership|streaming/, 'repeat'],
  [/loan|credit|debt|\bcards?\b/, 'card'],
  [/\btax(es)?\b|government|\bdmv\b/, 'landmark'],
  [/\bfees?\b/, 'fees'],
  [/cash|\batm\b/, 'cash'],
  [/\bbills?\b/, 'receipt'],
  [/amazon|shipping|package|online/, 'package'],
  [/shop/, 'bag'],
];

/** An icon that fits a category's name, if any word gives it away. */
export function guessIcon(name: string): string | undefined {
  const n = name.toLowerCase();
  return ICON_HINTS.find(([re]) => re.test(n))?.[1];
}
