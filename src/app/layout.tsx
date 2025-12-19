import type { Metadata } from "next";
import { brandName } from "@/brand";
import "./globals.css";

const themeBootScript = `(() => { try { const raw = localStorage.getItem('settings.v1'); const saved = raw ? JSON.parse(raw).theme : null; const theme = saved === 'dark' || saved === 'light' ? saved : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; } catch {} })();`;

export const metadata: Metadata = {
  title: brandName,
  description: "A client-side instrument for examining strategic responses to compensation plans.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
