-- CRED CARD - IMPERATRIZ: compatibilidade do schema legado com o app Nexus
-- Preserva todos os dados existentes. Execute após as migrações de login e loan_product.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================
-- CLIENTS
-- =====================================================
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS instagram TEXT,
  ADD COLUMN IF NOT EXISTS facebook TEXT;

-- =====================================================
-- PAYMENTS
-- =====================================================
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS fine_amount DECIMAL(10, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_amount_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_amount_check CHECK (amount >= 0);

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_payment_type_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_payment_type_check CHECK (
    payment_type IN (
      'partial', 'full', 'interest_renewal', 'capital_payment', 'partial_interest',
      'adjustment', 'dinheiro', 'pix', 'transferencia', 'cartao', 'cartao_debito',
      'cartao_credito', 'boleto', 'loan_renewal',
      -- tipos usados pelo app (renovação / quitação)
      'capital_interest_renewal', 'capital_renewal', 'quitacao_total',
      'early_payment_interest_renewal'
    )
  );

-- =====================================================
-- LOANS
-- =====================================================
ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS original_amount DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS contract_pdf_path TEXT,
  ADD COLUMN IF NOT EXISTS contract_pdf_uploaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_authorized BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS authorized_at TIMESTAMPTZ;

UPDATE public.loans
SET original_amount = amount
WHERE original_amount IS NULL;

-- Captação de capital (tabela nova; não remove capital_raising legado)
CREATE TABLE IF NOT EXISTS public.capital_raises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  investidor TEXT,
  valor_levantado NUMERIC NOT NULL,
  juros_percent_total NUMERIC NOT NULL,
  prazo_meses INT NOT NULL,
  parcelas INT NOT NULL DEFAULT 1,
  data_inicio DATE NOT NULL DEFAULT CURRENT_DATE,
  data_vencimento DATE,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS capital_raise_id UUID REFERENCES public.capital_raises (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS capital_raise_capital NUMERIC,
  ADD COLUMN IF NOT EXISTS capital_raise_interest NUMERIC;

CREATE INDEX IF NOT EXISTS capital_raises_ativo_idx ON public.capital_raises (ativo);
CREATE INDEX IF NOT EXISTS loans_capital_raise_id_idx ON public.loans (capital_raise_id);

ALTER TABLE public.loans DROP CONSTRAINT IF EXISTS loans_status_check;
ALTER TABLE public.loans
  ADD CONSTRAINT loans_status_check CHECK (
    status IN (
      'active', 'overdue', 'paid', 'partial_paid', 'cancelled',
      'installments', 'finalized', 'due_today'
    )
  );

COMMENT ON COLUMN public.loans.status IS
  'active | partial_paid | overdue | paid | cancelled | installments | finalized | due_today';

-- loan_product (se ainda não rodou 20260625120000)
ALTER TABLE public.loans
  ADD COLUMN IF NOT EXISTS loan_product TEXT;

UPDATE public.loans
SET loan_product = CASE
  WHEN loan_format = 'semanal' THEN 'semanal_1'
  WHEN loan_format = 'mensal' THEN 'mensal'
  ELSE COALESCE(loan_product, 'mensal')
END
WHERE loan_product IS NULL;

ALTER TABLE public.loans
  ALTER COLUMN loan_product SET DEFAULT 'mensal';

UPDATE public.loans SET loan_product = 'mensal' WHERE loan_product IS NULL;

ALTER TABLE public.loans DROP CONSTRAINT IF EXISTS loans_loan_product_check;
ALTER TABLE public.loans
  ADD CONSTRAINT loans_loan_product_check
  CHECK (loan_product IN ('mensal', 'semanal_1', 'semanal_2'));

-- =====================================================
-- TABELAS AUXILIARES DO APP
-- =====================================================
CREATE TABLE IF NOT EXISTS public.loan_fine_waivers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID NOT NULL REFERENCES public.loans (id) ON DELETE CASCADE,
  waive_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (loan_id, waive_date)
);

CREATE INDEX IF NOT EXISTS loan_fine_waivers_loan_id_idx ON public.loan_fine_waivers (loan_id);

CREATE TABLE IF NOT EXISTS public.loan_weekly_installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID NOT NULL REFERENCES public.loans (id) ON DELETE CASCADE,
  week_number SMALLINT NOT NULL CHECK (week_number BETWEEN 1 AND 4),
  due_date DATE NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  paid_at TIMESTAMPTZ,
  payment_id UUID REFERENCES public.payments (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (loan_id, week_number)
);

CREATE INDEX IF NOT EXISTS idx_loan_weekly_installments_loan_id
  ON public.loan_weekly_installments (loan_id);

CREATE TABLE IF NOT EXISTS public.pix_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_name TEXT NOT NULL,
  pix_key_type TEXT NOT NULL CHECK (pix_key_type IN ('cpf', 'cnpj', 'email', 'phone', 'random')),
  pix_key TEXT NOT NULL,
  account_holder TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.client_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  color TEXT,
  created_by UUID REFERENCES public.users (id),
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.client_fines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  amount DECIMAL(12, 2) NOT NULL CHECK (amount > 0),
  reason TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.calendar_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  day DATE NOT NULL,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  cpf TEXT NOT NULL,
  birth_date DATE,
  address TEXT,
  cep TEXT,
  payment_day INT NOT NULL CHECK (payment_day BETWEEN 1 AND 31),
  salary NUMERIC(12, 2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.renegotiation_proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES public.clients (id) ON DELETE CASCADE,
  debt_ref TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('loan', 'installment')),
  client_name TEXT NOT NULL,
  client_phone TEXT,
  proposal_mode TEXT NOT NULL,
  base_capital NUMERIC(12, 2) NOT NULL,
  discount_percent NUMERIC(5, 2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12, 2) NOT NULL,
  down_payment NUMERIC(12, 2) NOT NULL DEFAULT 0,
  down_payment_due_date DATE,
  installment_count INT NOT NULL DEFAULT 0,
  installment_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'finalized', 'converted')),
  new_loan_id UUID REFERENCES public.loans (id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS renegotiation_proposals_client_id_idx ON public.renegotiation_proposals (client_id);

-- =====================================================
-- VIEWS DO DASHBOARD
-- =====================================================
CREATE OR REPLACE VIEW public.dashboard_payments_totals AS
SELECT
  COALESCE(SUM(p.amount), 0)::NUMERIC AS amount_sum,
  COALESCE(SUM(p.fine_amount), 0)::NUMERIC AS fine_amount_sum,
  (COALESCE(SUM(p.amount), 0) + COALESCE(SUM(p.fine_amount), 0))::NUMERIC AS total_received
FROM public.payments p;

CREATE OR REPLACE VIEW public.dashboard_expenses_totals AS
SELECT
  COALESCE(SUM(e.amount), 0)::NUMERIC AS expenses_total
FROM public.expenses e
WHERE COALESCE(e.status, '') <> 'cancelled';

-- =====================================================
-- RLS DESABILITADO (padrão do banco legado)
-- =====================================================
ALTER TABLE public.capital_raises DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_fine_waivers DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_weekly_installments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.pix_keys DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_tags DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_fines DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_notes DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.renegotiation_proposals DISABLE ROW LEVEL SECURITY;
