"use client";

import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type AuthMode = "login" | "register";

async function getApiError(response: Response, fallback: string): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
    ) {
      return body.error;
    }
  } catch {
    return fallback;
  }

  return fallback;
}

function getPasskeyError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return "Passkey request cancelled or timed out. You can try again.";
    }
    if (error.name === "NotSupportedError" || error.name === "SecurityError") {
      return "Passkeys are unavailable in this browser or page context.";
    }
  }

  return error instanceof Error
    ? error.message
    : "Passkey authentication failed. Please try again.";
}

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [mode, setMode] = useState<AuthMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    void fetch("/api/auth/me", { signal: controller.signal })
      .then(async (response) => {
        if (active && response.ok) {
          router.replace("/");
        } else if (active && response.status !== 401) {
          setError(
            await getApiError(response, "Could not check your session."),
          );
        }
      })
      .catch((caught: unknown) => {
        if (
          active &&
          !(caught instanceof DOMException && caught.name === "AbortError")
        ) {
          setError("Could not check your session. Please try again.");
        }
      })
      .finally(() => {
        if (active) {
          setCheckingSession(false);
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [router]);

  async function authenticate(authMode: AuthMode) {
    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setError("Enter a username to continue.");
      return;
    }
    if (!browserSupportsWebAuthn()) {
      setError("Your browser or device does not support passkeys.");
      return;
    }

    setMode(authMode);
    setError(null);
    const optionsEndpoint =
      authMode === "register"
        ? "/api/auth/register-options"
        : "/api/auth/login-options";
    const verifyEndpoint =
      authMode === "register"
        ? "/api/auth/register-verify"
        : "/api/auth/login-verify";

    try {
      const optionsResponse = await fetch(optionsEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: trimmedUsername }),
      });
      if (!optionsResponse.ok) {
        throw new Error(
          await getApiError(optionsResponse, "Could not start passkey request."),
        );
      }

      const options: unknown = await optionsResponse.json();
      const credential =
        authMode === "register"
          ? await startRegistration({
              optionsJSON: options as PublicKeyCredentialCreationOptionsJSON,
            })
          : await startAuthentication({
              optionsJSON: options as PublicKeyCredentialRequestOptionsJSON,
            });

      const verifyResponse = await fetch(verifyEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: trimmedUsername, response: credential }),
      });
      if (!verifyResponse.ok) {
        throw new Error(
          await getApiError(verifyResponse, "Passkey verification failed."),
        );
      }

      router.replace("/");
    } catch (caught) {
      setError(getPasskeyError(caught));
      setMode(null);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-10">
      <section className="w-full rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8 dark:border-gray-700 dark:bg-gray-800">
        <p className="text-sm font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300">
          Todo App
        </p>
        <h1 className="mt-2 text-2xl font-bold text-gray-900 dark:text-white">
          Sign in with a passkey
        </h1>
        <p className="mt-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
          Register with a new username or use a passkey already registered to
          your account. Your biometric or security key stays on your device.
        </p>

        <form
          className="mt-6 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void authenticate("login");
          }}
        >
          <div className="flex flex-col gap-1">
            <label
              className="text-sm font-medium text-gray-800 dark:text-gray-100"
              htmlFor="username"
            >
              Username
            </label>
            <input
              autoComplete="username webauthn"
              className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-gray-900 placeholder:text-gray-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              disabled={mode !== null || checkingSession}
              id="username"
              onChange={(event) => setUsername(event.target.value)}
              required
              value={username}
            />
          </div>

          {error && (
            <p
              className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-100"
              role="alert"
            >
              {error}
            </p>
          )}

          <div className="grid gap-3 pt-1">
            <button
              className="min-h-11 rounded-lg bg-blue-700 px-4 font-semibold text-white hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-500"
              disabled={mode !== null || checkingSession}
              onClick={() => void authenticate("login")}
              type="button"
            >
              {mode === "login"
                ? "Waiting for passkey…"
                : checkingSession
                  ? "Checking session…"
                  : "Log in"}
            </button>
            <button
              className="min-h-11 rounded-lg border border-gray-300 px-4 font-semibold text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-gray-600 dark:text-gray-100 dark:hover:bg-gray-700"
              disabled={mode !== null || checkingSession}
              onClick={() => void authenticate("register")}
              type="button"
            >
              {mode === "register" ? "Waiting for passkey…" : "Register"}
            </button>
          </div>
        </form>

        <p className="mt-5 text-xs leading-5 text-gray-500 dark:text-gray-400">
          Passkeys require a secure connection. On localhost, use your browser’s
          local development origin.
        </p>
      </section>
    </main>
  );
}
