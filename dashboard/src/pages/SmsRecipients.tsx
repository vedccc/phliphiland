import { Fragment, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Plus, Trash2, Pencil, Check, X, Clock } from "lucide-react";
import { DAY_KEYS, DEFAULT_SCHEDULE, isWithinSchedule, type DayKey, type WeeklySchedule } from "../lib/schedule";

interface Recipient {
  id: string; name: string; phone: string;
  receives_maintenance_low: boolean; receives_maintenance_medium: boolean; receives_maintenance_high: boolean;
  receives_kb_gaps: boolean; receives_checkin_checkout: boolean;
  receives_kb_general: boolean; receives_kb_cleaning: boolean; receives_kb_maintenance: boolean;
  receives_extras: boolean;
  is_active: boolean;
  schedule: WeeklySchedule | null; // null = texts at any time
}

const maintenanceFields = [
  { key: "receives_maintenance_high" as const, label: "High", color: "bg-red-500" },
  { key: "receives_maintenance_medium" as const, label: "Medium", color: "bg-amber-500" },
  { key: "receives_maintenance_low" as const, label: "Low", color: "bg-green-500" },
];

// "AI couldn't answer" texts. Each unanswered question is sorted into a category;
// All gets every one, whatever the category.
const kbFields = [
  { key: "receives_kb_gaps" as const, label: "All", color: "bg-blue-500" },
  { key: "receives_kb_general" as const, label: "General", color: "bg-sky-400" },
  { key: "receives_kb_cleaning" as const, label: "Cleaning", color: "bg-teal-500" },
  { key: "receives_kb_maintenance" as const, label: "Maintenance", color: "bg-indigo-500" },
];
const emptyForm = {
  name: "", phone: "",
  receives_maintenance_low: true, receives_maintenance_medium: true, receives_maintenance_high: true,
  receives_kb_gaps: true, receives_kb_general: false, receives_kb_cleaning: false, receives_kb_maintenance: false,
  receives_checkin_checkout: true,
  receives_extras: false,
  scheduled: false,
  schedule: DEFAULT_SCHEDULE as WeeklySchedule,
};

// ─── Days and times (Melbourne time) ─────────────────────────────────
// A recipient with a schedule only gets texts inside it; without one, at any time.
const DAY_SHORT: Record<DayKey, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

