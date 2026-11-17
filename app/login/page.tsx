"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser";
export default function Login() {
  const router = useRouter();
  const [username, setUsername] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(kind: "register" | "login") {
    setError("");
    if (!browserSupportsWebAuthn()) {
      setError(
        "Your browser does not support passkeys. Use a modern browser with a security key or device biometrics.",
      );
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`/api/auth/${kind}-options`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const options = await r.json();
      if (!r.ok) throw new Error(options.error);
      const response =
        kind === "register"
          ? await startRegistration({ optionsJSON: options })
          : await startAuthentication({ optionsJSON: options });
      const verified = await fetch(`/api/auth/${kind}-verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(response),
      });
      const result = await verified.json();
      if (!verified.ok) throw new Error(result.error);
      router.replace("/");
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.name === "NotAllowedError"
            ? "Passkey request cancelled. You can try again."
            : e.message
          : "Unable to sign in",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-shell">
      <section className="login-story">
        <Link className="brand" href="/">
          ◒ daylight<span>TODO</span>
        </Link>
        <div>
          <p className="eyebrow">A LITTLE SPACE TO FOCUS</p>
          <h1>
            Make room
            <br />
            for what
            <br />
            <em>matters.</em>
          </h1>
          <p>Your plans, your pace. Bring a little clarity to every day.</p>
        </div>
        <small>Thoughtfully timed in Singapore · UTC+8</small>
      </section>
      <section className="login-form">
        <div className="login-card">
          <span className="sun-icon">☀</span>
          <p className="eyebrow">WELCOME TO DAYLIGHT</p>
          <h2>A fresh start.</h2>
          <p>Sign in with your passkey. No password to remember.</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit("login");
            }}
          >
            <label>
              Username
              <input
                autoComplete="username webauthn"
                minLength={3}
                maxLength={64}
                pattern="[a-zA-Z0-9_.\-]+"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Your username"
              />
            </label>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            <button className="primary wide" disabled={busy}>
              {busy ? "Waiting for your passkey…" : "Sign in with passkey →"}
            </button>
            <button
              className="secondary wide"
              type="button"
              disabled={busy || username.trim().length < 3}
              onClick={() => void submit("register")}
            >
              Create an account
            </button>
          </form>
          <small>
            Your fingerprint, face, or security key stays on your device.
          </small>
        </div>
      </section>
    </main>
  );
}
