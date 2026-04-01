import express from "express";
import { z } from "zod";
import { ScheduleSchema } from "../services/autoSendService.js";

export function createSchedulesRoutes({ autoSendService }) {
  const router = express.Router();

  router.get("/", async (_req, res) => {
    const schedules = await autoSendService.list();
    res.json(schedules);
  });

  router.post("/", async (req, res) => {
    const schedule = ScheduleSchema.parse(req.body || {});
    const saved = await autoSendService.upsert(schedule);
    res.json(saved);
  });

  router.delete("/:id", async (req, res) => {
    await autoSendService.remove(req.params.id);
    res.json({ ok: true });
  });

  router.post("/:id/execute", async (req, res) => {
    const Params = z.object({ id: z.string().min(1) });
    const { id } = Params.parse(req.params);
    const out = await autoSendService.executeSchedule(id);
    res.json({ ok: true, ...out });
  });

  router.post("/reload", async (_req, res) => {
    const schedules = await autoSendService.reload();
    res.json({ ok: true, schedules });
  });

  return router;
}

