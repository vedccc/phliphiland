import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";

// Capture the landing hash at import time, before supabase-js's detectSessionInUrl
// parses and strips it. On success the hash carries #access_token=…; on failure
// (expired or already-consumed token — e.g. an email scanner pre-fetched the
// one-time link) it carries #error_description=…. We read both from here.
const INITIAL_HASH = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
const HASH_PARAMS = new URLSearchParams(INITIAL_HASH);
const URL_ERROR_RAW = HASH_PARAMS.get("error_description") || HASH_PARAMS.get("error");
const URL_ERROR = URL_ERROR_RAW ? decodeURIComponent(URL_ERROR_RAW.replace(/\+/g, " ")) : null;
const HAS_TOKEN = HASH_PARAMS.has("access_token");

// Landing page for the password-setting link in Supabase invite AND password
// recovery emails — both work identically: the link carries the session in the
// URL hash; supabase-js (detectSessionInUrl, on by default) parses it and signs
// the user in, so by the time this mounts we usually already have a session. We
// just collect a password and finalize it with updateUser(). The `mode` prop
// only swaps the copy (invite vs. forgot-password recovery).
export default function AcceptInvite({ mode = "invite" }: { mode?: "invite" | "recovery" }) {
  const navigate = useNavigate();
  const isRecovery = mode === "recovery";
  const t = isRecovery
    ? {
        subtitleReady: "Choose a new password",
        subtitleIdle: "Reset your password",
        verifying: "Verifying your reset link…",
        invalid: "Request a new reset link from the sign-in page.",
        emailLine: "Resetting password for",
      }
    : {
        subtitleReady: "Set your password to finish",
        subtitleIdle: "Accept your invitation",
        verifying: "Verifying your invite…",
        invalid: "Ask an admin to send a new invite.",
        emailLine: "Creating access for",
      };
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    // Verify endpoint redirected back with an explicit error (expired/used token,
    // or a scanner pre-consumed the one-time link). Show the real reason now.
    if (URL_ERROR) {
      setLinkError(URL_ERROR);
      setReady(true);
      return;
    }

    // The hash session is parsed asynchronously; wait for it (or an existing one).
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setEmail(session.user.email ?? null);
        setReady(true);
      }
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setEmail(session.user.email ?? null);
        setReady(true);
      } else {
        // No session yet. If a token is present in the hash, detectSessionInUrl
        // is still working — wait longer so we don't flash "invalid" on a valid
        // link (slow device/network). With no token, it's a bare visit: bail fast.
        setTimeout(() => setReady(true), HAS_TOKEN ? 6000 : 1500);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 6) return setError("Password must be at least 6 characters.");
    if (password !== confirm) return setError("Passwords do not match.");
    setSubmitting(true);
    const { error } = await supabase.auth.updateUser({ password });
    setSubmitting(false);
    if (error) return setError(error.message);
    navigate("/", { replace: true });
  };

  const hasSession = ready && email !== null;

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50">
      <div className="w-full max-w-md">
        <div className="text-center mb-10">
          <img src="/logo.jpg" alt="Phillip Island Host" className="w-full max-w-[240px] h-auto mx-auto mb-4" />
          <p className="text-base text-gray-400 mt-1">
            {hasSession ? t.subtitleReady : t.subtitleIdle}
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-8">
          {!ready ? (
            <div className="text-base text-gray-400 text-center py-4">{t.verifying}</div>
          ) : !hasSession ? (
            <div className="text-base text-gray-600">
              <p className="mb-2 font-medium text-gray-800">{linkError ?? "This link is invalid or has expired."}</p>
              <p className="mb-4">{t.invalid}</p>
              <button
                onClick={() => navigate("/login", { replace: true })}
                className="w-full py-3 text-base font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800"
              >
                Go to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={submit}>
              {error && (
                <div className="text-base text-red-600 bg-red-50 rounded-lg px-4 py-3 mb-5">{error}</div>
              )}
              {email && (
                <p className="text-sm text-gray-400 mb-5">{t.emailLine} <span className="font-medium text-gray-600">{email}</span></p>
              )}

              <label className="block mb-5">
                <span className="text-base text-gray-500 font-medium">New password</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1.5 w-full px-4 py-3 text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-300"
                  placeholder="min 6 characters"
                  required
                />
              </label>

              <label className="block mb-6">
                <span className="text-base text-gray-500 font-medium">Confirm password</span>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="mt-1.5 w-full px-4 py-3 text-base border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-300"
                  required
                />
              </label>

              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 text-base font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
              >
                {submitting ? "Saving…" : "Set password & continue"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
