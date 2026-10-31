import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemePrefsApplier } from "@/components/theme-prefs-applier";
import { StorageHygiene } from "@/components/storage-hygiene";
import { SITE } from "@/lib/seo";

const inter = Inter({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Geist_Mono — the app's monospaced/numerals face (font-mono, tabular numbers).
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: "EmorTrades — Trading Journal",
    template: "%s — EmorTrades",
  },
  description: SITE.description,
  keywords: [
    "trading journal",
    "trade tracker",
    "P&L analytics",
    "trading analytics",
    "AI trading insights",
    "trade journal",
    "EmorTrades",
  ],
  authors: [{ name: "EmorTrades" }],
  icons: {
    icon: "/logo.png",
  },
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: "EmorTrades — Trading Journal",
    description: SITE.description,
    url: SITE.url,
    images: [{ url: SITE.ogImage, width: 1200, height: 630, alt: "EmorTrades — Trading Journal" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "EmorTrades — Trading Journal",
    description: SITE.description,
    images: [SITE.ogImage],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  // SEO-UPGRADE · PHASE 9 — Google Search Console verification meta tag
  // (set GOOGLE_SITE_VERIFICATION in .env; emitted only when configured).
  ...(process.env.GOOGLE_SITE_VERIFICATION
    ? { verification: { google: process.env.GOOGLE_SITE_VERIFICATION } }
    : {}),
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Task 151-a — pre-paint theme bootstrapping: reads the persisted theme-prefs
  // store and sets data-theme / data-theme-mode / the .dark/.light class BEFORE
  // first paint, so non-default themes don't flash the midnight palette. The
  // registry ids/modes below must mirror src/lib/themes.ts.
  const themeBootstrap = `(function(){try{var raw=localStorage.getItem('tradesviz-theme-prefs');var id=raw?(JSON.parse(raw).state||{}).themeId:null;var M={midnight:'dark',obsidian:'dark',abyss:'dark',porcelain:'light',ivory:'light',mist:'light'};var known=id&&M[id];var mode=known?M[id]:'dark';var root=document.documentElement;root.dataset.theme=known?id:'midnight';root.dataset.themeMode=mode;root.classList.toggle('dark',mode==='dark');root.classList.toggle('light',mode==='light');root.style.colorScheme=mode;}catch(e){}})();`;

  return (
    <html lang="en" suppressHydrationWarning className="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body
        className={`${inter.variable} ${geistMono.variable} antialiased bg-background text-foreground min-h-screen`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <ThemePrefsApplier />
          <StorageHygiene />
          {children}
          <Toaster />
          <SonnerToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
