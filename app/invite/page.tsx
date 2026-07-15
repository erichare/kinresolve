import type { Metadata } from "next";
import { BetaInvitationForm } from "@/components/beta-invitation-form";
import { PublicShell } from "@/components/public-shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Private beta invitation · Kin Resolve",
  robots: { index: false, follow: false }
};

export default function InvitationPage() {
  return (
    <PublicShell>
      <div className="page-wrap">
        <section className="section" style={{ maxWidth: 720, margin: "40px auto" }}>
          <div className="panel">
            <h1 style={{ marginTop: 0 }}>Join the Kin Resolve private beta</h1>
            <p className="muted">
              Review the exact workspace role and beta agreements before creating your account.
            </p>
            <BetaInvitationForm />
          </div>
        </section>
      </div>
    </PublicShell>
  );
}
