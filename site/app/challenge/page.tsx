import { PageHero } from "@/components/page-hero";
import { ResearchInstinctsChallenge } from "@/components/research-instincts-challenge";
import { pageMetadata } from "@/lib/metadata";

const challengeMetadata = pageMetadata({
  title: "Immersive research challenge",
  description:
    "Work five immersive Hartwell–Mercer investigations across thirty synthetic records, from handwritten ledgers to DNA research worksheets.",
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
        lead="Work five immersive cases across thirty synthetic records: handwritten schedules and letters, travel papers, object-provenance notes, photographs, name indexes, and DNA research worksheets. Every mystery rewards correlation, chronology, and careful limits—not a lucky guess."
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
