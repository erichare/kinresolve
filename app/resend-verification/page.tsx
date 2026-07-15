import type { Metadata } from "next";
import { ResendVerificationForm } from "@/components/resend-verification-form";
import { PublicShell } from "@/components/public-shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Resend verification email · Kin Resolve",
  robots: { index: false, follow: false }
};

export default function ResendVerificationPage() {
  return (
    <PublicShell>
      <div className="page-wrap">
        <section className="section" style={{ maxWidth: 520, margin: "40px auto" }}>
          <div className="panel">
            <h1 style={{ marginTop: 0 }}>Resend verification email</h1>
            <p className="muted">
              Enter your email address. For your privacy, the result is the same whether or not an eligible account exists.
            </p>
            <ResendVerificationForm />
          </div>
        </section>
      </div>
    </PublicShell>
  );
}
