import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { PublicShell } from "@/components/public-shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Forgot password · Kin Resolve",
  robots: { index: false, follow: false }
};

export default function ForgotPasswordPage() {
  return (
    <PublicShell>
      <div className="page-wrap">
        <section className="section" style={{ maxWidth: 520, margin: "40px auto" }}>
          <div className="panel">
            <h1 style={{ marginTop: 0 }}>Reset your password</h1>
            <p className="muted">
              Enter your email address. For your privacy, the result is the same whether or not an eligible account exists.
            </p>
            <ForgotPasswordForm />
            <div className="hero-actions">
              <Link className="button-secondary" href="/login">
                Back to sign in
              </Link>
            </div>
          </div>
        </section>
      </div>
    </PublicShell>
  );
}
