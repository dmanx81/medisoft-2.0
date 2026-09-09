import { notFound } from "next/navigation";
import { DemoWorkflow } from "@/components/demo/demo-workflow";
import { Footer } from "@/components/site/footer";
import { Header } from "@/components/site/header";
import { getDictionary, isLocale } from "@/lib/i18n";

export default async function DemoPage({ params }: { params: Promise<{ locale: string }> }) {
  const {locale}=await params; if(!isLocale(locale)) notFound(); const dict=getDictionary(locale);
  return <main className="min-h-screen bg-ivory text-ink"><Header locale={locale} dict={dict}/><section className="mx-auto max-w-7xl px-5 pb-14 pt-16 text-center lg:px-8 lg:pt-20"><p className="eyebrow">{locale==='sq'?'Demo interaktive':'Interactive demo'}</p><h1 className="mx-auto mt-4 max-w-3xl text-4xl font-semibold tracking-[-.04em] sm:text-5xl">{locale==='sq'?'Provoni një proces të plotë laboratorik.':'Experience a complete laboratory workflow.'}</h1><p className="mx-auto mt-5 max-w-2xl text-slate">{locale==='sq'?'Asnjë regjistrim. Asnjë e dhënë reale. Vetëm një pamje e qartë e mënyrës së punës.':'No signup. No real patient data. Just a clear, hands-on look at how MEDISOFT works.'}</p></section><section className="px-5 pb-24 lg:px-8"><DemoWorkflow locale={locale}/></section><Footer locale={locale} dict={dict}/></main>;
}

export function generateStaticParams() {
  return [{ locale: "en" }, { locale: "sq" }];
}
