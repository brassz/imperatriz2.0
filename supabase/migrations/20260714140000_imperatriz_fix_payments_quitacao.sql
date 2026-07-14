-- CRED CARD - IMPERATRIZ: libera registrar pagamento / quitar
-- Sintomas atuais:
-- 1) payments_payment_type_check rejeita quitacao_total, capital_interest_renewal, capital_renewal
-- 2) ao marcar loans.status = 'paid', trigger insert_paid_loan falha com:
--    "there is no unique or exclusion constraint matching the ON CONFLICT specification"
--
-- Execute no SQL Editor do Supabase (projeto ljueldqxrqnwgfslsssr). Preserva dados.

-- =====================================================
-- 1) Tipos de pagamento usados pelo app
-- =====================================================
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_payment_type_check;

ALTER TABLE public.payments
  ADD CONSTRAINT payments_payment_type_check CHECK (
    payment_type IN (
      'partial',
      'full',
      'interest_renewal',
      'capital_payment',
      'partial_interest',
      'adjustment',
      'dinheiro',
      'pix',
      'transferencia',
      'cartao',
      'cartao_debito',
      'cartao_credito',
      'boleto',
      'loan_renewal',
      'capital_interest_renewal',
      'capital_renewal',
      'quitacao_total',
      'early_payment_interest_renewal'
    )
  );

-- =====================================================
-- 2) UNIQUE em loan_id para ON CONFLICT dos triggers
-- =====================================================
-- Remove duplicatas (mantém a linha mais recente) antes do índice único.
DELETE FROM public.paid_loans a
USING public.paid_loans b
WHERE a.loan_id = b.loan_id
  AND a.ctid < b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS paid_loans_loan_id_unique_idx
  ON public.paid_loans (loan_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'overdue_loans'
  ) THEN
    DELETE FROM public.overdue_loans a
    USING public.overdue_loans b
    WHERE a.loan_id = b.loan_id
      AND a.ctid < b.ctid;

    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS overdue_loans_loan_id_unique_idx ON public.overdue_loans (loan_id)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'partial_paid_loans'
  ) THEN
    DELETE FROM public.partial_paid_loans a
    USING public.partial_paid_loans b
    WHERE a.loan_id = b.loan_id
      AND a.ctid < b.ctid;

    EXECUTE 'CREATE UNIQUE INDEX IF NOT EXISTS partial_paid_loans_loan_id_unique_idx ON public.partial_paid_loans (loan_id)';
  END IF;
END
$$;
