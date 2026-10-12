/** Cuisine tags for profiles and discovery filters (§26). Labels live in messages (Cuisines.*). */
export const CUISINES = [
  "armenian",
  "georgian",
  "middle_eastern",
  "european",
  "italian",
  "french",
  "asian",
  "japanese",
  "chinese",
  "indian",
  "mexican",
  "american",
  "grill",
  "seafood",
  "vegetarian",
  "pizza",
  "burgers",
  "fast_food",
  "cafe",
  "coffee",
  "bakery",
  "desserts",
  "bar",
  "wine",
] as const;
export type Cuisine = (typeof CUISINES)[number];

export const MAX_CUISINES = 5;
