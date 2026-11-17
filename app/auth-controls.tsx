"use client";

import { startRegistration, type PublicKeyCredentialCreationOptionsJSON } from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useState } from "react";

async function checkedJson(response: Response) {
  const body: unknown = await response.json();
  if (!response.ok) {
    throw new Error(typeof body === "object" && body !== null && "error" in body
      && typeof body.error === "string" ? body.error : "Authentication request failed");
  }
  return body;
}

function isRegistrationOptions(value: unknown): value is PublicKeyCredentialCreationOptionsJSON {
  return typeof value === "object" && value !== null
    && "challenge" in value && typeof value.challenge === "string"
    && "rp" in value && typeof value.rp === "object" && value.rp !== null
    && "user" in value && typeof value.user === "object" && value.user !== null
    && "pubKeyCredParams" in value && Array.isArray(value.pubKeyCredParams);
}

export default function AuthControls() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function act(enroll: boolean) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if (enroll) {
        const options = await checkedJson(await fetch("/api/auth/enroll-options", { method: "POST" }));
        if (!isRegistrationOptions(options)) throw new Error("Invalid passkey options from server");
        const response = await startRegistration({ optionsJSON: options });
        await checkedJson(await fetch("/api/auth/enroll-verify", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response }),
        }));
        setMessage("Another passkey was added to your account.");
      } else {
        await checkedJson(await fetch("/api/auth/logout", { method: "POST" }));
        router.replace("/login");
        router.refresh();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Authentication request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4" aria-label="Account controls">
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={busy} onClick={() => void act(true)}
          className="rounded border px-4 py-3 disabled:opacity-50">
          Add passkey
        </button>
        <button type="button" disabled={busy} onClick={() => void act(false)}
          className="rounded border px-4 py-3 disabled:opacity-50">
          Logout
        </button>
      </div>
      {busy && <p role="status">Waiting for authentication...</p>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
