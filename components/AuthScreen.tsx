"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError } from "@/lib/api";
import { setToken, useToken } from "@/lib/session";

type Mode = "login" | "signup";

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm placeholder:text-muted";

export default function AuthScreen() {
  const router = useRouter();
  const token = useToken();
  const [mode, setMode] = useState<Mode>("login");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (token) router.replace("/chat");
  }, [token, router]);

  function switchMode(next: Mode) {
    setMode(next);
    setError(null);
    setFieldErrors({});
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const email = String(form.get("email"));
    const password = String(form.get("password"));

    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    try {
      const result =
        mode === "login"
          ? await api.login(email, password)
          : await api.signup(String(form.get("fullName")), email, password);
      // Next keeps this route mounted after leaving it, so wipe the form (and the
      // password in it) rather than have it reappear after logging out
      formElement.reset();
      setMode("login");
      setToken(result.token);
    } catch (caught) {
      if (caught instanceof ApiError && Object.keys(caught.fieldErrors).length > 0) {
        setFieldErrors(caught.fieldErrors);
      } else {
        setError(caught instanceof Error ? caught.message : "Something went wrong");
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Undefined before hydration; a token means the redirect above is on its way
  if (token !== null) return null;

  const isSignup = mode === "signup";

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-semibold tracking-tight">
          {isSignup ? "Create your account" : "Welcome back"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          {isSignup ? "Sign up to start messaging." : "Log in to pick up your conversations."}
        </p>

        <div role="tablist" aria-label="Log in or sign up" className="mt-6 grid grid-cols-2 rounded-lg bg-subtle p-1 text-sm">
          {(["login", "signup"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={mode === option}
              onClick={() => switchMode(option)}
              className={`rounded-md py-1.5 font-medium transition-colors ${
                mode === option ? "bg-surface shadow-sm" : "text-muted hover:text-foreground"
              }`}
            >
              {option === "login" ? "Log in" : "Sign up"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {isSignup && (
            <Field label="Full name" name="fullName" error={fieldErrors.fullName}>
              <input id="fullName" name="fullName" required autoComplete="name" className={inputClass} />
            </Field>
          )}
          <Field label="Email" name="email" error={fieldErrors.email}>
            <input id="email" name="email" type="email" required autoComplete="email" className={inputClass} />
          </Field>
          <Field
            label="Password"
            name="password"
            error={fieldErrors.password}
            hint={isSignup ? "8 to 72 characters" : undefined}
          >
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={isSignup ? 8 : undefined}
              maxLength={isSignup ? 72 : undefined}
              autoComplete={isSignup ? "new-password" : "current-password"}
              className={inputClass}
            />
          </Field>

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-accent py-2.5 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-60"
          >
            {submitting ? "Please wait…" : isSignup ? "Create account" : "Log in"}
          </button>
        </form>
      </div>
    </main>
  );
}

function Field({
  label,
  name,
  error,
  hint,
  children,
}: {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-xs text-danger">{error}</p>
      ) : (
        hint && <p className="mt-1 text-xs text-muted">{hint}</p>
      )}
    </div>
  );
}
