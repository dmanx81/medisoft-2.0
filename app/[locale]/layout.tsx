import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { isLocale } from "@/lib/i18n";
import "../globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "MEDISOFT — Laboratory management, made clear",
  description:
    "A secure platform for patients, laboratory workflows and medical results.",
  metadataBase: new URL(
    "https://medisoft-lab.sacred-emu-5666.chatgpt.site",
  ),
  openGraph: {
    title: "MEDISOFT — Laboratory management, made clear",
    description:
      "Patients, laboratory workflows and results in one secure platform.",
    images: ["/og.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "MEDISOFT — Laboratory management, made clear",
    description:
      "Patients, laboratory workflows and results in one secure platform.",
    images: ["/og.png"],
  },
};

export default async function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  return (
    <html lang={isLocale(locale) ? locale : "en"}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
