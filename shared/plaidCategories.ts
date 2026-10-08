// Plaid's spending categories, mapped onto ours.

const BY_DETAILED: Record<string, string> = {
  FOOD_AND_DRINK_GROCERIES: 'cat_groceries',
  TRANSPORTATION_GAS: 'cat_gas',
  ENTERTAINMENT_TV_AND_MOVIES: 'cat_subs',
  ENTERTAINMENT_MUSIC_AND_AUDIO: 'cat_subs',
  GENERAL_SERVICES_AUTOMOTIVE: 'cat_transport',
  GENERAL_SERVICES_INSURANCE: 'cat_insurance',
  PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS: 'cat_health',
  TRANSFER_OUT_WITHDRAWAL: 'cat_cash',
  RENT_AND_UTILITIES_RENT: 'cat_rent',
  LOAN_PAYMENTS_MORTGAGE_PAYMENT: 'cat_rent',
  RENT_AND_UTILITIES_GAS_AND_ELECTRICITY: 'cat_utilities',
  RENT_AND_UTILITIES_WATER: 'cat_utilities',
  RENT_AND_UTILITIES_SEWAGE_AND_WASTE_MANAGEMENT: 'cat_utilities',
  RENT_AND_UTILITIES_OTHER_UTILITIES: 'cat_utilities',
  RENT_AND_UTILITIES_TELEPHONE: 'cat_phone',
  RENT_AND_UTILITIES_INTERNET_AND_CABLE: 'cat_phone',
  GENERAL_MERCHANDISE_CLOTHING_AND_ACCESSORIES: 'cat_clothes',
  GENERAL_MERCHANDISE_PET_SUPPLIES: 'cat_pets',
  MEDICAL_VETERINARY_SERVICES: 'cat_pets',
  GENERAL_MERCHANDISE_GIFTS_AND_NOVELTIES: 'cat_gifts',
  GOVERNMENT_AND_NON_PROFIT_DONATIONS: 'cat_gifts',
};

const BY_PRIMARY: Record<string, string> = {
  FOOD_AND_DRINK: 'cat_food',
  TRANSPORTATION: 'cat_transport',
  GENERAL_MERCHANDISE: 'cat_shopping',
  RENT_AND_UTILITIES: 'cat_bills',
  LOAN_PAYMENTS: 'cat_debt',
  ENTERTAINMENT: 'cat_fun',
  MEDICAL: 'cat_health',
  PERSONAL_CARE: 'cat_personal',
  HOME_IMPROVEMENT: 'cat_home',
  TRAVEL: 'cat_travel',
  BANK_FEES: 'cat_fees',
};

/** Every category the mapping can file a transaction under. */
export const MAPPED_CATEGORY_IDS: ReadonlySet<string> = new Set([...Object.values(BY_DETAILED), ...Object.values(BY_PRIMARY), 'cat_other']);

export function categoryFor(primary?: string, detailed?: string): string {
  return (detailed && BY_DETAILED[detailed]) || (primary && BY_PRIMARY[primary]) || 'cat_other';
}

/** The category for Plaid's detailed category alone. Its primary category is the start of it. */
export function categoryForDetailed(detailed?: string): string {
  if (!detailed) return 'cat_other';
  const primary = Object.keys(BY_PRIMARY).find((p) => detailed.startsWith(`${p}_`));
  return categoryFor(primary, detailed);
}
