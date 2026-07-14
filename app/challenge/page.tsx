import type { Metadata } from "next";
import Link from "next/link";

import { ResearchInstinctsChallenge } from "@/components/research-instincts-challenge";
import { PublicShell } from "@/components/public-shell";

export const metadata: Metadata = {
  title: "Immersive Research Challenge | Kin Resolve",
  description:
    "Investigate six synthetic Hartwell–Mercer records in an immersive first case, then test your judgment across four compact fictional desk cases.",
  robots: {
    index: false,
    follow: false
  }
};

export default function ChallengePage() {
  return (
    <PublicShell>
      <div className="page-wrap challenge-page">
        <section className="page-title challenge-intro">
          <span className="eyebrow">Research instincts</span>
          <h1>Test your genealogical skills—inside the records.</h1>
          <p>
            Begin with an immersive six-record investigation: a synthetic census-style household schedule, family
            letter, departure ledger, passenger declaration, city directory, and marriage ledger. Then test your
            judgment across four compact desk cases.
          </p>
          <p className="fiction-disclosure" role="note">
            <strong>Everything here is fictional. Every record is synthetic.</strong> Every person, place, record
            image, transcript, photograph, DNA match, and mystery in the Hartwell–Mercer archive was invented for
            this Kin Resolve demo. No real people or records appear here.
          </p>
          <Link className="challenge-back-link" href="/">
            ← Return to the public archive
          </Link>
        </section>

        <ResearchInstinctsChallenge />
      </div>
    </PublicShell>
  );
}
