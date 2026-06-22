import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";

export default function Login() {
  const { user, loading, signIn } = useAuth();
  const [mode, setMode] = useState<"signin" | "reset">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  if (loading) return null;
  if (user) return <Navigate to="/" />;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error } = await signIn(email, password);
    if (error) setError(error);
    setSubmitting(false);
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSubmitting(false);
    // Don't reveal whether the email exists — always show the same confirmation.
    if (error && !/rate/i.test(error.message)) {
      setError(error.message);
      return;
    }
    setResetSent(true);
  };

  const switchMode = (next: "signin" | "reset") => {
    setMode(next);
    setError(null);
    setResetSent(false);
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-white">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <img src="/logo.jpg" alt="Phillip Island Host" className="w-full max-w-[240px] h-auto mx-auto mb-4 mix-blend-multiply" />
          <p className="text-base text-gray-400 mt-1">
            {mode === "reset" ? "Reset your password" : "Sign in to continue"}
          </p>
        </div>

        {mode === "reset" ? (
          <div className="bg-white border border-gray-200 rounded-xl p-8">
            {resetSent ? (
              <div className="text-base text-gray-600">
                <p className="mb-6">
                  If an account exists for <span className="font-medium text-gray-800">{email}</span>,
                  a password reset link has been sent. Check your inbox and follow the link to choose a new password.
                </p>
                <button
                  onClick={() => switchMode("signin")}
                  className="w-full py-3 text-base font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800"
                >
                  Back to sign in
                </button>
              </div>
            ) : (
              <form onSubmit={handleReset}>
                {error && (
                  <div className="text-base text-red-600 bg-red-50 rounded-lg px-4 py-3 mb-5">{error}</div>
                )}
                <p className="text-sm text-gray-400 mb-5">Enter your email and we'll send you a link to reset your password.</p>

                <label className="block mb-6">
                  <span className="text-base text-gray-500 font-medium">Email</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="mt-1.5 w-full px-4 py-3 text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-300"
                    required
                  />
                </label>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-3 text-base font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
                >
                  {submitting ? "Sending…" : "Send reset link"}
                </button>

                <button
                  type="button"
                  onClick={() => switchMode("signin")}
                  className="w-full mt-3 py-2 text-base text-gray-500 hover:text-gray-700"
                >
                  Back to sign in
                </button>
              </form>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-8">
            {error && (
              <div className="text-base text-red-600 bg-red-50 rounded-lg px-4 py-3 mb-5">{error}</div>
            )}

            <label className="block mb-5">
              <span className="text-base text-gray-500 font-medium">Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1.5 w-full px-4 py-3 text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-300"
                required
              />
            </label>

            <label className="block mb-2">
              <span className="text-base text-gray-500 font-medium">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 w-full px-4 py-3 text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-300"
                required
              />
            </label>

            <div className="flex justify-end mb-6">
              <button
                type="button"
                onClick={() => switchMode("reset")}
                className="text-sm text-gray-400 hover:text-gray-600"
              >
                Forgot password?
              </button>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 text-base font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
            >
              {submitting ? "Signing in..." : "Sign in"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
