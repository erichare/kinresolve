import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { PublicShell } from "@/components/public-shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Choose a new password · Kin Resolve",
  robots: { index: false, follow: false }
};

export default function ResetPasswordPage() {
  return (
    <PublicShell>
      <div className="page-wrap">
        <section className="section" style={{ maxWidth: 520, margin: "40px auto" }}>
          <div className="panel">
            <h1 style={{ marginTop: 0 }}>Choose a new password</h1>
            <p className="muted">Use at least 10 characters. This recovery link can be used only once.</p>
            <ResetPasswordForm />
          </div>
        </section>
      </div>
    </PublicShell>
  );
}
