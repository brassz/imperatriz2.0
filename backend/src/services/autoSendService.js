import fs from "node:fs/promises";
import path from "node:path";
import cron from "node-cron";
import { z } from "zod";
import { getEnv } from "../lib/env.js";
import { fetchLoansForFilter } from "./loanService.js";

const DaysEnum = z.enum([
  "all",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);

const FiltersEnum = z.enum(["overdue", "dueToday", "installments"]);
const CompanyEnum = z.enum(["franca", "litoral", "mogiana", "imperatriz", "all"]);
const InstanceEnum = z.enum(["omnibot2", "vinicius", "douglas"]);

export const ScheduleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  company: CompanyEnum,
  time: z.string().regex(/^\d{2}:\d{2}$/),
  days: z.array(DaysEnum).min(1),
  filters: z.array(FiltersEnum).min(1),
  delayMinutes: z.number().min(0),
  instanceId: InstanceEnum,
  active: z.boolean(),
  lastRun: z.string().datetime().optional(),
  runCount: z.number().int().nonnegative().optional(),
});

function resolveSchedulesFile() {
  const env = getEnv();
  const p = env.AUTO_SCHEDULES_FILE || "./auto-schedules.json";
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

export async function readSchedules() {
  const file = resolveSchedulesFile();
  const raw = await fs.readFile(file, "utf8").catch(() => "[]");
  const parsed = JSON.parse(raw);
  return z.array(ScheduleSchema).parse(parsed);
}

export async function writeSchedules(schedules) {
  const file = resolveSchedulesFile();
  const arr = z.array(ScheduleSchema).parse(schedules);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(arr, null, 2), "utf8");
  return arr;
}

function daysToCronPart(days) {
  const map = {
    sunday: "0",
    monday: "1",
    tuesday: "2",
    wednesday: "3",
    thursday: "4",
    friday: "5",
    saturday: "6",
  };
  if (days.includes("all")) return "*";
  const nums = days.filter((d) => d !== "all").map((d) => map[d]).filter(Boolean);
  return nums.length ? nums.join(",") : "*";
}

export class AutoSendService {
  constructor({ queueManager, emit }) {
    this.queueManager = queueManager;
    this.emit = emit;
    this.jobs = new Map(); // scheduleId -> cron task
  }

  async reload() {
    // clear to avoid duplicated cron on restarts/reloads
    for (const task of this.jobs.values()) task.stop();
    this.jobs.clear();

    const schedules = await readSchedules();
    for (const s of schedules) {
      if (!s.active) continue;
      this._createJob(s);
    }
    return schedules;
  }

  _createJob(schedule) {
    const [hh, mm] = schedule.time.split(":").map(Number);
    const dow = daysToCronPart(schedule.days);
    const expr = `${mm} ${hh} * * ${dow}`;

    const task = cron.schedule(
      expr,
      async () => {
        try {
          await this.executeSchedule(schedule.id);
        } catch (err) {
          this.emit("schedule:failed", { scheduleId: schedule.id, error: String(err?.message || err) });
        }
      },
      { scheduled: true, timezone: "America/Sao_Paulo" }
    );
    this.jobs.set(schedule.id, task);
    this.emit("schedule:loaded", { scheduleId: schedule.id, cron: expr });
  }

  async list() {
    return await readSchedules();
  }

  async upsert(schedule) {
    const schedules = await readSchedules();
    const idx = schedules.findIndex((s) => s.id === schedule.id);
    const parsed = ScheduleSchema.parse(schedule);
    const next = [...schedules];
    if (idx >= 0) next[idx] = parsed;
    else next.push(parsed);
    const saved = await writeSchedules(next);
    await this.reload();
    return saved.find((s) => s.id === parsed.id);
  }

  async remove(id) {
    const schedules = await readSchedules();
    const next = schedules.filter((s) => s.id !== id);
    await writeSchedules(next);
    await this.reload();
    return true;
  }

  async executeSchedule(id) {
    const schedules = await readSchedules();
    const schedule = schedules.find((s) => s.id === id);
    if (!schedule) throw new Error("Schedule not found");

    const companies =
      schedule.company === "all"
        ? ["franca", "litoral", "mogiana", "imperatriz"]
        : [schedule.company];

    const results = [];
    for (const companyKey of companies) {
      for (const f of schedule.filters) {
        const loans = await fetchLoansForFilter(companyKey, f);
        for (const loan of loans) {
          results.push({ loan: { ...loan, companyKey }, filter: f });
        }
      }
    }

    const filterToMessageType = (f) => (f === "dueToday" ? "lembrete" : "cobranca");
    const priority = { cobranca: 2, lembrete: 1, remarketing: 0, reminder: 1 };

    /** um envio por telefone; cobrança ganha de lembrete se o mesmo cliente cair nos dois filtros */
    const byPhone = new Map();
    for (const { loan, filter } of results) {
      const phone = String(loan.phone || "").trim();
      if (!phone) continue;
      const messageType = filterToMessageType(filter);
      const prev = byPhone.get(phone);
      if (!prev || (priority[messageType] ?? 0) > (priority[prev.messageType] ?? 0)) {
        byPhone.set(phone, { loan, messageType });
      }
    }

    const queueItems = Array.from(byPhone.values());
    const instanceId = schedule.instanceId;
    const delayMinutes = schedule.delayMinutes;
    this.queueManager.addToQueue({
      instanceId,
      delayMinutes,
      items: queueItems,
      companyKey: schedule.company,
    });

    const nowIso = new Date().toISOString();
    const updated = schedules.map((s) =>
      s.id === schedule.id
        ? {
            ...s,
            lastRun: nowIso,
            runCount: (s.runCount || 0) + 1,
          }
        : s
    );
    await writeSchedules(updated);

    this.emit("schedule:executed", {
      scheduleId: schedule.id,
      instanceId,
      added: queueItems.length,
      totalFetched: results.length,
    });

    return { fetched: results.length, added: queueItems.length };
  }
}

