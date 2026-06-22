import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

interface ExtraRequest {
  id: string;
  item_requested: string;
  status: string;
  approval_status: string | null;
  approved_by_phone: string | null;
  delivery_at: string | null;
  created_at: string;
  properties?: { name: string };
}

const approvalColor: Record<string, string> = {
  pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
  approved: "bg-green-50 text-green-700 border-green-200",
  declined: "bg-red-50 text-red-700 border-red-200",
};
const approvalLabel: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  declined: "Declined",
};

function effectiveApproval(r: ExtraRequest): string {
  // declined at the allowed-extras check has status "declined" with no approval_status
  if (r.status === "declined") return "declined";
  return r.approval_status ?? "pending";
}

export default function ExtraRequests() {
  const [rows, setRows] = useState<ExtraRequest[]>([]);
  const [filter, setFilter] = useState("pending");

  const load = () => {
    supabase
      .from("extra_requests")
      .select("*, properties(name)")
      .order("created_at", { ascending: false })
      .then(({ data }) => setRows((data as ExtraRequest[]) ?? []));
  };
  useEffect(load, []);

  const setApproval = async (id: string, decision: "approved" | "declined") => {
    await supabase.from("extra_requests").update({ approval_status: decision }).eq("id", id);
    load();
  };

  const filtered = rows.filter((r) => (filter === "all" ? true : effectiveApproval(r) === filter));

  return (
    <div className="w-full px-4 sm:px-6 py-6 lg:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Extra Requests</h1>
        <div className="flex gap-1.5">
          {["pending", "approved", "declined", "all"].map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-4 py-1.5 text-sm rounded-lg ${filter === s ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
              {s === "all" ? "All" : approvalLabel[s] || s}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-base">
          <thead>
            <tr className="border-b border-gray-100 text-sm text-gray-400 uppercase tracking-wider">
              <th className="text-left px-5 py-4 font-medium">Property</th>
              <th className="text-left px-5 py-4 font-medium">Requested item</th>
              <th className="text-left px-5 py-4 font-medium w-32">Status</th>
              <th className="text-left px-5 py-4 font-medium w-44">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const appr = effectiveApproval(r);
              return (
                <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-5 py-4">
                    <div className="text-base font-medium text-gray-900">{(r.properties as any)?.name ?? "—"}</div>
                    <div className="text-sm text-gray-400">{new Date(r.created_at).toLocaleString("en-US", { timeZone: "Australia/Melbourne" })}</div>
                  </td>
                  <td className="px-5 py-4 text-gray-700">{r.item_requested}</td>
                  <td className="px-5 py-4">
                    <span className={`inline-flex items-center px-3 py-1 rounded-lg text-sm font-medium border ${approvalColor[appr] ?? "bg-gray-100 text-gray-500 border-gray-200"}`}>
                      {approvalLabel[appr] ?? appr}
                    </span>
                  </td>
                  <td className="px-5 py-4">
                    {appr === "pending" ? (
                      <div className="flex gap-2">
                        <button onClick={() => setApproval(r.id, "approved")}
                          className="px-3 py-1.5 text-sm font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">Approve</button>
                        <button onClick={() => setApproval(r.id, "declined")}
                          className="px-3 py-1.5 text-sm font-medium rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-50">Decline</button>
                      </div>
                    ) : (
                      <span className="text-sm text-gray-400">
                        {r.approved_by_phone ? `by ${r.approved_by_phone}` : "—"}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={4} className="px-5 py-10 text-center text-gray-400 text-base">No extra requests found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
