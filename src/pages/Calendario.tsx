import { useMemo, useState } from "react";
import { addMonths, endOfMonth, format, startOfMonth, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createCalendarNote, deleteCalendarNote, fetchCalendarNotesInRange, type CalendarNoteRow } from "@/api/calendar-notes";

type Note = {
  id: string;
  text: string;
  createdAt: string;
};

type NotesByDay = Record<string, Note[]>;

function toDayKey(d: Date) {
  return format(d, "yyyy-MM-dd");
}

function daysGrid(month: Date) {
  const first = startOfMonth(month);
  const startDow = first.getDay(); // 0=domingo
  const start = new Date(first);
  start.setDate(first.getDate() - startDow);

  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
}

export default function Calendario() {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [open, setOpen] = useState(false);
  const [newText, setNewText] = useState("");
  const queryClient = useQueryClient();

  const monthStart = startOfMonth(month);
  const monthEnd = endOfMonth(month);
  const from = format(monthStart, "yyyy-MM-dd");
  const to = format(monthEnd, "yyyy-MM-dd");

  const { data: monthNotes = [] } = useQuery({
    queryKey: ["calendar-notes", from, to],
    queryFn: () => fetchCalendarNotesInRange(from, to),
  });

  const notesByDay: NotesByDay = useMemo(() => {
    const map: NotesByDay = {};
    for (const n of monthNotes) {
      const dayKey = String(n.day).split("T")[0];
      if (!map[dayKey]) map[dayKey] = [];
      map[dayKey].push({
        id: n.id,
        text: n.text,
        createdAt: n.created_at,
      });
    }
    return map;
  }, [monthNotes]);

  const grid = useMemo(() => daysGrid(month), [month]);
  const selectedKey = selectedDay ? toDayKey(selectedDay) : "";
  const selectedNotes = selectedKey ? (notesByDay[selectedKey] || []) : [];

  const monthLabel = useMemo(() => {
    return format(month, "MMMM 'de' yyyy", { locale: ptBR });
  }, [month]);

  const openDay = (d: Date) => {
    setSelectedDay(d);
    setNewText("");
    setOpen(true);
  };

  const addMutation = useMutation({
    mutationFn: async ({ day, text }: { day: string; text: string }) => {
      return createCalendarNote(day, text);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-notes"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => deleteCalendarNote(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-notes"] });
    },
  });

  const addNote = () => {
    if (!selectedDay) return;
    const text = newText.trim();
    if (!text) return;
    const key = toDayKey(selectedDay);
    addMutation.mutate({ day: key, text });
    setNewText("");
  };

  const removeNote = (noteId: string) => {
    deleteMutation.mutate(noteId);
  };

  const weekdays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const monthKey = toDayKey(month).slice(0, 7);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-foreground">Calendário</h1>
          <p className="text-sm text-muted-foreground">Adicione anotações por dia</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={() => setMonth(startOfMonth(new Date()))}>
            <CalendarDays className="h-4 w-4" />
            Hoje
          </Button>
          <Button variant="outline" size="icon" onClick={() => setMonth(subMonths(month, 1))} aria-label="Mês anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[180px] text-center text-sm font-semibold text-foreground capitalize">
            {monthLabel}
          </div>
          <Button variant="outline" size="icon" onClick={() => setMonth(addMonths(month, 1))} aria-label="Próximo mês">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border/30 bg-muted/20">
                {weekdays.map((w) => (
                  <th key={w} className="text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider p-3">
                    {w}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 6 }).map((_, weekIdx) => (
                <tr key={`${monthKey}-w${weekIdx}`} className="border-b border-border/20 last:border-0">
                  {grid.slice(weekIdx * 7, weekIdx * 7 + 7).map((d) => {
                    const inMonth = d.getMonth() === month.getMonth();
                    const key = toDayKey(d);
                    const count = notesByDay[key]?.length || 0;
                    const isToday = toDayKey(d) === toDayKey(new Date());
                    return (
                      <td key={key} className="p-2 align-top">
                        <button
                          type="button"
                          onClick={() => openDay(d)}
                          className={`w-full min-h-[78px] rounded-lg border border-border/40 p-2 text-left transition-colors hover:bg-surface-hover ${
                            inMonth ? "bg-card/30" : "bg-muted/10 opacity-70"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className={`text-sm font-semibold ${inMonth ? "text-foreground" : "text-muted-foreground"}`}>
                                {d.getDate()}
                              </span>
                              {isToday && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                                  hoje
                                </span>
                              )}
                            </div>
                            {count > 0 && (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-border/40">
                                {count}
                              </span>
                            )}
                          </div>
                          {count > 0 && (
                            <p className="mt-2 text-[11px] text-muted-foreground line-clamp-2">
                              {notesByDay[key]?.[0]?.text || ""}
                            </p>
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selectedDay ? format(selectedDay, "dd 'de' MMMM 'de' yyyy", { locale: ptBR }) : "Dia"}
            </DialogTitle>
            <DialogDescription>Adicione e gerencie anotações deste dia</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-2">
              <Label>Nova anotação</Label>
              <Textarea
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                placeholder="Escreva uma anotação..."
                rows={3}
              />
              <div className="flex justify-end">
                <Button type="button" className="gap-2" onClick={addNote} disabled={!newText.trim()}>
                  <Plus className="h-4 w-4" />
                  Adicionar
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">Anotações ({selectedNotes.length})</p>
              </div>

              {selectedNotes.length === 0 ? (
                <div className="rounded-lg border border-border/40 bg-muted/10 p-4">
                  <p className="text-sm text-muted-foreground">Nenhuma anotação para este dia.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {selectedNotes.map((n) => (
                    <div key={n.id} className="rounded-lg border border-border/40 bg-card/30 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-foreground whitespace-pre-wrap">{n.text}</p>
                          <p className="text-[10px] text-muted-foreground mt-2">
                            {format(new Date(n.createdAt), "dd/MM/yyyy HH:mm")}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shrink-0 text-destructive hover:text-destructive"
                          onClick={() => removeNote(n.id)}
                          aria-label="Excluir anotação"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="hidden">
        <Input value={monthLabel} readOnly />
      </div>
    </div>
  );
}

