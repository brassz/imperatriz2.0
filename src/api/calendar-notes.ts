import { supabase } from "@/lib/supabase";

export type CalendarNoteRow = {
  id: string;
  day: string;
  text: string;
  created_at: string;
};

export async function fetchCalendarNotesInRange(from: string, to: string): Promise<CalendarNoteRow[]> {
  const { data, error } = await supabase
    .from("calendar_notes")
    .select("id, day, text, created_at")
    .gte("day", from)
    .lte("day", to)
    .order("day", { ascending: true })
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data || []) as CalendarNoteRow[];
}

export async function createCalendarNote(day: string, text: string): Promise<CalendarNoteRow> {
  const { data, error } = await supabase
    .from("calendar_notes")
    .insert([{ day, text }])
    .select("id, day, text, created_at")
    .single();

  if (error) throw error;
  return data as CalendarNoteRow;
}

export async function deleteCalendarNote(id: string): Promise<void> {
  const { error } = await supabase.from("calendar_notes").delete().eq("id", id);
  if (error) throw error;
}

