import express from "express";
import { z } from "zod";

export function createQueueRoutes({ queueManager }) {
  const router = express.Router();

  router.post("/add", (req, res) => {
    const Body = z.object({
      loans: z.array(z.any()).default([]),
      items: z.array(z.object({ loan: z.any(), messageType: z.string() })).optional(),
      companyKey: z.string().optional(),
      delayMinutes: z.coerce.number().min(0).default(0),
      messageType: z.enum(["cobranca", "lembrete", "remarketing", "reminder"]).default("cobranca"),
      instanceId: z.string().min(1),
    });
    const body = Body.parse(req.body || {});
    queueManager.addToQueue({
      instanceId: body.instanceId,
      loans: body.loans,
      items: body.items,
      companyKey: body.companyKey,
      delayMinutes: body.delayMinutes,
      messageType: body.messageType,
    });
    res.json({ ok: true });
  });

  router.get("/stats", (req, res) => {
    const instanceId = String(req.query.instanceId || "");
    if (!instanceId) return res.status(400).json({ error: "instanceId is required" });
    res.json(queueManager.stats(instanceId));
  });

  router.post("/stop", (req, res) => {
    const instanceId = String(req.body?.instanceId || "");
    if (!instanceId) return res.status(400).json({ error: "instanceId is required" });
    queueManager.stop(instanceId);
    res.json({ ok: true });
  });

  router.post("/clear", (req, res) => {
    const instanceId = String(req.body?.instanceId || "");
    if (!instanceId) return res.status(400).json({ error: "instanceId is required" });
    queueManager.clear(instanceId);
    res.json({ ok: true });
  });

  return router;
}

