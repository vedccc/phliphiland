import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { callEdge } from "../../lib/edge";
import { CheckCircle2, Circle, User } from "lucide-react";

interface ChecklistItem {
  id: string;
  body: string;
  sort_order: number;
  is_checked: boolean;
  checked_at: string | null;
  checked_by_email: string | null;
}
interface ChecklistData {
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

export default function CleanerChecklist() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ChecklistData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!token) return;
    const { status, data } = await callEdge<ChecklistData>("checklist-resolve", { token });
    if (status !== 200) {
      setError((data as any).detail || "Could not load checklist.");
    } else {
      setData(data as ChecklistData);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const toggle = async (item: ChecklistItem) => {
    if (!data || !token) return;
    const next = !item.is_checked;
    // Optimistic
    setData({
      ...data,
      items: data.items.map((i) => (i.id === item.id ? { ...i, is_checked: next } : i)),
    });
    await callEdge("checklist-mark-item", { token, item_id: item.id, is_checked: next });
    // Refresh so attribution + progress reflect server truth
    load();
  };

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl p-8 max-w-sm shadow text-center">
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Link not valid</h1>
          <p className="text-gray-500">{error}</p>
        </div>
      </div>
    );
  }
  if (!data) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading…</div>;

  const pct = data.progress.total === 0 ? 0 : Math.round((data.progress.done / data.progress.total) * 100);
  const allDone = data.progress.total > 0 && data.progress.done === data.progress.total;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-5 py-4 sticky top-0 z-10">
        <div className="text-xs text-gray-400 uppercase tracking-wider font-medium">Cleaning Checklist</div>
        <h1 className="text-xl font-semibold text-gray-900 mt-0.5">{data.property_name}</h1>
        {(data.check_in || data.check_out || data.guest_name) && (
          <div className="text-sm text-gray-500 mt-1">
            {data.guest_name && <span className="text-gray-700">{data.guest_name}</span>}
            {data.guest_name && (data.check_in || data.check_out) && <span className="mx-1.5 text-gray-300">·</span>}
            {data.check_in && <span>{data.check_in}</span>}
            {data.check_out && <span className="text-gray-300"> → </span>}
            {data.check_out && <span>{data.check_out}</span>}
          </div>
        )}
        <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center justify-between mt-1.5 text-xs">
          <span className="text-gray-400">{data.progress.done} of {data.progress.total} complete</span>
          {allDone && (
            <span className="text-emerald-600 font-medium">✓ All done</span>
          )}
        </div>
      </header>

      <main className="p-5 space-y-3 pb-12">
        {data.items.map((item) => (
          <button
            key={item.id}
            onClick={() => toggle(item)}
            className={`w-full text-left p-4 rounded-xl border flex items-start gap-3 transition-colors ${
              item.is_checked ? "bg-emerald-50 border-emerald-200" : "bg-white border-gray-200"
            }`}
          >
            {item.is_checked ? (
              <CheckCircle2 size={26} className="text-emerald-500 shrink-0 mt-0.5" />
            ) : (
              <Circle size={26} className="text-gray-300 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <div className={`text-base ${item.is_checked ? "text-emerald-900 line-through" : "text-gray-800"}`}>
                {item.body}
              </div>
              {item.is_checked && item.checked_by_email && (
                <div className="flex items-center gap-1 mt-1 text-xs text-emerald-700/70">
                  <User size={11} />
                  {shortName(item.checked_by_email)}
                  {item.checked_at && <span className="text-emerald-600/60"> · {formatRelative(item.checked_at)}</span>}
                </div>
              )}
              {item.is_checked && !item.checked_by_email && item.checked_at && (
                <div className="text-xs text-emerald-700/60 mt-1">{formatRelative(item.checked_at)}</div>
              )}
            </div>
          </button>
        ))}
      </main>
    </div>
  );
}
