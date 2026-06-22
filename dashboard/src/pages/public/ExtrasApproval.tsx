import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { callEdge } from "../../lib/edge";
import { Check, X, Calendar, Clock } from "lucide-react";

interface ExtrasData {
  property_name: string;
  guest_name: string | null;
  item_requested: string;
}

function defaultDeliveryISO(): string {
  // Default to tomorrow at 15:00 (3 PM) local time
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(15, 0, 0, 0);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

export default function ExtrasApproval() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ExtrasData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<"approved" | "declined" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deliveryStep, setDeliveryStep] = useState(false);
  const [deliveryAt, setDeliveryAt] = useState<string>(defaultDeliveryISO());

  useEffect(() => {
    if (!token) return;
    callEdge<ExtrasData | { status: string; decision?: string }>("extras-resolve", { token }).then(
      ({ status, data }) => {
        if (status === 200 && (data as any).status === "already_responded") {
          setResult(((data as any).decision as "approved" | "declined") ?? null);
        } else if (status !== 200) {
          setError((data as any).detail || "Could not load request.");
        } else {
          setData(data as ExtrasData);
        }
      },
    );
  }, [token]);

  const submit = async (decision: "approved" | "declined", deliveryIso?: string) => {
    if (!token) return;
    setSubmitting(true);
    const body: Record<string, unknown> = { token, decision };
    if (deliveryIso) body.delivery_at = new Date(deliveryIso).toISOString();
    const { status } = await callEdge("extras-respond", body);
    if (status === 200) setResult(decision);
    else setError("Could not record response. Try again.");
    setSubmitting(false);
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

  if (result) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl p-8 max-w-sm shadow text-center">
          {result === "approved" ? (
            <Check size={48} className="text-emerald-500 mx-auto mb-3" />
          ) : (
            <X size={48} className="text-red-500 mx-auto mb-3" />
          )}
          <h1 className="text-xl font-semibold text-gray-900">Recorded as {result}</h1>
          <p className="text-gray-500 mt-1">The guest will be updated automatically.</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl p-7 max-w-sm w-full shadow">
        <div className="text-xs text-gray-400 uppercase tracking-wider font-medium">Guest Request</div>
        <h1 className="text-xl font-semibold text-gray-900 mt-1">{data.property_name}</h1>
        {data.guest_name && <div className="text-sm text-gray-500 mt-0.5">from {data.guest_name}</div>}

        <div className="mt-5 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="text-xs text-amber-700 mb-1 uppercase tracking-wider font-medium">Requested item</div>
          <div className="text-lg text-gray-900 font-medium">{data.item_requested}</div>
        </div>

        {!deliveryStep ? (
          <div className="grid grid-cols-2 gap-3 mt-6">
            <button
              disabled={submitting}
              onClick={() => submit("declined")}
              className="py-3 text-base font-medium bg-white border border-red-300 text-red-600 rounded-xl hover:bg-red-50 disabled:opacity-50"
            >
              Decline
            </button>
            <button
              disabled={submitting}
              onClick={() => setDeliveryStep(true)}
              className="py-3 text-base font-medium bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:opacity-50"
            >
              Approve
            </button>
          </div>
        ) : (
          <div className="mt-6">
            <div className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-2">When will you deliver?</div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 mb-4">
              <div className="flex items-center gap-2 mb-1.5 text-xs text-gray-500">
                <Calendar size={12} /> Date <span className="mx-1 text-gray-300">·</span> <Clock size={12} /> Time
              </div>
              <input
                type="datetime-local"
                value={deliveryAt}
                onChange={(e) => setDeliveryAt(e.target.value)}
                className="w-full text-base px-3 py-2 border border-gray-200 rounded-lg bg-white"
              />
              <div className="text-xs text-gray-400 mt-1.5">
                The guest will be told their item arrives around this time.
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                disabled={submitting}
                onClick={() => setDeliveryStep(false)}
                className="py-3 text-base font-medium bg-white border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50 disabled:opacity-50"
              >
                Back
              </button>
              <button
                disabled={submitting || !deliveryAt}
                onClick={() => submit("approved", deliveryAt)}
                className="py-3 text-base font-medium bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 disabled:opacity-50"
              >
                {submitting ? "Sending…" : "Confirm"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
