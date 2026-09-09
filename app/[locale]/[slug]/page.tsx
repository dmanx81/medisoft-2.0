import { notFound } from "next/navigation";
import { InnerPage } from "@/components/site/inner-page";
import { getDictionary, isLocale } from "@/lib/i18n";

const slugs = ["product","laboratories","clinics","features","security","pricing","about","contact"] as const;
type Slug = typeof slugs[number];

export default async function Page({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  if (!isLocale(locale) || !slugs.includes(slug as Slug)) notFound();
  return <InnerPage locale={locale} slug={slug as Slug} dict={getDictionary(locale)}/>;
}

export function generateStaticParams() {
  const locales = ["en", "sq"];
  const slugs = ["product", "laboratories", "clinics", "features", "security", "pricing", "about", "contact"];

  return locales.flatMap((locale) =>
    slugs.map((slug) => ({ locale, slug }))
  );
}
