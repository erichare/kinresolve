import type { Metadata, Viewport } from "next";
import { Manrope, Newsreader } from "next/font/google";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { site } from "@/lib/site";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans"
});

const newsreader = Newsreader({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-serif"
});

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: "Kin Resolve — Evidence-led genealogy research",
    template: "%s — Kin Resolve"
  },
  description: site.description,
  applicationName: site.name,
  manifest: "/manifest.webmanifest",
  category: "genealogy research software",
  keywords: ["genealogy", "family history", "genealogy research", "GEDCOM", "DNA matches", "source citations"],
  alternates: {
    canonical: "/"
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: site.name,
    title: "Kin Resolve — Evidence-led genealogy research",
    description: site.description,
    url: site.url,
    images: [{
      url: "/og.png",
      width: 1200,
      height: 630,
      alt: "Kin Resolve — evidence-led genealogy research"
    }]
  },
  twitter: {
    card: "summary_large_image",
    title: "Kin Resolve — Evidence-led genealogy research",
    description: site.description,
    images: ["/og.png"]
  }
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#173f35"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${manrope.variable} ${newsreader.variable}`}>
        <a className="skip-link" href="#main-content">Skip to content</a>
        <SiteHeader />
        <main id="main-content">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
