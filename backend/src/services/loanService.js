import { getEnv } from "../lib/env.js";
import {
  diffDaysLocal,
  getTodayLocal,
  getTomorrowLocal,
  getYesterdayLocal,
  toLocalDateString,
} from "../lib/time.js";
import { getSupabaseByCompany } from "./supabaseFactory.js";

function computeFine({ dueDateYmd, todayYmd, finePerDay }) {
  const daysLate = diffDaysLocal(todayYmd, dueDateYmd);
  const daysLatePositive = Math.max(0, daysLate);
  const fineAmount = daysLatePositive * finePerDay;
  return { daysLate: daysLatePositive, fine_amount: fineAmount, fine: fineAmount };
}

function normalizePhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  // keep last 11/13 digits if user includes country code
  if (digits.length > 13) return digits.slice(-13);
  return digits;
}

async function fetchClientsByIds(supabase, clientIds) {
  if (!clientIds.length) return new Map();
  const CHUNK = 200;
  const out = new Map();
  for (let i = 0; i < clientIds.length; i += CHUNK) {
    const chunk = clientIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("clients")
      .select("id,name,phone")
      .in("id", chunk);
    if (error) throw new Error(`clients fetch failed: ${error.message}`);
    for (const c of data || []) out.set(c.id, c);
  }
  return out;
}

async function fetchLoansBase(supabase, { dateFromYmd, dateToYmdExclusive }) {
  const { data, error } = await supabase
    .from("loans")
    .select(
      "id,client_id,due_date,amount,original_amount,total_amount,interest_rate,status"
    )
    .not("status", "in", '("paid","cancelled")')
    .gte("due_date", dateFromYmd)
    .lt("due_date", dateToYmdExclusive);
  if (error) throw new Error(`loans fetch failed: ${error.message}`);
  return data || [];
}

export async function fetchLoansForFilter(companyKey, filterKey) {
  const env = getEnv();
  const todayLocal = getTodayLocal();
  const tomorrowLocal = getTomorrowLocal();
  const yesterdayLocal = getYesterdayLocal();
  const finePerDay = env.FINE_PER_DAY ?? 50;

  const supabase = getSupabaseByCompany().get(companyKey);
  if (!supabase) throw new Error(`Unknown companyKey: ${companyKey}`);

  if (filterKey === "overdue") {
    // broad interval then filter in JS
    const loans = await fetchLoansBase(supabase, {
      dateFromYmd: "1900-01-01",
      dateToYmdExclusive: tomorrowLocal,
    });

    const clientIds = [...new Set(loans.map((l) => l.client_id).filter(Boolean))];
    const clientsById = await fetchClientsByIds(supabase, clientIds);

    return loans
      .filter((l) => toLocalDateString(l.due_date) < todayLocal)
      .map((l) => {
        const dueYmd = toLocalDateString(l.due_date);
        const { fine_amount, fine } = computeFine({ dueDateYmd: dueYmd, todayYmd: todayLocal, finePerDay });
        const totalAmount = Number(l.total_amount ?? l.amount ?? 0);
        const originalAmount = Number(l.original_amount ?? l.amount ?? 0);
        const client = clientsById.get(l.client_id) || null;
        return {
          ...l,
          companyKey,
          client,
          phone: normalizePhone(client?.phone),
          isInstallment: false,
          due_date_local: dueYmd,
          fine,
          fine_amount,
          totalDue: totalAmount + fine_amount,
          original_amount: originalAmount,
          total_amount: totalAmount,
        };
      });
  }

  if (filterKey === "dueToday") {
    const loans = await fetchLoansBase(supabase, {
      dateFromYmd: yesterdayLocal,
      dateToYmdExclusive: tomorrowLocal,
    });

    const clientIds = [...new Set(loans.map((l) => l.client_id).filter(Boolean))];
    const clientsById = await fetchClientsByIds(supabase, clientIds);

    return loans
      .filter((l) => toLocalDateString(l.due_date) === todayLocal)
      .map((l) => {
        const dueYmd = toLocalDateString(l.due_date);
        const { fine_amount, fine } = computeFine({ dueDateYmd: dueYmd, todayYmd: todayLocal, finePerDay });
        const totalAmount = Number(l.total_amount ?? l.amount ?? 0);
        const originalAmount = Number(l.original_amount ?? l.amount ?? 0);
        const client = clientsById.get(l.client_id) || null;
        return {
          ...l,
          companyKey,
          client,
          phone: normalizePhone(client?.phone),
          isInstallment: false,
          due_date_local: dueYmd,
          fine,
          fine_amount,
          totalDue: totalAmount + fine_amount,
          original_amount: originalAmount,
          total_amount: totalAmount,
        };
      });
  }

  if (filterKey === "installments") {
    const { data: installments, error } = await supabase
      .from("installments")
      .select(
        "id,loan_id,client_id,first_due_date,total_amount,installment_amount,total_installments,interest_rate,status"
      )
      .not("status", "in", '("paid","cancelled")');
    if (error) throw new Error(`installments fetch failed: ${error.message}`);

    const installmentIds = (installments || []).map((i) => i.id);
    const paymentsByInstallment = new Map();
    const CHUNK = 300;
    for (let i = 0; i < installmentIds.length; i += CHUNK) {
      const chunk = installmentIds.slice(i, i + CHUNK);
      const { data: pays, error: payErr } = await supabase
        .from("installment_payments")
        .select("installment_id,installment_number,status,paid_date,paid_amount")
        .in("installment_id", chunk);
      if (payErr) throw new Error(`installment_payments fetch failed: ${payErr.message}`);
      for (const p of pays || []) {
        const arr = paymentsByInstallment.get(p.installment_id) || [];
        arr.push(p);
        paymentsByInstallment.set(p.installment_id, arr);
      }
    }

    const clientIds = [
      ...new Set((installments || []).map((i) => i.client_id).filter(Boolean)),
    ];
    const clientsById = await fetchClientsByIds(supabase, clientIds);

    return (installments || []).map((inst) => {
      const paidCount = (paymentsByInstallment.get(inst.id) || []).filter(
        (p) => String(p.status || "").toLowerCase() === "paid"
      ).length;
      const totalInstallments = Number(inst.total_installments || 0);
      const remaining_installments = Math.max(0, totalInstallments - paidCount);
      const installmentAmount = Number(inst.installment_amount || 0);
      const remainingAmount = remaining_installments * installmentAmount;

      const dueYmd = toLocalDateString(inst.first_due_date);
      const { fine_amount, fine } = computeFine({ dueDateYmd: dueYmd, todayYmd: todayLocal, finePerDay });
      const client = clientsById.get(inst.client_id) || null;

      return {
        id: inst.id,
        companyKey,
        client_id: inst.client_id,
        client,
        phone: normalizePhone(client?.phone),
        isInstallment: true,
        installment: {
          ...inst,
          paidCount,
          remaining_installments,
          remainingAmount,
        },
        due_date: inst.first_due_date,
        due_date_local: dueYmd,
        original_amount: remainingAmount,
        total_amount: remainingAmount,
        fine,
        fine_amount,
        totalDue: remainingAmount + fine_amount,
        status: inst.status,
      };
    });
  }

  throw new Error(`Unknown filterKey: ${filterKey}`);
}

