import type { Category, Tag } from "./types";

// The category and tags the app relies on are found by a mark (role), not by name, so they
// can be renamed freely. Marks are set by scripts/migrations/2026-09-30_roles.sql and the
// default set for new accounts. Databases from before that migration have no marks: then the
// old name match ("Food", "Lunch", …) is used instead.

export type MealRole = "breakfast" | "lunch" | "snack" | "dinner" | "supper";

export const MEAL_ROLES: { role: MealRole; label: string }[] = [
  { role: "breakfast", label: "breakfast (5–11am)" },
  { role: "lunch", label: "lunch (11am–3pm)" },
  { role: "snack", label: "tea time (3–5pm)" },
  { role: "dinner", label: "dinner (5–10pm)" },
  { role: "supper", label: "late night (10pm–5am)" },
];

export function mealForHour(hour: number): MealRole {
  if (hour >= 5 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 15) return "lunch";
  if (hour >= 15 && hour < 17) return "snack";
  if (hour >= 17 && hour < 22) return "dinner";
  return "supper";
}

// The category behind the "Food & dining" card and the meal defaults.
export function foodCategory(categories: Category[]): Category | undefined {
  const marked = categories.find((c) => c.role === "food");
  if (marked || categories.some((c) => c.role)) return marked;
  return categories.find((c) => c.name.toLowerCase() === "food");
}

// The category instalment plans bought from Goals go in: the marked one, else one named
// "Instalments" (before 2026-10-08_instalments_category.sql there's no mark).
export function instalmentsCategory(categories: Category[]): Category | undefined {
  return categories.find((c) => c.role === "instalments") ?? categories.find((c) => c.name.toLowerCase() === "instalments");
}

// The tag Add expense suggests for this meal.
export function mealTag(categories: Category[], tags: Tag[], meal: MealRole): Tag | undefined {
  const marked = tags.find((t) => t.role === meal);
  if (marked || tags.some((t) => t.role)) return marked;
  const food = foodCategory(categories);
  return food && tags.find((t) => t.category_id === food.id && t.name.toLowerCase() === meal);
}

// What a marked category or tag is used for (shown next to its star in Settings).
export function roleDescription(role: Category["role"] | Tag["role"]): string | null {
  if (role === "food") return "Used for the Food & dining card and meal suggestions";
  if (role === "instalments") return "Instalment plans bought from Goals go here; it can be renamed but not deleted";
  const meal = MEAL_ROLES.find((m) => m.role === role);
  if (!meal) return null;
  const endsDay = role === "dinner" || role === "supper" ? `, and moves "Same as last entry" to the next day` : "";
  return `Suggested in Add expense at ${meal.label}${endsDay}`;
}
