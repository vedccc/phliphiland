import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { CheckCircle2, Circle, User } from "lucide-react";

interface ChecklistItem {
  id: string;
  body: string;
  sort_order: number;
  is_checked: boolean;
  checked_at: string | null;
  checked_by_email: string | null;
}
export interface ChecklistData {
  instance_id: string;
  property_name: string;
  guest_name: string | null;
  check_in: string | null;
  check_out: string | null;
  overall_status: string;
  completed_at: string | null;
  items: ChecklistItem[];
  progress: { done: number; total: number };
}

function shortName(email: string | null): string {
  if (!email) return "someone";
  const local = email.split("@")[0] ?? email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function formatRelative(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

async function callEdgeAuthed<T = unknown>(fn: string, body: Record<string, unknown>): Promise<{ status: number; data: T | any }> {
  const { data: { session } } = await supabase.auth.getSession();
  const jwt = session?.access_token;
  if (!jwt) return { status: 401, data: { status: "error", detail: "not_signed_in" } };
  const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
  const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
      apikey: ANON,
    },
    body: JSON.stringify({ ...body, jwt }),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

export default function ChecklistView({ instanceId, compact = false }: { instanceId: string; compact?: boolean }) {
  const [data, setData] = useState<ChecklistData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const { status, data } = await callEdgeAuthed<ChecklistData>("checklist-resolve", { instance_id: instanceId });
    if (status !== 200 || (data as any).status !== "ok") {
      setError(((data as any).detail || "Could not load checklist.") as string);
      return;
    }
    setData(data as ChecklistData);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  const toggle = async (item: ChecklistItem) => {
    if (!data) return;
    const next = !item.is_checked;
    // Optimistically update items AND progress/status so the bar moves instantly,
    // instead of waiting for the load() round-trip to recompute it.
    const items = data.items.map((i) => (i.id === item.id ? { ...i, is_checked: next } : i));
    const done = items.filter((i) => i.is_checked).length;
    const overall_status = done === 0 ? "pending" : done === data.progress.total ? "completed" : "in_progress";
    setData({ ...data, items, progress: { ...data.progress, done }, overall_status });
    await callEdgeAuthed("checklist-mark-item", { item_id: item.id, is_checked: next });
    load();
  };

  if (error) return <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</div>;
  if (!data) return <div className="text-gray-400 text-sm py-4">Loading checklist…</div>;

  const pct = data.progress.total === 0 ? 0 : Math.round((data.progress.done / data.progress.total) * 100);

  return (
    <div className={compact ? "" : "max-w-3xl"}>
      {/* Progress header */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs text-gray-500 mb-1.5">
          <span>{data.progress.done} of {data.progress.total} complete</span>
          {data.overall_status === "completed" && <span className="text-emerald-600 font-medium">✓ Completed</span>}
          {data.overall_status === "in_progress" && <span className="text-amber-600 font-medium">In progress</span>}
          {data.overall_status === "pending" && <span className="text-gray-400">Not started</span>}
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {data.items.length === 0 ? (
        <div className="text-sm text-gray-400 italic py-6 text-center">No checklist items.</div>
      ) : (
        <div className="space-y-2">
          {data.items.map((item) => (
            <button
              key={item.id}
              onClick={() => toggle(item)}
              className={`w-full text-left p-3 rounded-lg border flex items-start gap-3 transition-colors ${
                item.is_checked ? "bg-emerald-50/60 border-emerald-200" : "bg-white border-gray-200 hover:bg-gray-50"
              }`}
            >
              {item.is_checked ? (
                <CheckCircle2 size={20} className="text-emerald-500 shrink-0 mt-0.5" />
              ) : (
                <Circle size={20} className="text-gray-300 shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <div className={`text-sm ${item.is_checked ? "text-emerald-900 line-through" : "text-gray-800"}`}>
                  {item.body}
                </div>
                {item.is_checked && item.checked_by_email && (
                  <div className="flex items-center gap-1 mt-1 text-xs text-emerald-700/70">
                    <User size={10} />
                    {shortName(item.checked_by_email)}
                    {item.checked_at && <span className="text-emerald-600/60"> · {formatRelative(item.checked_at)}</span>}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
