/** The 14 allergens food businesses must declare under EU rules (§15). Labels in messages. */
export const ALLERGENS = [
  "gluten",
  "crustaceans",
  "eggs",
  "fish",
  "peanuts",
  "soybeans",
  "milk",
  "nuts",
  "celery",
  "mustard",
  "sesame",
  "sulphites",
  "lupin",
  "molluscs",
] as const;
export type Allergen = (typeof ALLERGENS)[number];

export const DIETARY_TAGS = ["vegetarian", "vegan", "spicy", "halal"] as const;
export type DietaryTag = (typeof DIETARY_TAGS)[number];

/** Max price of one item or modifier, in minor units (guards against typos like 1e9). */
export const MAX_PRICE_MINOR = 100_000_000;
