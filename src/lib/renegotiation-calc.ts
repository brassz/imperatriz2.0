export type RenegotiationMode =
  | "avista"
  | "avista_desconto"
  | "parcelado_entrada"
  | "parcelado_total";

export type RenegotiationCalcInput = {
  mode: RenegotiationMode;
  baseCapital: number;
  discountPercent?: number;
  downPayment?: number;
  installmentCount?: number;
};

export type RenegotiationCalcResult = {
  baseCapital: number;
  discountPercent: number;
  totalAmount: number;
  downPayment: number;
  installmentCount: number;
  installmentAmount: number;
};

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Total do acordo em modalidades parceladas: entrada + (parcela × quantidade). */
export function renegotiationAgreementTotal(params: {
  downPayment: number;
  installmentAmount: number;
  installmentCount: number;
}): number {
  return roundMoney(
    params.downPayment + params.installmentAmount * params.installmentCount,
  );
}

export function calcRenegotiationProposal(input: RenegotiationCalcInput): RenegotiationCalcResult {
  const baseCapital = Math.max(0, input.baseCapital);
  const mode = input.mode;

  if (mode === "avista") {
    return {
      baseCapital,
      discountPercent: 0,
      totalAmount: roundMoney(baseCapital),
      downPayment: 0,
      installmentCount: 0,
      installmentAmount: 0,
    };
  }

  if (mode === "avista_desconto") {
    const discountPercent = Math.max(0, Math.min(100, input.discountPercent ?? 20));
    const totalAmount = roundMoney(baseCapital * (1 - discountPercent / 100));
    return {
      baseCapital,
      discountPercent,
      totalAmount,
      downPayment: 0,
      installmentCount: 0,
      installmentAmount: 0,
    };
  }

  if (mode === "parcelado_entrada") {
    const downPayment = Math.max(0, input.downPayment ?? 0);
    const installmentCount = Math.max(1, Math.floor(input.installmentCount ?? 1));
    const remainder = Math.max(0, baseCapital - downPayment);
    const installmentAmount = roundMoney(remainder / installmentCount);
    return {
      baseCapital,
      discountPercent: 0,
      totalAmount: renegotiationAgreementTotal({ downPayment, installmentAmount, installmentCount }),
      downPayment: roundMoney(downPayment),
      installmentCount,
      installmentAmount,
    };
  }

  const installmentCount = Math.max(1, Math.floor(input.installmentCount ?? 1));
  const installmentAmount = roundMoney(baseCapital / installmentCount);
  return {
    baseCapital,
    discountPercent: 0,
    totalAmount: renegotiationAgreementTotal({ downPayment: 0, installmentAmount, installmentCount }),
    downPayment: 0,
    installmentCount,
    installmentAmount,
  };
}

export function renegotiationModeLabel(mode: RenegotiationMode): string {
  switch (mode) {
    case "avista":
      return "À vista (somente capital)";
    case "avista_desconto":
      return "À vista com desconto";
    case "parcelado_entrada":
      return "Parcelado com entrada";
    case "parcelado_total":
      return "Parcelado (sem entrada)";
    default:
      return mode;
  }
}
