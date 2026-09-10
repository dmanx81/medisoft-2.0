import type { Metadata } from 'next';
import { geistSans, geistMono } from '@/lib/fonts';
import '../globals.css';

export const metadata: Metadata = {
  title: 'Login — MEDISOFT',
  description: 'Sign in to your MEDISOFT organization workspace.',
};

export default function LoginLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
