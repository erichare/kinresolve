import type { Metadata } from "next";
import { site } from "@/lib/site";

const socialImage = {
  url: "/og.png",
  width: 1200,
  height: 630,
  alt: "Kin Resolve — evidence-led genealogy research"
} as const;

export function pageMetadata({
  title,
  description,
  path
}: {
  title: string;
  description: string;
  path: `/${string}`;
}): Metadata {
  const socialTitle = `${title} — ${site.name}`;

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      locale: "en_US",
      siteName: site.name,
      title: socialTitle,
      description,
      url: path,
      images: [socialImage]
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description,
      images: ["/og.png"]
    }
  };
}
