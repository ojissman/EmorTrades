import type { Metadata, Viewport } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemePrefsApplier } from "@/components/theme-prefs-applier";
import { StorageHygiene } from "@/components/storage-hygiene";
import { PwaRegistrar } from "@/components/pwa-registrar";
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
  // (icons intentionally declared ONCE, further down in the MOBILE-2 PWA
  // block — TS1117 fires on duplicate keys; the SEO-era `icons` here was
  // dead code silently overridden by the later one.)
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
  // P8-FIX: no explicit index/follow here — omitting it means crawlers default
  // to index,follow WITHOUT emitting a <meta name="robots"> tag. That keeps
  // notFound() pages clean (Next injects its own noindex meta there, and an
  // explicit "index, follow" from this layout used to conflict with it).
  // googleBot keeps only the preview controls; unspecified = unrestricted.
  robots: {
    googleBot: { "max-image-preview": "large", "max-snippet": -1 },
  },
  // SEO-UPGRADE · PHASE 9 — Google Search Console verification meta tag
  // (set GOOGLE_SITE_VERIFICATION in .env; emitted only when configured).
  ...(process.env.GOOGLE_SITE_VERIFICATION
    ? { verification: { google: process.env.GOOGLE_SITE_VERIFICATION } }
    : {}),

  // ---- MOBILE-2 — the PWA native-app layer ----------------------------------
  // Installable app: standalone window, own icon, splash from background /
  // theme colors. Passthrough SW (no caching) completes the install criteria.
  manifest: "/manifest.webmanifest",
  // iOS: launch full-screen from the home-screen icon; the translucent status
  // bar floats over the app chrome (theme-color synced live by
  // ThemePrefsApplier per active theme).
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "EmorTrades",
  },
  // PnL tables full of numbers must never be linkified as phone numbers.
  formatDetection: { telephone: false },
  icons: {
    icon: "/logo.png",
    apple: "/icons/apple-touch-icon.png",
  },
}

// MOBILE-2 — viewport-fit=cover extends the webview under the notch/home
// indicator; env(safe-area-inset-*) then become real values (the MOBILE-1 tab
// bar already pads by them). Zoom stays allowed (a11y: never block zoom).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1f2937", // midnight bar — synced live per theme by ThemePrefsApplier
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
          <PwaRegistrar />
          {children}
          <Toaster />
          <SonnerToaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
