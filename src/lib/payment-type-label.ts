export function paymentTypeLabel(paymentType: string): string {
  const t = String(paymentType || "").trim();
  if (!t) return "—";

  const key = t.toLowerCase();

  // Tipos internos de renovação / abatimento
  if (key === "capital_renewal") return "CAPITAL";
  if (key === "interest_renewal" || key === "early_payment_interest_renewal") return "JUROS";
  if (key === "capital_interest_renewal") return "CAPITAL + JUROS";

  // Formas de pagamento comuns
  const map: Record<string, string> = {
    pix: "PIX",
    boleto: "Boleto",
    dinheiro: "Dinheiro",
    cartao: "Cartão",
    cartão: "Cartão",
    transferencia: "Transferência",
    transferência: "Transferência",
    ted: "TED",
    doc: "DOC",
    cheque: "Cheque",
    outros: "Outros",
  };
  if (map[key]) return map[key];

  return t.replace(/_/g, " ").toUpperCase();
}

