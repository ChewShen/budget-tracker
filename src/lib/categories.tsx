"use client";

import {
  CalendarClock,
  Baby,
  BookOpen,
  Briefcase,
  Car,
  CircleDashed,
  Clapperboard,
  Coffee,
  Dumbbell,
  Fuel,
  Gift,
  GraduationCap,
  HeartPulse,
  Home,
  Music,
  PawPrint,
  Plane,
  Repeat,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Utensils,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useBudget } from "@/lib/budget-context";

// Icons a category can use. Keys are stored in categories.icon.
export const CATEGORY_ICON_OPTIONS: Record<string, LucideIcon> = {
  utensils: Utensils,
  coffee: Coffee,
  car: Car,
  fuel: Fuel,
  home: Home,
  repeat: Repeat,
  smartphone: Smartphone,
  sparkles: Sparkles,
  "heart-pulse": HeartPulse,
  dumbbell: Dumbbell,
  music: Music,
  clapperboard: Clapperboard,
  "shopping-bag": ShoppingBag,
  gift: Gift,
  plane: Plane,
  "book-open": BookOpen,
  "graduation-cap": GraduationCap,
  briefcase: Briefcase,
  wallet: Wallet,
  baby: Baby,
  "paw-print": PawPrint,
  "calendar-clock": CalendarClock,
  "circle-dashed": CircleDashed,
};

// Fallback for categories created before icons were selectable (the Excel import).
const ICON_BY_NAME: Record<string, string> = {
  Food: "utensils",
  Instalments: "calendar-clock",
  Transport: "car",
  Home_Bills: "home",
  Self_care: "sparkles",
  Subscription: "repeat",
  Health: "heart-pulse",
  Own_Interest: "music",
  Entertainment: "clapperboard",
  Shopping: "shopping-bag",
  Others: "circle-dashed",
};

// The icon key a category currently shows: its saved icon, else the default for its name.
export function categoryIconKey(name?: string, icon?: string | null): string {
  if (icon && CATEGORY_ICON_OPTIONS[icon]) return icon;
  if (name && ICON_BY_NAME[name]) return ICON_BY_NAME[name];
  return "circle-dashed";
}

export function categoryIcon(name?: string, icon?: string | null): LucideIcon {
  return CATEGORY_ICON_OPTIONS[categoryIconKey(name, icon)];
}

// "Home_Bills" -> "Home Bills"
export function categoryLabel(name?: string): string {
  return (name || "Others").replace(/_/g, " ");
}

export function CategoryIcon({
  name,
  className = "h-9 w-9",
}: {
  name?: string;
  className?: string;
}) {
  // Transactions only carry the category name, so look up the chosen icon here.
  const { categories } = useBudget();
  const Icon = categoryIcon(name, categories.find((c) => c.name === name)?.icon);
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full bg-secondary text-foreground/80 ${className}`}
    >
      <Icon className="h-[45%] w-[45%]" strokeWidth={2} />
    </span>
  );
}
