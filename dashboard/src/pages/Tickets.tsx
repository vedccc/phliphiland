import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Plus, Upload, FileText, X, Eye, Download } from "lucide-react";

interface Ticket {
  id: string;
  description: string;
  urgency: string;
  status: string;
  guest_context: string;
  reservation_uuid: string;
  created_at: string;
  resolved_at: string | null;
  properties?: { name: string };
}

interface TicketFile {
  id: string;
  ticket_id: string;
  file_name: string;
  file_url: string;
}

const urgencyColor: Record<string, string> = {
  high: "bg-red-100 text-red-700 border-red-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  low: "bg-green-100 text-green-700 border-green-200",
};
const urgencyDot: Record<string, string> = {
  high: "bg-red-500",
  medium: "bg-amber-500",
  low: "bg-green-500",
};

const statuses = ["open", "in_progress", "resolved"];
const statusColor: Record<string, string> = {
  open: "bg-yellow-50 text-yellow-700 border-yellow-200",
  in_progress: "bg-blue-50 text-blue-700 border-blue-200",
  resolved: "bg-green-50 text-green-700 border-green-200",
};
const statusLabel: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
};

const INVOICE_BUCKET = "ticket-invoices";
const isImage = (n: string) => /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(n);
const isPdf = (n: string) => /\.pdf$/i.test(n);

