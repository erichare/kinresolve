"use client";

import { useState } from "react";

import { requestSameOriginLogout } from "@/lib/logout-client";

export function LogoutControl() {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function logout(): Promise<void> {
    if (pending) return;
    setPending(true);
    setFailed(false);
    try {
      await requestSameOriginLogout();
      window.location.replace("/login");
    } catch {
      setFailed(true);
      setPending(false);
    }
  }

  return (
    <div className="sidebar-auth">
      <button disabled={pending} onClick={() => void logout()} type="button">
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {failed ? <span className="sr-only" role="alert">Unable to sign out. Try again.</span> : null}
    </div>
  );
}
