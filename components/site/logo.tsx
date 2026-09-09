import Link from "next/link";
import { Activity } from "lucide-react";

export function Logo({ locale = "en", inverse = false }: { locale?: string; inverse?: boolean }) {
  return <Link href={`/${locale}`} className="flex items-center gap-2.5 font-semibold tracking-tight" aria-label="MEDISOFT home"><span className={`grid size-9 place-items-center rounded-xl ${inverse ? "bg-white text-teal" : "bg-teal text-white"}`}><Activity size={19}/></span><span className="text-xl">MEDISOFT</span></Link>;
}
