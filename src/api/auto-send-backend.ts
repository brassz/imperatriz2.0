const BASE_URL =
  (import.meta as any).env?.VITE_AUTO_SEND_BACKEND_URL?.toString?.() ||
  "http://localhost:4010";

export type AutoSchedule = {
  id: string;
  name: string;
  company: "franca" | "litoral" | "mogiana" | "imperatriz" | "all";
  time: string; // HH:MM
  days: ("all" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday")[];
  filters: ("overdue" | "dueToday" | "installments")[];
  delayMinutes: number;
  instanceId: "omnibot2" | "vinicius" | "douglas";
  active: boolean;
  lastRun?: string;
  runCount?: number;
};

export async function listAutoSchedules(): Promise<AutoSchedule[]> {
  const res = await fetch(`${BASE_URL}/api/auto-send/schedules`);
  if (!res.ok) throw new Error("Falha ao listar agendamentos");
  return await res.json();
}

export async function saveAutoSchedule(s: AutoSchedule): Promise<AutoSchedule> {
  const res = await fetch(`${BASE_URL}/api/auto-send/schedules`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(s),
  });
  if (!res.ok) throw new Error("Falha ao salvar agendamento");
  return await res.json();
}

export async function deleteAutoSchedule(id: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/auto-send/schedules/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Falha ao remover agendamento");
}

export async function executeAutoSchedule(id: string): Promise<{ fetched: number; added: number }> {
  const res = await fetch(
    `${BASE_URL}/api/auto-send/schedules/${encodeURIComponent(id)}/execute`,
    { method: "POST" }
  );
  if (!res.ok) throw new Error("Falha ao executar agendamento");
  const json = await res.json();
  return { fetched: json.fetched, added: json.added };
}

export async function getQueueStats(instanceId: string) {
  const res = await fetch(
    `${BASE_URL}/api/queue/stats?instanceId=${encodeURIComponent(instanceId)}`
  );
  if (!res.ok) throw new Error("Falha ao buscar stats da fila");
  return await res.json();
}

export async function stopQueue(instanceId: string) {
  const res = await fetch(`${BASE_URL}/api/queue/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instanceId }),
  });
  if (!res.ok) throw new Error("Falha ao parar fila");
}

export async function clearQueue(instanceId: string) {
  const res = await fetch(`${BASE_URL}/api/queue/clear`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instanceId }),
  });
  if (!res.ok) throw new Error("Falha ao limpar fila");
}

export function getAutoSendBaseUrl() {
  return BASE_URL;
}

