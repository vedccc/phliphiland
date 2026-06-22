import { useAuth } from "../lib/auth";

export default function Profile() {
  const { user, profile } = useAuth();

  return (
    <div className="w-full max-w-2xl px-4 sm:px-6 py-6 lg:py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Profile</h1>
        <p className="text-sm text-gray-400 mt-0.5">Your account</p>
      </div>

      {/* Account */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
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
        <p className="text-xs text-gray-400 mt-4">
          Your password is set by an administrator and cannot be changed here. Contact your admin if you need it reset.
        </p>
      </div>
    </div>
  );
}