function fmt12(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

function withDefaults(raw: unknown): WeeklySchedule {
  const src = (raw && typeof raw === "object" ? raw : {}) as Partial<WeeklySchedule>;
  const out = {} as WeeklySchedule;
  for (const d of DAY_KEYS) out[d] = { ...DEFAULT_SCHEDULE[d], ...(src[d] ?? {}) };
  return out;
}

function scheduleSummary(s: WeeklySchedule): string {
  const on = DAY_KEYS.filter((d) => s[d].on);
  if (!on.length) return "No days set";
  const same = on.every((d) => s[d].start === s[on[0]].start && s[d].end === s[on[0]].end);
  if (!same) return on.map((d) => `${DAY_SHORT[d]} ${fmt12(s[d].start)}–${fmt12(s[d].end)}`).join(", ");
  const w = s[on[0]];
  const hours = w.start === w.end ? "all day" : `${fmt12(w.start)}–${fmt12(w.end)}`;
  return `${on.map((d) => DAY_SHORT[d]).join(", ")} · ${hours}`;
}

function scheduleProblem(s: WeeklySchedule): string {
  const on = DAY_KEYS.filter((d) => s[d].on);
  if (!on.length) return "Tick at least one day.";
  const missing = on.filter((d) => !s[d].start || !s[d].end);
  return missing.length ? `Set a start and end time for ${missing.map((d) => DAY_SHORT[d]).join(", ")}.` : "";
}

function ScheduleEditor({ value, onChange }: { value: WeeklySchedule; onChange: (s: WeeklySchedule) => void }) {
  const setDay = (d: DayKey, patch: Partial<WeeklySchedule[DayKey]>) => onChange({ ...value, [d]: { ...value[d], ...patch } });
  return (
    <div>
      <table className="text-sm">
        <tbody>
          {DAY_KEYS.map((d) => (
            <tr key={d}>
              <td className="py-1 pr-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={value[d].on} onChange={(e) => setDay(d, { on: e.target.checked })} className="rounded w-4 h-4" />
                  <span className={`w-10 ${value[d].on ? "text-gray-900 font-medium" : "text-gray-400"}`}>{DAY_SHORT[d]}</span>
                </label>
              </td>
              <td className="py-1">
                {value[d].on ? (
                  <div className="flex items-center gap-2">
                    <input type="time" value={value[d].start} aria-label={`${DAY_SHORT[d]} from`} onChange={(e) => setDay(d, { start: e.target.value })}
                      className="px-2 py-1 border border-gray-200 rounded-md" />
                    <span className="text-gray-400">to</span>
                    <input type="time" value={value[d].end} aria-label={`${DAY_SHORT[d]} to`} onChange={(e) => setDay(d, { end: e.target.value })}
                      className="px-2 py-1 border border-gray-200 rounded-md" />
                  </div>
                ) : <span className="text-gray-400">No texts</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-gray-400 mt-2">Melbourne time. An end earlier than the start runs overnight (e.g. 5:00 pm to 9:00 am); the same start and end means all day.</p>
    </div>
  );
}

// "Any time" or "Only on these days and times" + the editor.
function WhenToText({ scheduled, schedule, onChange, name }: {
  scheduled: boolean; schedule: WeeklySchedule; name: string;
  onChange: (v: { scheduled: boolean; schedule: WeeklySchedule }) => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap gap-5">
        <label className="flex items-center gap-2 text-base text-gray-600">
          <input type="radio" name={name} checked={!scheduled} onChange={() => onChange({ scheduled: false, schedule })} className="w-4 h-4" />
          Any time
        </label>
        <label className="flex items-center gap-2 text-base text-gray-600">
          <input type="radio" name={name} checked={scheduled} onChange={() => onChange({ scheduled: true, schedule })} className="w-4 h-4" />
          Only on these days and times
        </label>
      </div>
      {scheduled && (
        <div className="mt-3">
          <ScheduleEditor value={schedule} onChange={(s) => onChange({ scheduled: true, schedule: s })} />
        </div>
      )}
    </div>
  );
}

export default function SmsRecipients() {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<{ id: string; name: string; phone: string } | null>(null);
  const [hours, setHours] = useState<{ id: string; scheduled: boolean; schedule: WeeklySchedule } | null>(null);
  const [hoursError, setHoursError] = useState("");
  const now = new Date();

  const normalizePhone = (raw: string) => raw.replace(/[\s\-().+]/g, "");
  const hasLeadingZeroAfterCC = (digits: string) => {
    if (/^[17]/.test(digits) && digits[1] === "0") return true;
    if (/^[2-689]/.test(digits) && digits[2] === "0") return true;
    return false;
  };
  const isPhoneValid = (raw: string) => {
    const digits = normalizePhone(raw);
    return /^\d{10,15}$/.test(digits) && !hasLeadingZeroAfterCC(digits);
  };
  const phoneDigits = normalizePhone(form.phone);
  const phoneValid = form.phone === "" || isPhoneValid(form.phone);
  const phoneLooksLikeLeadingZero = form.phone !== "" && /^\d{10,15}$/.test(phoneDigits) && hasLeadingZeroAfterCC(phoneDigits);
  const formScheduleProblem = form.scheduled ? scheduleProblem(form.schedule) : "";
  const canSave = form.name.trim() !== "" && isPhoneValid(form.phone) && !formScheduleProblem;

  const editPhoneDigits = editing ? normalizePhone(editing.phone) : "";
  const editPhoneValid = editing ? (editing.phone === "" || isPhoneValid(editing.phone)) : true;
  const editPhoneLooksLikeLeadingZero = editing ? (editing.phone !== "" && /^\d{10,15}$/.test(editPhoneDigits) && hasLeadingZeroAfterCC(editPhoneDigits)) : false;
  const canSaveEdit = editing ? (editing.name.trim() !== "" && isPhoneValid(editing.phone)) : false;

  const load = () => { supabase.from("sms_recipients").select("*").order("name").then(({ data }) => setRecipients(data ?? [])); };
  useEffect(load, []);

  const add = async () => {
    if (!canSave) return;
    const { scheduled, schedule, ...ticks } = form;
    await supabase.from("sms_recipients").insert({
      ...ticks, phone: phoneDigits, is_active: true,
      schedule: scheduled ? schedule : null,
    });
    setForm(emptyForm);
    setAdding(false);
    load();
  };

  const toggle = async (id: string, field: string, current: boolean) => {
    await supabase.from("sms_recipients").update({ [field]: !current }).eq("id", id);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this recipient?")) return;
    await supabase.from("sms_recipients").delete().eq("id", id);
    load();
  };

  const saveEdit = async () => {
    if (!editing || !canSaveEdit) return;
    await supabase.from("sms_recipients").update({ name: editing.name, phone: normalizePhone(editing.phone) }).eq("id", editing.id);
    setEditing(null);
    load();
  };

  const openHours = (r: Recipient) => {
    setHoursError("");
    setHours({ id: r.id, scheduled: !!r.schedule, schedule: withDefaults(r.schedule) });
  };

  const saveHours = async () => {
    if (!hours) return;
    const problem = hours.scheduled ? scheduleProblem(hours.schedule) : "";
    if (problem) { setHoursError(problem); return; }
    const { error } = await supabase.from("sms_recipients")
      .update({ schedule: hours.scheduled ? hours.schedule : null })
      .eq("id", hours.id);
    if (error) { setHoursError("Couldn't save the days and times."); return; }
    setHours(null);
    load();
  };

  return (
    <div className="w-full px-4 sm:px-6 py-6 lg:py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">SMS Recipients</h1>
        <button onClick={() => setAdding(!adding)} className="flex items-center gap-2 px-5 py-2 text-base font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
          <Plus size={20} /> Add Recipient
        </button>
      </div>

      {adding && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6">
          <div className="grid grid-cols-2 gap-5 mb-5">
            <label className="block">
              <span className="text-sm text-gray-400 font-medium uppercase">Name</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="mt-1.5 w-full px-4 py-2 text-base border border-gray-200 rounded-lg" placeholder="Tyler" />
            </label>
            <label className="block">
              <span className="text-sm text-gray-400 font-medium uppercase">Phone (with country code)</span>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className={`mt-1.5 w-full px-4 py-2 text-base border rounded-lg ${!phoneValid ? "border-red-400 bg-red-50" : "border-gray-200"}`} placeholder="+49 157 55577318" />
              {!phoneValid && !phoneLooksLikeLeadingZero && <p className="text-red-500 text-sm mt-1">Enter 10-15 digits: country code + number, no spaces or symbols</p>}
              {phoneLooksLikeLeadingZero && <p className="text-red-500 text-sm mt-1">Remove the leading 0 after the country code (e.g. +49 0157… → +49 157…)</p>}
              {form.phone && phoneValid && <p className="text-green-600 text-sm mt-1">Will be saved as: {phoneDigits}</p>}
            </label>
          </div>
          <div className="mb-4">
            <span className="text-sm text-gray-400 font-medium uppercase">Maintenance urgency</span>
            <div className="flex gap-5 mt-2">
              {maintenanceFields.map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-base text-gray-600">
                  <input type="checkbox" checked={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.checked })} className="rounded w-5 h-5" />
                  {f.label}
                </label>
              ))}
            </div>
          </div>
          <div className="mb-4">
            <span className="text-sm text-gray-400 font-medium uppercase">Questions the AI couldn't answer</span>
            <div className="flex flex-wrap gap-5 mt-2">
              {kbFields.map((f) => (
                <label key={f.key} className="flex items-center gap-2 text-base text-gray-600">
                  <input type="checkbox" checked={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.checked })} className="rounded w-5 h-5" />
                  {f.label}
                </label>
              ))}
            </div>
            <p className="text-sm text-gray-400 mt-1">If nobody is ticked for Cleaning or Maintenance, those questions go to General.</p>
          </div>
          <div className="grid grid-cols-2 gap-4 mb-5">
            <label className="flex items-center gap-2 text-base text-gray-600">
              <input type="checkbox" checked={form.receives_checkin_checkout} onChange={(e) => setForm({ ...form, receives_checkin_checkout: e.target.checked })} className="rounded w-5 h-5" />
              Check-in / checkout requests
            </label>
            <label className="flex items-center gap-2 text-base text-gray-600">
              <input type="checkbox" checked={form.receives_extras} onChange={(e) => setForm({ ...form, receives_extras: e.target.checked })} className="rounded w-5 h-5" />
              Extras approval requests
            </label>
          </div>
          <div className="mb-5">
            <span className="text-sm text-gray-400 font-medium uppercase">When to text</span>
            <div className="mt-2">
              <WhenToText name="add-when" scheduled={form.scheduled} schedule={form.schedule}
                onChange={(v) => setForm({ ...form, ...v })} />
              {formScheduleProblem && <p className="text-red-500 text-sm mt-1">{formScheduleProblem}</p>}
            </div>
          </div>
          <button onClick={add} disabled={!canSave} className={`px-5 py-2 text-base font-medium rounded-lg ${canSave ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-gray-200 text-gray-400 cursor-not-allowed"}`}>Save</button>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-base">
          <thead>
            <tr className="border-b border-gray-100 text-sm text-gray-400 uppercase tracking-wider">
              <th className="text-left px-5 py-4 font-medium">Name</th>
              <th className="text-left px-5 py-4 font-medium">Phone</th>
              <th className="text-center px-3 py-4 font-medium" colSpan={3}>
                <span>Maintenance</span>
              </th>
              <th className="text-center px-3 py-4 font-medium" colSpan={4}>KB Gaps</th>
              <th className="text-center px-5 py-4 font-medium">Check-in/out</th>
              <th className="text-center px-5 py-4 font-medium">Extras</th>
              <th className="px-5 py-4 font-medium" />
            </tr>
            <tr className="border-b border-gray-100 text-xs text-gray-400 uppercase tracking-wider">
              <th colSpan={2} />
              {maintenanceFields.map((f) => (
                <th key={f.key} className="px-3 py-2 font-medium text-center">{f.label}</th>
              ))}
              {kbFields.map((f) => (
                <th key={f.key} className="px-2 py-2 font-medium text-center">{f.label}</th>
              ))}
              <th />
              <th />
              <th />
            </tr>
          </thead>
          <tbody>
            {recipients.map((r) => (
              <Fragment key={r.id}>
              <tr className="border-b border-gray-50">
                {editing?.id === r.id ? (
                  <>
                    <td className="px-5 py-4">
                      <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                        className="w-full px-3 py-1.5 text-base border border-gray-200 rounded-lg" />
                    </td>
                    <td className="px-5 py-4">
                      <input value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })}
                        className={`w-full px-3 py-1.5 text-base font-mono border rounded-lg ${!editPhoneValid ? "border-red-400 bg-red-50" : "border-gray-200"}`}
                        placeholder="+49 157 55577318" />
                      {!editPhoneValid && !editPhoneLooksLikeLeadingZero && <p className="text-red-500 text-xs mt-1">10-15 digits: country code + number</p>}
                      {editPhoneLooksLikeLeadingZero && <p className="text-red-500 text-xs mt-1">Remove leading 0 after country code</p>}
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-5 py-4 text-gray-900">
                      {r.name}
                      {r.schedule && (
                        <div className="mt-1 text-xs">
                          <span className={isWithinSchedule(withDefaults(r.schedule), now) ? "text-emerald-600" : "text-gray-400"}>
                            {isWithinSchedule(withDefaults(r.schedule), now) ? "Getting texts now" : "Not getting texts now"}
                          </span>
                          <div className="text-gray-400 mt-0.5">{scheduleSummary(withDefaults(r.schedule))}</div>
                        </div>
                      )}
                    </td>
                    <td className="px-5 py-4 text-gray-500 font-mono text-sm">{r.phone}</td>
                  </>
                )}
                {maintenanceFields.map((f) => (
                  <td key={f.key} className="px-3 py-4 text-center">
                    <button onClick={() => toggle(r.id, f.key, r[f.key])}
                      className={`w-6 h-6 rounded ${r[f.key] ? f.color : "bg-gray-200"}`} />
                  </td>
                ))}
                {kbFields.map((f) => (
                  <td key={f.key} className="px-2 py-4 text-center">
                    <button onClick={() => toggle(r.id, f.key, r[f.key])} title={`KB gaps: ${f.label}`}
                      className={`w-6 h-6 rounded ${r[f.key] ? f.color : "bg-gray-200"}`} />
                  </td>
                ))}
                <td className="px-5 py-4 text-center">
                  <button onClick={() => toggle(r.id, "receives_checkin_checkout", r.receives_checkin_checkout)}
                    className={`w-6 h-6 rounded ${r.receives_checkin_checkout ? "bg-purple-500" : "bg-gray-200"}`} />
                </td>
                <td className="px-5 py-4 text-center">
                  <button onClick={() => toggle(r.id, "receives_extras", r.receives_extras)}
                    className={`w-6 h-6 rounded ${r.receives_extras ? "bg-orange-500" : "bg-gray-200"}`} />
                </td>
                <td className="px-5 py-4 text-right">
                  <div className="flex gap-1 justify-end">
                    {editing?.id === r.id ? (
                      <>
                        <button onClick={saveEdit} disabled={!canSaveEdit} className={`p-2 ${canSaveEdit ? "text-green-500 hover:text-green-700" : "text-gray-300 cursor-not-allowed"}`}><Check size={20} /></button>
                        <button onClick={() => setEditing(null)} className="p-2 text-gray-400 hover:text-gray-600"><X size={20} /></button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => (hours?.id === r.id ? setHours(null) : openHours(r))} title="Days and times"
                          className={`p-2 ${r.schedule ? "text-sky-600 hover:text-sky-800" : "text-gray-300 hover:text-gray-500"}`}><Clock size={20} /></button>
                        <button onClick={() => setEditing({ id: r.id, name: r.name, phone: r.phone })} className="p-2 text-gray-300 hover:text-gray-500"><Pencil size={20} /></button>
                        <button onClick={() => remove(r.id)} className="p-2 text-gray-300 hover:text-red-500"><Trash2 size={20} /></button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
              {hours?.id === r.id && (
                <tr className="border-b border-gray-100 bg-gray-50">
                  <td colSpan={12} className="px-5 py-4">
                    <span className="text-sm text-gray-400 font-medium uppercase">When to text {r.name}</span>
                    <div className="mt-2">
                      <WhenToText name={`when-${r.id}`} scheduled={hours.scheduled} schedule={hours.schedule}
                        onChange={(v) => setHours({ ...hours, ...v })} />
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button onClick={saveHours} className="px-4 py-1.5 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">Save</button>
                      <button onClick={() => setHours(null)} className="px-4 py-1.5 text-sm text-gray-600 border border-gray-200 rounded-lg">Cancel</button>
                    </div>
                    {hoursError && <p className="text-red-500 text-sm mt-2">{hoursError}</p>}
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
