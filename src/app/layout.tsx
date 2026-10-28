import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemePrefsApplier } from "@/components/theme-prefs-applier";
import { StorageHygiene } from "@/components/storage-hygiene";

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
  title: "EmorTrades Trading Journal",
  description:
    "A professional-grade trading journal with deep analytics, AI insights, multi-account management, risk tools, and comprehensive performance reporting. All features included, no subscription tiers.",
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
