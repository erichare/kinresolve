import type { Metadata } from "next";
import { BetaEmailVerification } from "@/components/beta-email-verification";
import { PublicShell } from "@/components/public-shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Verify email · Kin Resolve",
  robots: { index: false, follow: false }
};

export default function VerifyEmailPage() {
  return (
    <PublicShell>
      <div className="page-wrap">
        <section className="section" style={{ maxWidth: 520, margin: "40px auto" }}>
          <div className="panel">
            <h1 style={{ marginTop: 0 }}>Verify your email</h1>
            <BetaEmailVerification />
          </div>
        </section>
      </div>
    </PublicShell>
  );
}
