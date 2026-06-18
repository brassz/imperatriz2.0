import type { AdvocaciaOverdueLoan } from "@/api/advocacia";
import { sendWhatsAppDocumentWithInstance, sendWhatsAppTextWithInstance } from "@/api/evolution";
import { buildAdvocaciaWhatsAppMessage, getCreditorCompanyName } from "@/lib/advocacia-messages";
import {
  generateNotificacaoExtrajudicialPdf,
  notificacaoPdfToBase64,
  type NotificacaoExtrajudicialParams,
} from "@/lib/notificacao-extrajudicial-pdf";

export type ExtrajudicialPixInfo = {
  bank: string;
  holder: string;
  key: string;
};

export function buildExtrajudicialPackage(
  item: AdvocaciaOverdueLoan,
  contactPhone: string,
  pix: ExtrajudicialPixInfo,
) {
  const creditorName = getCreditorCompanyName();
  const debtDescription =
    item.source === "installment" ? "parcelamento de dívida" : "contrato de empréstimo pessoal";

  const pdfParams: NotificacaoExtrajudicialParams = {
    clientName: item.loan.client_name,
    creditorName,
    debtDescription,
    amount: item.loan.amount,
    dueDate: item.loan.due_date,
    pix,
    contactPhone: contactPhone.trim(),
  };

  const text = buildAdvocaciaWhatsAppMessage({
    clientName: item.loan.client_name,
    amount: item.loan.amount,
    dueDate: item.loan.due_date,
    creditorName,
    contactWhatsApp: contactPhone.trim(),
  });

  const pdf = generateNotificacaoExtrajudicialPdf(pdfParams);
  const slug = item.loan.client_name.replace(/\s+/g, "-").slice(0, 40);

  return {
    text,
    pdf,
    b64: notificacaoPdfToBase64(pdf),
    fileName: `notificacao-extrajudicial-${slug}.pdf`,
  };
}

export async function sendExtrajudicialNotification(opts: {
  item: AdvocaciaOverdueLoan;
  contactPhone: string;
  pix: ExtrajudicialPixInfo;
  instance: string;
  apiKey: string;
  baseUrl: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const phone = opts.item.loan.client_phone?.trim();
  if (!phone) return { ok: false, error: "Cliente sem telefone cadastrado" };
  if (!opts.pix.key) return { ok: false, error: "Selecione uma chave PIX" };
  if (!opts.contactPhone.trim()) return { ok: false, error: "Informe o WhatsApp da Capital Advocacia" };
  if (!opts.apiKey) return { ok: false, error: "API key da instância não configurada" };

  const pkg = buildExtrajudicialPackage(opts.item, opts.contactPhone, opts.pix);

  const textRes = await sendWhatsAppTextWithInstance(phone, pkg.text, {
    instance: opts.instance,
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
  });
  if (!textRes.ok) return { ok: false, error: textRes.error || "Falha ao enviar mensagem" };

  const docRes = await sendWhatsAppDocumentWithInstance(phone, {
    base64: pkg.b64,
    fileName: pkg.fileName,
    caption: "Notificação extrajudicial — Capital Advocacia",
    instance: opts.instance,
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl,
  });
  if (!docRes.ok) return { ok: false, error: docRes.error || "Mensagem enviada, mas falha ao enviar PDF" };

  return { ok: true };
}
