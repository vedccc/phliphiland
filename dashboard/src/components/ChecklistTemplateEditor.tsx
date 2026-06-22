import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { Plus, Trash2, GripVertical } from "lucide-react";

interface Item {
  id: string;
  body: string;
  sort_order: number;
}

export default function ChecklistTemplateEditor({ propertyId }: { propertyId: string }) {
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [newBody, setNewBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  // Inline edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");

  // Drag-and-drop (native HTML5). dragIndex tracks the row being dragged;
  // we reorder local state live as it moves over others, then persist on drop.
  const dragIndex = useRef<number | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const ensureTemplate = async () => {
    const { data: existing } = await supabase
      .from("checklist_templates")
      .select("id")
      .eq("property_id", propertyId)
      .maybeSingle();
    if (existing) return existing.id;
    const { data: created } = await supabase
      .from("checklist_templates")
      .insert({ property_id: propertyId, name: "Cleaning Checklist" })
      .select("id")
      .single();
    return created?.id ?? null;
  };

  const load = async () => {
    setLoading(true);
    const tid = await ensureTemplate();
    setTemplateId(tid);
    if (tid) {
      const { data } = await supabase
        .from("checklist_template_items")
        .select("id, body, sort_order")
        .eq("template_id", tid)
        .order("sort_order");
      setItems(data ?? []);
    }
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, [propertyId]);

  // ─── Add (optimistic: persist, then append the real row — no full reload) ───
  const addItem = async () => {
    const body = newBody.trim();
    if (!templateId || !body || adding) return;
    setAdding(true);
    const { data, error } = await supabase
      .from("checklist_template_items")
      .insert({ template_id: templateId, body, sort_order: items.length })
      .select("id, body, sort_order")
      .single();
    setAdding(false);
    if (error || !data) return;
    setItems((prev) => [...prev, data]);
    setNewBody("");
  };

  const removeItem = async (id: string) => {
    if (!confirm("Remove this item?")) return;
    setItems((prev) => prev.filter((it) => it.id !== id)); // optimistic
    await supabase.from("checklist_template_items").delete().eq("id", id);
  };

  // ─── Inline edit ───
  const startEdit = (it: Item) => {
    setEditingId(it.id);
    setEditingBody(it.body);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditingBody("");
  };
  const saveEdit = async () => {
    if (!editingId) return;
    const body = editingBody.trim();
    const current = items.find((it) => it.id === editingId);
    if (!body || !current || body === current.body) return cancelEdit();
    setItems((prev) => prev.map((it) => (it.id === editingId ? { ...it, body } : it)));
    const id = editingId;
    cancelEdit();
    await supabase.from("checklist_template_items").update({ body }).eq("id", id);
  };

  // ─── Drag reorder ───
  const handleDragStart = (index: number, id: string) => {
    dragIndex.current = index;
    setDraggingId(id);
  };
  const handleDragEnter = (index: number) => {
    const from = dragIndex.current;
    if (from === null || from === index) return;
    setItems((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(index, 0, moved);
      return next;
    });
    dragIndex.current = index;
  };
  const handleDragEnd = async () => {
    dragIndex.current = null;
    setDraggingId(null);
    // Persist any rows whose position changed.
    const updates = items
      .map((it, i) => ({ it, i }))
      .filter(({ it, i }) => it.sort_order !== i);
    if (updates.length === 0) return;
    setItems((prev) => prev.map((it, i) => ({ ...it, sort_order: i })));
    await Promise.all(
      updates.map(({ it, i }) =>
        supabase.from("checklist_template_items").update({ sort_order: i }).eq("id", it.id)
      )
    );
  };

  if (loading) return <div className="text-gray-400 py-6">Loading template...</div>;

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">
        Items here are copied into a fresh checklist when a new reservation is created.
        Drag to reorder, click an item to edit.
      </p>

      <div className="space-y-2">
        {items.map((it, index) => {
          const isEditing = editingId === it.id;
          const isDragging = draggingId === it.id;
          return (
            <div
              key={it.id}
              draggable={!isEditing}
              onDragStart={() => handleDragStart(index, it.id)}
              onDragEnter={() => handleDragEnter(index)}
              onDragOver={(e) => e.preventDefault()}
              onDragEnd={handleDragEnd}
              className={`flex items-center gap-3 bg-white border rounded-lg px-3 py-2.5 transition-shadow ${
                isDragging ? "border-gray-400 shadow-md opacity-60" : "border-gray-200"
              }`}
            >
              <GripVertical
                size={18}
                className={`shrink-0 text-gray-300 ${isEditing ? "" : "cursor-grab active:cursor-grabbing"}`}
              />
              {isEditing ? (
                <input
                  autoFocus
                  value={editingBody}
                  onChange={(e) => setEditingBody(e.target.value)}
                  onBlur={saveEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEdit();
                    if (e.key === "Escape") cancelEdit();
                  }}
                  className="flex-1 px-2 py-1 text-base border border-gray-300 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400"
                />
              ) : (
                <span
                  onClick={() => startEdit(it)}
                  className="flex-1 text-base text-gray-800 cursor-text hover:text-gray-900 rounded px-1 -mx-1 hover:bg-gray-50"
                >
                  {it.body}
                </span>
              )}
              <button
                onClick={() => removeItem(it.id)}
                className="shrink-0 p-1 text-gray-300 hover:text-red-500"
              >
                <Trash2 size={18} />
              </button>
            </div>
          );
        })}
        {items.length === 0 && <div className="text-sm text-gray-400 py-3">No items yet.</div>}
      </div>

      <div className="flex gap-2 pt-2">
        <input
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addItem()}
          placeholder="e.g. Replace towels in the master bath"
          className="flex-1 px-3 py-2 text-base border border-gray-200 rounded-lg"
        />
        <button
          onClick={addItem}
          disabled={!newBody.trim() || adding}
          className="flex items-center gap-1.5 px-4 py-2 text-base bg-gray-900 text-white rounded-lg disabled:opacity-40"
        >
          <Plus size={18} /> {adding ? "Adding…" : "Add"}
        </button>
      </div>
    </div>
  );
}
