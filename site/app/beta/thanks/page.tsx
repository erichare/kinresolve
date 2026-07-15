import Link from "next/link";
import type { Metadata } from "next";
import { pageMetadata } from "@/lib/metadata";

export const metadata: Metadata = {
  ...pageMetadata({
    title: "Application received",
    description: "Next steps after a Kin Resolve private beta application.",
    path: "/beta/thanks/"
  }),
  robots: { index: false, follow: false }
};

export default function BetaThanksPage() {
  return (
    <section className="shell section">
      <span className="eyebrow">Application received</span>
      <h1>Thank you for your interest in Kin Resolve.</h1>
      <p className="prose-large">If the application endpoint accepted your submission, a receipt is on its way. Applying does not create an account, guarantee access, or accept private-beta participation terms.</p>
      <div className="form-warning">
        <strong>Keep family data out of email.</strong>
        <span>Do not reply with GEDCOM files, DNA data, relatives’ names or details, source images, passwords, credentials, or API tokens.</span>
      </div>
      <p>Cohorts remain deliberately small. Any invitation will present the exact approved participation terms, privacy notice, and cohort boundary before account creation.</p>
      <Link className="arrow-link" href="/product/">Explore the product boundary <span aria-hidden="true">→</span></Link>
    </section>
  );
}
