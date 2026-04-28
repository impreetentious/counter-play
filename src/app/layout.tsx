import type { Metadata } from "next";
import { brandName } from "@/brand";
import "./globals.css";

const themeBootScript = `(() => { try { const raw = localStorage.getItem('settings.v1'); const saved = raw ? JSON.parse(raw).theme : null; const theme = saved === 'dark' || saved === 'light' ? saved : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); document.documentElement.dataset.theme = theme; document.documentElement.style.colorScheme = theme; } catch {} })();`;

const description =
  "Client-side sales compensation plan simulator and perverse-incentive linter. Model assumptions, design the plan, simulate strategic best responses, and export a seed-stamped design record.";

const siteOrigin =
  process.env.SITE_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3001");

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: {
    default: brandName,
    template: `%s · ${brandName}`,
  },
  description,
  applicationName: brandName,
  authors: [{ name: "Sidakpreet Singh" }],
  keywords: [
    "sales compensation",
    "incentive design",
    "mechanism design",
    "quota",
    "commission plan",
    "perverse incentives",
  ],
  icons: {
    icon: [
      { url: "/favicon.ico" },
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: brandName,
    description,
    type: "website",
    siteName: brandName,
    locale: "en_US",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: `${brandName} — strategic response before the plan ships`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: brandName,
    description,
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>): React.JSX.Element {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
