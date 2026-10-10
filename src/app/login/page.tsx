"use client";

import { useState } from "react";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { GUEST_COOKIE, enterGuest } from "@/lib/guest";

// Email + password only. There is no public sign-up: accounts are created in the
// Supabase dashboard (Authentication -> Users -> Add user); see README > Adding a friend.
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsBusy(true);
    const { error } = await createClient().auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      setIsBusy(false);
      setError(
        error.status === 429
          ? "Too many attempts. Wait a minute and try again."
          : "Wrong email or password."
      );
      return;
    }
    // Leave guest mode if it was on, then full navigation so the middleware sees the session cookie.
    document.cookie = `${GUEST_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
    window.location.replace("/");
  };

  return (
    <div className="flex min-h-[80dvh] items-center justify-center">
      <form onSubmit={signIn} className="w-full max-w-sm space-y-4">
        <div className="mb-8 flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-xs font-bold text-primary-foreground">
            RM
          </span>
          <span className="text-lg font-semibold tracking-tight">Budget</span>
        </div>

        {/* What this is, for someone arriving from a link (e.g. a portfolio): the demo is one tap. */}
        <div className="mb-8 space-y-3">
          <p className="text-sm text-muted-foreground">
            A personal budget tracker for Malaysia: log spending in a few taps or by double-tapping a TnG receipt, and see
            where the month is heading, bills still due, budgets, savings and goals.
          </p>
          <button
            type="button"
            onClick={enterGuest}
            className="flex h-11 w-full items-center justify-center gap-1.5 rounded-full bg-primary text-sm font-semibold text-primary-foreground transition hover:brightness-95"
          >
            Try the demo <ArrowRight className="h-4 w-4" />
          </button>
          <p className="text-center text-xs text-muted-foreground">
            The full app with made-up sample data. Nothing you enter is saved.{" "}
            <a
              href="https://github.com/ChewShen/budget-tracker"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2 hover:text-foreground"
            >
              How it&apos;s built
            </a>
          </p>
        </div>

        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="-mt-2 text-xs text-muted-foreground">Accounts are by invitation.</p>

        <input
          type="email"
          required
          autoComplete="username"
          placeholder="Email"
          aria-label="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="field"
        />

        <div className="relative">
          <input
            type={showPassword ? "text" : "password"}
            required
            autoComplete="current-password"
            placeholder="Password"
            aria-label="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="field pr-11"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-2 text-muted-foreground transition hover:text-foreground"
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <button
          type="submit"
          disabled={isBusy || !email || !password}
          className="h-11 w-full rounded-full border text-sm font-semibold transition hover:bg-secondary disabled:opacity-40"
        >
          {isBusy ? "Signing in…" : "Sign in"}
        </button>

      </form>
    </div>
  );
}
