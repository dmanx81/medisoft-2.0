import en from "@/messages/en.json";
import sq from "@/messages/sq.json";

export type Locale = "en" | "sq";
export type Dictionary = typeof en;

export const locales: Locale[] = ["en", "sq"];
export function isLocale(value: string): value is Locale { return locales.includes(value as Locale); }
export function getDictionary(locale: Locale): Dictionary { return locale === "sq" ? (sq as Dictionary) : en; }
