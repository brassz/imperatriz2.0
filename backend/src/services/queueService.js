import { buildMessage } from "./messageService.js";
import { sendMessage } from "./whatsappService.js";

function sleep(ms, signal) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => resolve(), ms);
    if (signal) {
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          reject(new Error("sleep aborted"));
        },
        { once: true }
      );
    }
  });
}

export class MessageQueue {
  constructor({ instanceId, emit }) {
    this.instanceId = instanceId;
    this.emit = emit;
    this.queue = [];
    this.processing = false;
    this.stopRequested = false;
    this.abortController = null;
    this.stats = {
      total: 0,
      sent: 0,
      failed: 0,
      pending: 0,
      queueLength: 0,
      processing: false,
      currentProcessing: null,
    };
  }

  snapshot() {
    return {
      instanceId: this.instanceId,
      ...this.stats,
      queueLength: this.queue.length,
      pending: this.queue.length,
      processing: this.processing,
    };
  }

  addMany(items) {
    for (const item of items) this.queue.push(item);
    this.stats.total += items.length;
    this.emit("queue:added", { instanceId: this.instanceId, added: items.length, stats: this.snapshot() });
    this.process().catch((err) => {
      this.emit("queue:error", { instanceId: this.instanceId, error: String(err?.message || err) });
    });
  }

  async process() {
    if (this.processing) return;
    this.processing = true;
    this.stopRequested = false;
    this.abortController = new AbortController();
    this.emit("queue:processing", { instanceId: this.instanceId, stats: this.snapshot() });

    try {
      let first = true;
      while (this.queue.length > 0) {
        if (this.stopRequested) break;
        const item = this.queue.shift();
        if (!item) break;

        this.stats.currentProcessing = {
          loanId: item.loan?.id,
          companyKey: item.companyKey,
          messageType: item.messageType,
        };
        this.emit("queue:item:processing", { instanceId: this.instanceId, item: this.stats.currentProcessing, stats: this.snapshot() });

        try {
          if (!first) {
            const ms = Math.max(0, Number(item.delayMinutes || 0)) * 60_000;
            await sleep(ms, this.abortController.signal);
          }
          first = false;

          const phone = item.loan?.phone || item.loan?.client?.phone;
          const text = buildMessage({ messageType: item.messageType, loan: item.loan });
          await sendMessage(phone, text, { instanceId: this.instanceId });
          this.stats.sent += 1;
          this.emit("queue:sent", { instanceId: this.instanceId, loanId: item.loan?.id, stats: this.snapshot() });
        } catch (err) {
          this.stats.failed += 1;
          this.emit("queue:failed", {
            instanceId: this.instanceId,
            loanId: item.loan?.id,
            error: String(err?.message || err),
            stats: this.snapshot(),
          });
        } finally {
          this.stats.currentProcessing = null;
        }
      }

      if (this.stopRequested) {
        this.emit("queue:stopped", { instanceId: this.instanceId, stats: this.snapshot() });
      }
    } finally {
      this.processing = false;
      this.abortController = null;
      this.emit("queue:idle", { instanceId: this.instanceId, stats: this.snapshot() });
    }
  }

  stop() {
    this.stopRequested = true;
    if (this.abortController) this.abortController.abort();
  }

  clear() {
    this.queue = [];
    this.emit("queue:cleared", { instanceId: this.instanceId, stats: this.snapshot() });
  }
}

export class QueueManager {
  constructor({ emit }) {
    this.emit = emit;
    this.queues = new Map();
  }

  getQueue(instanceId) {
    if (!this.queues.has(instanceId)) {
      this.queues.set(instanceId, new MessageQueue({ instanceId, emit: this.emit }));
    }
    return this.queues.get(instanceId);
  }

  /**
   * @param {object} opts
   * @param {string} opts.instanceId
   * @param {number} opts.delayMinutes
   * @param {Array<{ loan: any, messageType: string }>=} opts.items  preferido (um tipo por item)
   * @param {any[]=} opts.loans legado + messageType único
   */
  addToQueue(opts) {
    const { instanceId, delayMinutes } = opts;
    const q = this.getQueue(instanceId);
    let items;
    if (Array.isArray(opts.items) && opts.items.length) {
      items = opts.items.map(({ loan, messageType }) => ({
        instanceId,
        loan,
        companyKey: loan?.companyKey ?? opts.companyKey,
        delayMinutes,
        messageType: messageType || "cobranca",
      }));
    } else {
      const mt = opts.messageType || "cobranca";
      items = (opts.loans || []).map((loan) => ({
        instanceId,
        loan,
        companyKey: opts.companyKey,
        delayMinutes,
        messageType: mt,
      }));
    }
    q.addMany(items);
  }

  stats(instanceId) {
    const q = this.getQueue(instanceId);
    return q.snapshot();
  }

  stop(instanceId) {
    this.getQueue(instanceId).stop();
  }

  clear(instanceId) {
    this.getQueue(instanceId).clear();
  }
}

