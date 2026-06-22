import { useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { KeyRound, AlertCircle, CheckCircle2 } from "lucide-react";

export default function Profile() {
  const { user, profile } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBanner(null);
    if (password.length < 6) return setBanner({ kind: "err", text: "Password must be at least 6 characters." });
    if (password !== confirm) return setBanner({ kind: "err", text: "Passwords do not match." });

    setSaving(true);
    // updateUser() acts only on the currently signed-in user's own account.
    const { error } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (error) return setBanner({ kind: "err", text: error.message });
    setPassword("");
    setConfirm("");
    setBanner({ kind: "ok", text: "Password updated." });
  };

  return (
    <div className="w-full max-w-2xl px-4 sm:px-6 py-6 lg:py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Profile</h1>
        <p className="text-sm text-gray-400 mt-0.5">Your account and password</p>
      </div>

      {banner && (
        <div className={`flex items-center gap-2 rounded-lg px-4 py-2.5 mb-4 text-sm ${
          banner.kind === "ok"
            ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
            : "bg-red-50 border border-red-200 text-red-700"
        }`}>
          {banner.kind === "ok" ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {banner.text}
        </div>
      )}

      {/* Account */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <div className="text-base font-medium text-gray-900 mb-4">Account</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Email</span>
            <div className="text-sm text-gray-800 mt-1">{profile?.email ?? user?.email}</div>
          </div>
          <div>
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Role</span>
            <div className="text-sm text-gray-800 mt-1">{profile?.role === "super_admin" ? "Admin" : "Member"}</div>
          </div>
        </div>
      </div>

      {/* Change password */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center gap-2 text-base font-medium text-gray-900 mb-4">
          <KeyRound size={18} className="text-gray-400" /> Change password
        </div>
        <form onSubmit={changePassword} className="space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">New password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-300"
              placeholder="min 6 characters"
              autoComplete="new-password"
              required
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Confirm password</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="mt-1.5 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-gray-300"
              autoComplete="new-password"
              required
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? "Updating…" : "Update password"}
          </button>
        </form>
      </div>
    </div>
  );
}
