import Link from "next/link";
import type { Dictionary, Locale } from "@/lib/i18n";
import { Logo } from "./logo";

export function Footer({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  return <footer className="bg-ink text-white"><div className="mx-auto grid max-w-7xl gap-10 px-5 py-14 sm:grid-cols-2 lg:grid-cols-4 lg:px-8"><div className="lg:col-span-2"><Logo locale={locale} inverse/><p className="mt-5 max-w-sm text-sm leading-6 text-white/60">{dict.footer.copy}</p></div><div><p className="mb-3 text-xs font-bold uppercase tracking-widest text-white/40">Platform</p><div className="grid gap-2 text-sm text-white/70"><Link href={`/${locale}/product`}>{dict.nav.product}</Link><Link href={`/${locale}/features`}>{dict.nav.features}</Link><Link href={`/${locale}/security`}>{dict.nav.security}</Link></div></div><div><p className="mb-3 text-xs font-bold uppercase tracking-widest text-white/40">MEDISOFT</p><div className="grid gap-2 text-sm text-white/70"><Link href={`/${locale}/about`}>{dict.nav.about}</Link><Link href={`/${locale}/contact`}>{dict.nav.contact}</Link><Link href="/login">{dict.nav.login}</Link></div></div></div><div className="mx-auto flex max-w-7xl flex-col gap-3 border-t border-white/10 px-5 py-6 text-xs text-white/40 sm:flex-row sm:justify-between lg:px-8"><span>{dict.footer.rights}</span><span>Privacy · Terms · Security</span></div></footer>;
}
