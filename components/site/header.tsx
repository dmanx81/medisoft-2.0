"use client";

import Link from "next/link";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import type { Dictionary, Locale } from "@/lib/i18n";
import { Logo } from "./logo";

export function Header({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const [open, setOpen] = useState(false);
  const other = locale === "en" ? "sq" : "en";
  const links = [["product",dict.nav.product],["laboratories",dict.nav.laboratories],["clinics",dict.nav.clinics],["features",dict.nav.features],["security",dict.nav.security],["pricing",dict.nav.pricing]];
  return <header className="sticky top-0 z-50 border-b border-line/70 bg-ivory/90 backdrop-blur-xl"><div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-5 lg:px-8"><Logo locale={locale}/><nav className="hidden items-center gap-5 text-[13px] text-slate xl:flex">{links.map(([slug,label])=><Link key={slug} href={`/${locale}/${slug}`} className="transition hover:text-teal">{label}</Link>)}</nav><div className="hidden items-center gap-2 lg:flex"><Link href={`/${other}`} className="rounded-full px-3 py-2 text-xs font-semibold uppercase text-slate">{other}</Link><Link href="/login" className="px-3 py-2 text-sm font-medium">{dict.nav.login}</Link><Link href={`/${locale}/contact`} className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-white">{dict.hero.primary}</Link></div><button className="grid size-10 place-items-center rounded-xl border border-line bg-white lg:hidden" onClick={()=>setOpen(!open)} aria-expanded={open} aria-label="Toggle menu">{open?<X aria-hidden="true" size={20}/>:<Menu aria-hidden="true" size={20}/>}</button></div>{open&&<div className="border-t border-line bg-white px-5 py-5 lg:hidden"><nav className="grid gap-1">{[["",dict.nav.home],...links,["demo",dict.nav.demo],["contact",dict.nav.contact]].map(([slug,label])=><Link onClick={()=>setOpen(false)} key={slug} href={`/${locale}/${slug}`} className="rounded-xl px-3 py-3 text-sm hover:bg-mint">{label}</Link>)}</nav><div className="mt-4 flex items-center gap-2 border-t border-line pt-4"><Link href={`/${other}`} className="rounded-full border border-line px-4 py-2 text-xs font-semibold uppercase">{other}</Link><Link href="/login" className="rounded-full bg-ink px-5 py-2 text-sm text-white">{dict.nav.login}</Link></div></div>}</header>;
}
