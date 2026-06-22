import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { Plus, Trash2, ChevronDown, ChevronUp, Key, AlertCircle, CheckCircle2, Copy } from "lucide-react";

interface ProfileRow {
  id: string;
  email: string;
  role: string;
  can_view_kb: boolean;
  can_view_maintenance: boolean;
  can_view_reservations: boolean;
  last_sign_in_at: string | null;
}

async function callManage<T = unknown>(body: object): Promise<{ status: number; data: T | { status: string; detail?: string; message?: string } }> {
  const { data: { session } } = await supabase.auth.getSession();
  const jwt = session?.access_token;
  if (!jwt) return { status: 401, data: { status: "error", detail: "not_signed_in" } };
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
  const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/manage-users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
      apikey: ANON,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function formatLastSignIn(iso: string | null): string {
  if (!iso) return "never signed in";
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function Users() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // Per-user dirty flag for unsaved permission edits + which row is currently saving.
  const [dirtyAccess, setDirtyAccess] = useState<Record<string, boolean>>({});
  const [savingAccess, setSavingAccess] = useState<string | null>(null);

  // Invite form
  const [showInvite, setShowInvite] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "super_admin">("member");
  const [inviteKB, setInviteKB] = useState(true);
  const [inviteMaintenance, setInviteMaintenance] = useState(true);
  const [inviteSuccess, setInviteSuccess] = useState<{ email: string; password: string } | null>(null);

  // Per-row reset password state
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetting, setResetting] = useState(false);

  const showOk = (text: string) => {
    setBanner({ kind: "ok", text });
    setTimeout(() => setBanner(null), 4000);
  };
  const showErr = (text: string) => {
    setBanner({ kind: "err", text });
    setTimeout(() => setBanner(null), 6000);
  };

  const loadUsers = async () => {
    setLoading(true);
    const { status, data } = await callManage<{ users: ProfileRow[] }>({ op: "list" });
    if (status !== 200 || (data as any).status !== "ok") {
      showErr(((data as any).detail || "Could not load users.") as string);
      setLoading(false);
      return;
    }
    setUsers((data as any).users ?? []);
    setLoading(false);
  };

  useEffect(() => { loadUsers(); }, []);

  const invite = async () => {
    if (!inviteEmail) return;
    setInviting(true);
    const { status, data } = await callManage<{ password: string }>({
      op: "create",
      email: inviteEmail,
      role: inviteRole,
      can_view_kb: inviteKB,
      can_view_maintenance: inviteMaintenance,
    });
    setInviting(false);
    if (status !== 200 || (data as any).status !== "ok") {
      showErr(((data as any).message || (data as any).detail || "Could not create user.") as string);
      return;
    }
    setInviteSuccess({ email: inviteEmail, password: (data as any).password });
    setInviteEmail(""); setInviteRole("member");
    setInviteKB(true); setInviteMaintenance(true);
    setShowInvite(false);
    loadUsers();
  };

  const changeRole = async (userId: string, newRole: string) => {
    const { status, data } = await callManage({ op: "update_role", user_id: userId, role: newRole });
    if (status !== 200 || (data as any).status !== "ok") {
      showErr(((data as any).message || (data as any).detail || "Could not change role.") as string);
      return;
    }
    showOk(`Role updated.`);
    loadUsers();
  };

  // Checkbox clicks only mutate local state and mark the row dirty — nothing is
  // persisted until the user hits "Save permissions".
  const togglePermLocal = (userId: string, field: "can_view_kb" | "can_view_maintenance" | "can_view_reservations") => {
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, [field]: !u[field] } : u)));
    setDirtyAccess((d) => ({ ...d, [userId]: true }));
  };

  const saveAccess = async (u: ProfileRow) => {
    setSavingAccess(u.id);
    const { status, data } = await callManage({
      op: "update_access",
      user_id: u.id,
      can_view_kb: u.can_view_kb,
      can_view_maintenance: u.can_view_maintenance,
      can_view_reservations: u.can_view_reservations,
    });
    setSavingAccess(null);
    if (status !== 200 || (data as any).status !== "ok") {
      showErr(((data as any).message || (data as any).detail || "Could not update access.") as string);
      return;
    }
    setDirtyAccess((d) => {
      const next = { ...d };
      delete next[u.id];
      return next;
    });
    showOk("Permissions saved.");
  };

  const deleteUser = async (userId: string, email: string) => {
    if (!confirm(`Remove ${email}? This permanently deletes their auth account.`)) return;
    const { status, data } = await callManage({ op: "delete", user_id: userId });
    if (status !== 200 || (data as any).status !== "ok") {
      showErr(((data as any).message || (data as any).detail || "Could not delete user.") as string);
      return;
    }
    showOk(`Removed ${email}.`);
    loadUsers();
  };

  const submitReset = async () => {
    if (!resetUserId || resetPassword.length < 6) return;
    setResetting(true);
    const { status, data } = await callManage({ op: "reset_password", user_id: resetUserId, new_password: resetPassword });
    setResetting(false);
    if (status !== 200 || (data as any).status !== "ok") {
      showErr(((data as any).message || (data as any).detail || "Could not reset password.") as string);
      return;
    }
    showOk("Password updated. Share the new password with the user.");
    setResetUserId(null);
    setResetPassword("");
  };

  return (
    <div className="w-full px-4 sm:px-6 py-6 lg:py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">User Management</h1>
          <p className="text-sm text-gray-400 mt-0.5">{users.length} user{users.length === 1 ? "" : "s"}</p>
        </div>
        <button
          onClick={() => { setShowInvite(!showInvite); setInviteSuccess(null); }}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
        >
          <Plus size={18} /> Add User
        </button>
      </div>

      {/* Banner */}
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

      {/* Created-user credentials card */}
      {inviteSuccess && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-5 mb-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-base font-medium text-emerald-800">User created — share these credentials</div>
              <div className="text-sm text-emerald-700 mt-1">
                No email is sent. Copy the login details below and give them to the user. This is their permanent login — only an admin can reset it.
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 max-w-xl">
                <div className="bg-white border border-emerald-200 rounded-lg px-3 py-2">
                  <div className="text-xs text-gray-400 uppercase tracking-wider">Email</div>
                  <div className="text-sm font-mono text-gray-800 break-all">{inviteSuccess.email}</div>
                </div>
                <div className="bg-white border border-emerald-200 rounded-lg px-3 py-2">
                  <div className="text-xs text-gray-400 uppercase tracking-wider">Temporary password</div>
                  <div className="text-sm font-mono text-gray-800 break-all">{inviteSuccess.password}</div>
                </div>
              </div>
              <button
                onClick={() => { navigator.clipboard?.writeText(`Email: ${inviteSuccess.email}\nPassword: ${inviteSuccess.password}`); showOk("Credentials copied."); }}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-emerald-800 bg-white border border-emerald-300 rounded-lg hover:bg-emerald-100"
              >
                <Copy size={14} /> Copy credentials
              </button>
            </div>
            <button onClick={() => setInviteSuccess(null)} className="text-emerald-400 hover:text-emerald-600 p-1 shrink-0">
              <ChevronUp size={18} />
            </button>
          </div>
        </div>
      )}

      {/* Invite form */}
      {showInvite && (
        <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
          <div className="text-base font-medium text-gray-900 mb-4">Add new user</div>
          <div className="mb-4">
            <label className="block">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Email</span>
              <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} type="email"
                className="mt-1.5 w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" placeholder="user@example.com" />
            </label>
            <p className="text-xs text-gray-400 mt-1.5">A login is created with a generated password — you'll see it after creating, to share with the user.</p>
          </div>
          <div className="mb-4">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Role</span>
            <div className="flex gap-2 mt-1.5">
              {(["member", "super_admin"] as const).map((r) => (
                <button key={r} onClick={() => setInviteRole(r)}
                  className={`px-4 py-1.5 text-sm rounded-lg border transition-colors ${inviteRole === r
                    ? "bg-emerald-600 text-white border-gray-900"
                    : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>
                  {r === "super_admin" ? "Admin" : "Member"}
                </button>
              ))}
            </div>
          </div>
          {inviteRole === "member" && (
            <div className="mb-4">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Can access</span>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-1.5">
                {[
                  { key: "kb", label: "Knowledge Base", value: inviteKB, set: setInviteKB },
                  { key: "m", label: "Maintenance", value: inviteMaintenance, set: setInviteMaintenance },
                ].map((c) => (
                  <label key={c.key} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-100 hover:bg-gray-50 cursor-pointer">
                    <input type="checkbox" checked={c.value} onChange={(e) => c.set(e.target.checked)}
                      className="rounded w-4 h-4 text-gray-900" />
                    <span className="text-sm text-gray-700">{c.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={invite} disabled={inviting || !inviteEmail}
              className="px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50">
              {inviting ? "Creating..." : "Create user"}
            </button>
            <button onClick={() => setShowInvite(false)} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
          </div>
        </div>
      )}

      {/* User list */}
      {loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-2">
          {users.map((u) => {
            const isExpanded = expandedUser === u.id;
            const isAdmin = u.role === "super_admin";
            const isSelf = currentUser?.id === u.id;
            const accessSummary = [
              u.can_view_kb && "KB",
              u.can_view_maintenance && "Maintenance",
            ].filter(Boolean).join(" · ") || "No access";

            return (
              <div key={u.id} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div
                  className="flex items-center justify-between px-5 py-3.5 cursor-pointer hover:bg-gray-50/50 transition-colors gap-3"
                  onClick={() => setExpandedUser(isExpanded ? null : u.id)}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">
                      {u.email}
                      {isSelf && <span className="ml-2 text-xs text-gray-400 font-normal">(you)</span>}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      Last seen: {formatLastSignIn(u.last_sign_in_at)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                      isAdmin ? "bg-purple-50 text-purple-700 ring-1 ring-purple-200" : "bg-gray-100 text-gray-600 ring-1 ring-gray-200"
                    }`}>
                      {isAdmin ? "Admin" : "Member"}
                    </span>
                    {!isAdmin && <span className="hidden sm:block text-xs text-gray-400 max-w-[18rem] truncate">{accessSummary}</span>}
                    {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-gray-100 px-5 py-4 bg-gray-50/40 space-y-4">
                    {/* Role row */}
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Role</span>
                        {isSelf ? (
                          <span className="text-sm text-gray-500">{isAdmin ? "Admin" : "Member"}</span>
                        ) : (
                          <select value={u.role} onChange={(e) => changeRole(u.id, e.target.value)}
                            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white cursor-pointer">
                            <option value="member">Member</option>
                            <option value="super_admin">Admin</option>
                          </select>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => { setResetUserId(u.id); setResetPassword(""); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
                        >
                          <Key size={13} /> Reset password
                        </button>
                        {!isSelf && (
                          <button
                            onClick={() => deleteUser(u.id, u.email)}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50"
                          >
                            <Trash2 size={13} /> Remove
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Reset password inline form */}
                    {resetUserId === u.id && (
                      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-lg p-3">
                        <input
                          type="text" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)}
                          placeholder="new password (min 6 chars)"
                          className="flex-1 px-3 py-1.5 text-sm font-mono border border-gray-200 rounded-lg"
                        />
                        <button onClick={submitReset} disabled={resetting || resetPassword.length < 6}
                          className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-lg disabled:opacity-40">
                          {resetting ? "..." : "Save"}
                        </button>
                        <button onClick={() => { setResetUserId(null); setResetPassword(""); }}
                          className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
                      </div>
                    )}

                    {/* Permissions */}
                    {!isAdmin ? (
                      <div>
                        <span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Can access</span>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-1.5">
                          {[
                            { key: "can_view_kb" as const, label: "Knowledge Base" },
                            { key: "can_view_maintenance" as const, label: "Maintenance" },
                          ].map((perm) => (
                            <label key={perm.key} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-100 bg-white hover:bg-gray-50 cursor-pointer">
                              <input
                                type="checkbox" checked={u[perm.key]}
                                onChange={() => togglePermLocal(u.id, perm.key)}
                                className="rounded w-4 h-4 text-gray-900"
                              />
                              <span className="text-sm text-gray-700">{perm.label}</span>
                            </label>
                          ))}
                        </div>
                        <div className="flex items-center gap-3 mt-3">
                          <button
                            onClick={() => saveAccess(u)}
                            disabled={!dirtyAccess[u.id] || savingAccess === u.id}
                            className="px-4 py-1.5 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {savingAccess === u.id ? "Saving…" : "Save permissions"}
                          </button>
                          {dirtyAccess[u.id] && savingAccess !== u.id && (
                            <span className="text-xs text-amber-600">Unsaved changes</span>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-gray-500 italic">Admins have full access to every section.</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