export default function Tickets() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [files, setFiles] = useState<Record<string, TicketFile[]>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [filter, setFilter] = useState("open");
  const [adding, setAdding] = useState(false);
  const [properties, setProperties] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({ property_id: "", description: "", urgency: "medium", status: "open" });
  const [newFile, setNewFile] = useState<File | null>(null);
  // Invoice preview modal
  const [viewTicketId, setViewTicketId] = useState<string | null>(null);
  const [viewIndex, setViewIndex] = useState(0);
  const [downloadingAll, setDownloadingAll] = useState(false);

  const load = () => {
    let q = supabase.from("maintenance_tickets").select("*, properties(name)").order("created_at", { ascending: false });
    if (filter !== "all") q = q.eq("status", filter);
    q.then(({ data }) => setTickets((data as Ticket[]) ?? []));
  };

  const loadFiles = () => {
    supabase.from("ticket_files").select("*").then(({ data }) => {
      const m: Record<string, TicketFile[]> = {};
      (data as TicketFile[] ?? []).forEach((f) => { (m[f.ticket_id] ??= []).push(f); });
      setFiles(m);
    });
  };

  useEffect(load, [filter]);
  useEffect(() => { loadFiles(); }, []);
  useEffect(() => { supabase.from("properties").select("id, name").order("name").then(({ data }) => setProperties(data ?? [])); }, []);

  const canAdd = form.property_id !== "" && form.description.trim() !== "";
  const addTicket = async () => {
    if (!canAdd) return;
    const { data: created, error } = await supabase.from("maintenance_tickets").insert({
      property_id: form.property_id,
      description: form.description.trim(),
      urgency: form.urgency,
      status: form.status,
      guest_context: "Manually created",
      reservation_uuid: "manual",
    }).select("id").single();
    if (error || !created) { alert("Could not create ticket: " + (error?.message ?? "unknown")); return; }
    if (newFile) await uploadInvoice(created.id, newFile);
    setForm({ property_id: "", description: "", urgency: "medium", status: "open" });
    setNewFile(null);
    setAdding(false);
    load();
  };

  const updateField = async (id: string, field: string, value: string) => {
    const update: Record<string, unknown> = { [field]: value };
    if (field === "status" && value === "resolved") update.resolved_at = new Date().toISOString();
    if (field === "status" && value !== "resolved") update.resolved_at = null;
    await supabase.from("maintenance_tickets").update(update).eq("id", id);
    load();
  };

  const uploadInvoice = async (ticketId: string, file: File) => {
    setUploading(ticketId);
    try {
      const path = `${ticketId}/${Date.now()}-${file.name.replace(/[^\w.\-]/g, "_")}`;
      const { error: upErr } = await supabase.storage.from(INVOICE_BUCKET).upload(path, file, { upsert: false });
      if (upErr) { alert("Upload failed: " + upErr.message); return; }
      const { data: pub } = supabase.storage.from(INVOICE_BUCKET).getPublicUrl(path);
      const { error: insErr } = await supabase.from("ticket_files").insert({ ticket_id: ticketId, file_name: file.name, file_url: pub.publicUrl });
      if (insErr) { alert("Saving file failed: " + insErr.message); return; }
      loadFiles();
    } finally {
      setUploading(null);
    }
  };

  const removeFile = async (f: TicketFile) => {
    if (!confirm(`Remove "${f.file_name}"?`)) return;
    await supabase.from("ticket_files").delete().eq("id", f.id);
    loadFiles();
  };

  // Fetch-then-download so cross-origin Storage URLs actually save (the <a download>
  // attribute is ignored cross-origin, so we download the blob and save it locally).
  const downloadOne = async (f: TicketFile) => {
    try {
      const res = await fetch(f.file_url);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = f.file_name;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch {
      window.open(f.file_url, "_blank");
    }
  };

  const downloadAll = async (list: TicketFile[]) => {
    setDownloadingAll(true);
    try { for (const f of list) await downloadOne(f); } finally { setDownloadingAll(false); }
  };

  const openView = (ticketId: string) => { setViewTicketId(ticketId); setViewIndex(0); };

  return (
    <div className="w-full px-4 sm:px-6 py-6 lg:py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-semibold text-gray-900">Maintenance Tickets</h1>
          <button onClick={() => setAdding(!adding)} className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
            <Plus size={16} /> Add Ticket
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {["open", "in_progress", "resolved", "all"].map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-4 py-1.5 text-sm rounded-lg ${filter === s ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>
              {s === "all" ? "All" : statusLabel[s] || s}
            </button>
          ))}
        </div>
      </div>

      {adding && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-5">
            <label className="block">
              <span className="text-sm text-gray-400 font-medium uppercase">Property</span>
              <select value={form.property_id} onChange={(e) => setForm({ ...form, property_id: e.target.value })}
                className="mt-1.5 w-full px-4 py-2 text-base border border-gray-200 rounded-lg">
                <option value="">Select property…</option>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-sm text-gray-400 font-medium uppercase">Description</span>
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="mt-1.5 w-full px-4 py-2 text-base border border-gray-200 rounded-lg" placeholder="Describe the issue…" />
            </label>
          </div>
          <div className="flex flex-wrap gap-6 mb-5">
            <label className="block">
              <span className="text-sm text-gray-400 font-medium uppercase">Urgency</span>
              <select value={form.urgency} onChange={(e) => setForm({ ...form, urgency: e.target.value })}
                className="block mt-3 px-4 py-2 text-base border border-gray-200 rounded-lg">
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm text-gray-400 font-medium uppercase">Status</span>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="block mt-3 px-4 py-2 text-base border border-gray-200 rounded-lg">
                {statuses.map((s) => <option key={s} value={s}>{statusLabel[s]}</option>)}
              </select>
            </label>
          </div>
          <label className="block mb-5">
            <span className="text-sm text-gray-400 font-medium uppercase">Invoice (optional)</span>
            <input type="file" onChange={(e) => setNewFile(e.target.files?.[0] ?? null)}
              className="mt-1.5 block w-full text-sm text-gray-600 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200" />
            {newFile && <span className="text-xs text-gray-400 mt-1 block">Selected: {newFile.name}</span>}
          </label>
          <button onClick={addTicket} disabled={!canAdd} className={`px-5 py-2 text-base font-medium rounded-lg ${canAdd ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-gray-200 text-gray-400 cursor-not-allowed"}`}>Save</button>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-base min-w-[820px]">
          <thead>
            <tr className="border-b border-gray-100 text-sm text-gray-400 uppercase tracking-wider">
              <th className="text-left px-5 py-4 font-medium w-28">Priority</th>
              <th className="text-left px-5 py-4 font-medium">Property</th>
              <th className="text-left px-5 py-4 font-medium">Issue</th>
              <th className="text-left px-5 py-4 font-medium w-64">Invoices</th>
              <th className="text-left px-5 py-4 font-medium w-36">Status</th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => {
              const count = (files[t.id] ?? []).length;
              return (
                <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50/50 align-top">
                  {/* Priority — read-only, set by AI */}
                  <td className="px-5 py-4">
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-sm font-medium border ${urgencyColor[t.urgency] ?? "bg-gray-100 text-gray-500 border-gray-200"}`}>
                      <span className={`w-2 h-2 rounded-full ${urgencyDot[t.urgency]}`} />
                      {t.urgency.charAt(0).toUpperCase() + t.urgency.slice(1)}
                    </span>
                  </td>
                  {/* Property + date */}
                  <td className="px-5 py-4">
                    <div className="text-base font-medium text-gray-900">{(t.properties as any)?.name}</div>
                    <div className="text-sm text-gray-400">{new Date(t.created_at).toLocaleString("en-US", { timeZone: "Australia/Melbourne" })}</div>
                  </td>
                  {/* Description */}
                  <td className="px-5 py-4 text-gray-700">{t.description}</td>
                  {/* Invoices — View + Upload */}
                  <td className="px-5 py-4">
                    <div className="flex flex-col gap-1.5 items-start">
                      <button
                        onClick={() => openView(t.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
                      >
                        <Eye size={14} /> View invoices ({count})
                      </button>
                      <label className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg cursor-pointer ${uploading === t.id ? "text-gray-300 bg-gray-50" : "text-emerald-700 bg-emerald-50 hover:bg-emerald-100"}`}>
                        <Upload size={14} /> {uploading === t.id ? "Uploading…" : "Upload invoice"}
                        <input type="file" className="hidden" disabled={uploading === t.id}
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadInvoice(t.id, f); e.currentTarget.value = ""; }} />
                      </label>
                    </div>
                  </td>
                  {/* Status dropdown */}
                  <td className="px-5 py-4">
                    <select value={t.status} onChange={(e) => updateField(t.id, "status", e.target.value)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border appearance-none cursor-pointer ${statusColor[t.status] ?? "bg-gray-100 text-gray-500 border-gray-200"}`}>
                      {statuses.map((s) => (
                        <option key={s} value={s}>{statusLabel[s]}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
            {tickets.length === 0 && (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-gray-400 text-base">No tickets found.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Invoice preview modal */}
      {viewTicketId && (() => {
        const list = files[viewTicketId] ?? [];
        const active = list[viewIndex];
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setViewTicketId(null)}>
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-gray-100">
                <h2 className="text-base font-semibold text-gray-900">Invoices ({list.length})</h2>
                <div className="flex items-center gap-2">
                  {list.length > 0 && (
                    <button onClick={() => downloadAll(list)} disabled={downloadingAll}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50">
                      <Download size={14} /> {downloadingAll ? "Downloading…" : "Download all"}
                    </button>
                  )}
                  <button onClick={() => setViewTicketId(null)} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100" aria-label="Close"><X size={18} /></button>
                </div>
              </div>

              {list.length === 0 ? (
                <div className="flex-1 flex items-center justify-center text-gray-400">No invoices uploaded yet.</div>
              ) : (
                <div className="flex flex-1 min-h-0">
                  {/* file switcher */}
                  <div className="w-56 shrink-0 border-r border-gray-100 overflow-y-auto">
                    {list.map((f, i) => (
                      <div
                        key={f.id}
                        onClick={() => setViewIndex(i)}
                        className={`group/f w-full text-left px-4 py-3 border-b border-gray-50 flex items-center gap-2 text-sm cursor-pointer ${i === viewIndex ? "bg-emerald-50 text-emerald-700 font-medium" : "text-gray-600 hover:bg-gray-50"}`}
                      >
                        <FileText size={14} className="shrink-0" />
                        <span className="truncate flex-1">{f.file_name}</span>
                        <span onClick={(e) => { e.stopPropagation(); removeFile(f); }}
                          className="text-gray-300 hover:text-red-500 opacity-0 group-hover/f:opacity-100" title="Remove"><X size={13} /></span>
                      </div>
                    ))}
                  </div>
                  {/* live preview */}
                  <div className="flex-1 min-w-0 flex flex-col">
                    <div className="flex-1 min-h-0 overflow-auto bg-gray-50 flex items-center justify-center p-4">
                      {active && (isImage(active.file_name) ? (
                        <img src={active.file_url} alt={active.file_name} className="max-w-full max-h-full object-contain" />
                      ) : isPdf(active.file_name) ? (
                        <iframe src={active.file_url} title={active.file_name} className="w-full h-full border-0" />
                      ) : (
                        <div className="text-center text-gray-500">
                          <FileText size={40} className="mx-auto mb-2 text-gray-300" />
                          <div className="text-sm">No in-app preview for this file type — use Download.</div>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-gray-100">
                      <span className="text-sm text-gray-500 truncate">{active?.file_name}</span>
                      {active && (
                        <button onClick={() => downloadOne(active)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 shrink-0">
                          <Download size={14} /> Download
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
