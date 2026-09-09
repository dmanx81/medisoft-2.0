import { notFound } from "next/navigation";
import { HomePage } from "@/components/site/home";
import { getDictionary, isLocale } from "@/lib/i18n";

export default async function LocalizedHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <HomePage locale={locale} dict={getDictionary(locale)}/>;
}

export function generateStaticParams() {
  return [{ locale: "en" }, { locale: "sq" }];
}
