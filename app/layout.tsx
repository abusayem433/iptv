import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const space = Space_Grotesk({ subsets: ["latin"], variable: "--font-space", weight: ["500", "600", "700"] });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", weight: ["400", "500", "600", "700"] });

/** Set in production so absolute URLs (Open Graph, etc.) resolve correctly. */
const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export const viewport: Viewport = {
  themeColor: "#05060d",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "SAYEM TV",
  description: "SAYEM TV — browse and play live HLS channels",
  applicationName: "SAYEM TV",
  appleWebApp: {
    capable: true,
    title: "SAYEM TV",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    siteName: "SAYEM TV",
    title: "SAYEM TV",
    description: "SAYEM TV — browse and play live HLS channels",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${space.variable} ${inter.variable}`} suppressHydrationWarning>
      <body>
        <Script id="sayem-theme-boot" strategy="beforeInteractive">
          {`try{var t=localStorage.getItem('sayem-tv-theme');if(t==='light')document.documentElement.setAttribute('data-theme','light')}catch(e){}`}
        </Script>
        {children}
      </body>
    </html>
  );
}
