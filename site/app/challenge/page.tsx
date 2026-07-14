import { PageHero } from "@/components/page-hero";
import { ResearchInstinctsChallenge } from "@/components/research-instincts-challenge";
import { pageMetadata } from "@/lib/metadata";

const challengeMetadata = pageMetadata({
  title: "Immersive research challenge",
  description:
    "Investigate six synthetic Hartwell–Mercer records in an immersive first case, then test your judgment across four compact fictional desk cases.",
  path: "/challenge/"
});

export const metadata = {
  ...challengeMetadata,
  robots: {
    index: false,
    follow: false
  }
};

export default function ChallengePage() {
  return (
    <>
      <PageHero
        eyebrow="Research instincts"
        lead="Begin with an immersive six-record investigation: a synthetic census-style household schedule, family letter, departure ledger, passenger declaration, city directory, and marriage ledger. Then test your judgment across four compact desk cases."
        primary="Return to Kin Resolve"
        primaryHref="/"
        title="Test your genealogical skills—inside the records."
      />

      <section className="shell challenge-marketing-body" aria-label="Fictional genealogy challenge">
        <div className="fiction-disclosure" role="note">
          <strong>Everything here is fictional. Every record is synthetic.</strong> Every person, place, record image,
          transcript, photograph, DNA match, and mystery in the Hartwell–Mercer archive was invented for this Kin
          Resolve demo. No real people or records appear here.
        </div>
        <ResearchInstinctsChallenge />
      </section>
    </>
  );
}
