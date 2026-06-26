-- =====================================================
-- UNAÍ CRED (empresa5) — BANCO DE DADOS COMPLETO
-- =====================================================
-- Schema consolidado do Nexus Gestão Financeira com todas
-- as funcionalidades atuais + alterações específicas Unaí:
--   • loan_product (mensal | 20_dias | semanal_1 | semanal_2)
--   • loan_weekly_installments (4 parcelas semanais)
--
-- Projeto Supabase: ghfbhbnbwohliylbkucy
-- Execute este arquivo inteiro no SQL Editor do Supabase.
-- =====================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================
-- TABELAS PRINCIPAIS
-- =====================================================

CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT DEFAULT 'user' CHECK (role IN ('admin', 'user', 'manager')),
    is_active BOOLEAN DEFAULT true,
    phone TEXT,
    last_login TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.clients (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    cpf TEXT UNIQUE,
    email TEXT,
    phone TEXT,
    address TEXT,
    rg TEXT,
    birth_date DATE,
    photo TEXT,
    instagram TEXT,
    facebook TEXT,
    created_by UUID REFERENCES public.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS public.loans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
    original_amount DECIMAL(10,2),
    interest_rate DECIMAL(5,2) NOT NULL CHECK (interest_rate >= 0),
    loan_date DATE NOT NULL,
    due_date DATE NOT NULL,
    status TEXT DEFAULT 'active' CHECK (
        status = ANY (ARRAY[
            'active', 'overdue', 'paid', 'partial_paid', 'cancelled',
            'installments', 'finalized', 'due_today'
        ])
    ),
    total_amount DECIMAL(10,2) GENERATED ALWAYS AS (amount + (amount * interest_rate / 100)) STORED,
    loan_product TEXT NOT NULL DEFAULT 'mensal' CHECK (
        loan_product IN ('mensal', '20_dias', 'semanal_1', 'semanal_2')
    ),
    capital_raise_id UUID REFERENCES public.capital_raises(id) ON DELETE SET NULL,
    capital_raise_capital NUMERIC,
    capital_raise_interest NUMERIC,
    contract_pdf_path TEXT,
    contract_pdf_uploaded_at TIMESTAMPTZ,
    is_authorized BOOLEAN NOT NULL DEFAULT false,
    authorized_at TIMESTAMPTZ,
    created_by UUID REFERENCES public.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON COLUMN public.loans.status IS
    'active | partial_paid | overdue | paid | cancelled | installments | finalized | due_today';
COMMENT ON COLUMN public.loans.loan_product IS
    'Unaí Cred: mensal, 20_dias, semanal_1, semanal_2';

CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_id UUID NOT NULL REFERENCES public.loans(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL CHECK (amount >= 0),
    fine_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
    payment_date DATE NOT NULL,
    payment_type TEXT DEFAULT 'partial',
    notes TEXT,
    created_by UUID REFERENCES public.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.loan_weekly_installments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_id UUID NOT NULL REFERENCES public.loans(id) ON DELETE CASCADE,
    week_number SMALLINT NOT NULL CHECK (week_number BETWEEN 1 AND 4),
    due_date DATE NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
    paid_at TIMESTAMPTZ,
    payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (loan_id, week_number)
);

CREATE TABLE IF NOT EXISTS public.guarantors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    cpf TEXT NOT NULL,
    rg TEXT,
    email TEXT,
    phone TEXT NOT NULL,
    address TEXT,
    birth_date DATE,
    relationship TEXT,
    photo TEXT,
    created_by UUID REFERENCES public.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.emergency_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    created_by UUID REFERENCES public.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.client_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL CHECK (
        category IN ('identificacao', 'comprovante_renda', 'comprovante_residencia', 'referencias', 'outros')
    ),
    file_path TEXT NOT NULL,
    file_type VARCHAR(100),
    file_size INTEGER,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS public.client_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    color TEXT,
    created_by UUID REFERENCES public.users(id),
    created_by_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.client_fines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    amount DECIMAL(12,2) NOT NULL CHECK (amount > 0),
    reason TEXT NOT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.expense_categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    color TEXT DEFAULT '#6B7280',
    icon TEXT DEFAULT 'receipt',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    category_id UUID REFERENCES public.expense_categories(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    description TEXT,
    amount DECIMAL(10,2) NOT NULL CHECK (amount > 0),
    expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
    payment_method TEXT DEFAULT 'cash' CHECK (
        payment_method IN ('cash', 'card', 'pix', 'transfer', 'check', 'other')
    ),
    receipt_url TEXT,
    signature TEXT,
    tags TEXT[],
    is_recurring BOOLEAN DEFAULT false,
    recurring_frequency TEXT CHECK (
        recurring_frequency IN ('daily', 'weekly', 'monthly', 'yearly') OR recurring_frequency IS NULL
    ),
    parent_expense_id UUID REFERENCES public.expenses(id) ON DELETE SET NULL,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'paid', 'cancelled')),
    notes TEXT,
    created_by UUID REFERENCES public.users(id),
    approved_by UUID REFERENCES public.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.installments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_id UUID REFERENCES public.loans(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    total_amount DECIMAL(15,2) NOT NULL,
    total_installments INTEGER NOT NULL CHECK (total_installments > 0),
    installment_amount DECIMAL(15,2) NOT NULL,
    first_due_date DATE NOT NULL,
    interest_rate DECIMAL(5,2) DEFAULT 0.00,
    status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
    notes TEXT,
    created_by UUID REFERENCES public.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.installment_payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    installment_id UUID NOT NULL REFERENCES public.installments(id) ON DELETE CASCADE,
    installment_number INTEGER NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    due_date DATE NOT NULL,
    paid_date DATE,
    paid_amount DECIMAL(15,2) DEFAULT 0.00,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue', 'partial')),
    payment_method TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (installment_id, installment_number)
);

CREATE TABLE IF NOT EXISTS public.cash_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_type TEXT NOT NULL CHECK (transaction_type IN ('deposit', 'withdrawal')),
    amount DECIMAL(15,2) NOT NULL CHECK (amount > 0),
    description TEXT,
    reference_id UUID,
    reference_type TEXT CHECK (reference_type IN ('loan', 'expense', 'manual', 'installment')),
    balance_after DECIMAL(15,2) NOT NULL,
    created_by UUID REFERENCES public.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.cash_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    current_balance DECIMAL(15,2) DEFAULT 0 NOT NULL,
    initial_balance DECIMAL(15,2) DEFAULT 0 NOT NULL,
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID REFERENCES public.users(id)
);

CREATE TABLE IF NOT EXISTS public.pix_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_name TEXT NOT NULL,
    pix_key_type TEXT NOT NULL CHECK (pix_key_type IN ('cpf', 'cnpj', 'email', 'phone', 'random')),
    pix_key TEXT NOT NULL,
    account_holder TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
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
    salary NUMERIC(12,2) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.loan_fine_waivers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_id UUID NOT NULL REFERENCES public.loans(id) ON DELETE CASCADE,
    waive_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (loan_id, waive_date)
);

CREATE TABLE IF NOT EXISTS public.loan_signature_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_id UUID NOT NULL REFERENCES public.loans(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    contract_pdf_path TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    accepted_terms BOOLEAN NOT NULL DEFAULT false,
    signer_name TEXT,
    signature_data_url TEXT
);

CREATE TABLE IF NOT EXISTS public.login_tokens (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.renegotiation_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
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
    new_loan_id UUID REFERENCES public.loans(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finalized_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.whatsapp_loan_flows (
    id BIGSERIAL PRIMARY KEY,
    instance_id TEXT NOT NULL,
    remote_jid TEXT,
    remote_phone TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    step TEXT NOT NULL DEFAULT 'start',
    draft_payload JSONB,
    created_client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    created_loan_id UUID REFERENCES public.loans(id) ON DELETE SET NULL,
    last_message_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_error TEXT,
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tabelas de status de empréstimos
CREATE TABLE IF NOT EXISTS public.paid_loans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_id UUID NOT NULL UNIQUE REFERENCES public.loans(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    original_amount DECIMAL(10,2) NOT NULL,
    interest_rate DECIMAL(5,2) NOT NULL,
    total_with_interest DECIMAL(10,2) NOT NULL,
    loan_date DATE NOT NULL,
    due_date DATE NOT NULL,
    paid_date DATE NOT NULL DEFAULT CURRENT_DATE,
    total_paid DECIMAL(10,2) NOT NULL,
    payment_method VARCHAR(50),
    notes TEXT,
    created_by UUID REFERENCES public.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.overdue_loans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_id UUID NOT NULL UNIQUE REFERENCES public.loans(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    original_amount DECIMAL(10,2) NOT NULL,
    interest_rate DECIMAL(5,2) NOT NULL,
    total_with_interest DECIMAL(10,2) NOT NULL,
    loan_date DATE NOT NULL,
    due_date DATE NOT NULL,
    days_overdue INTEGER NOT NULL DEFAULT 0,
    remaining_amount DECIMAL(10,2) NOT NULL,
    total_paid DECIMAL(10,2) DEFAULT 0,
    last_payment_date DATE,
    collection_notes TEXT,
    collection_status VARCHAR(50) DEFAULT 'pending',
    created_by UUID REFERENCES public.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.partial_paid_loans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_id UUID NOT NULL UNIQUE REFERENCES public.loans(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    original_amount DECIMAL(10,2) NOT NULL,
    interest_rate DECIMAL(5,2) NOT NULL,
    total_with_interest DECIMAL(10,2) NOT NULL,
    loan_date DATE NOT NULL,
    due_date DATE NOT NULL,
    total_paid DECIMAL(10,2) NOT NULL DEFAULT 0,
    remaining_amount DECIMAL(10,2) NOT NULL,
    payment_count INTEGER DEFAULT 0,
    last_payment_date DATE,
    next_payment_date DATE,
    payment_schedule TEXT,
    installment_amount DECIMAL(10,2),
    created_by UUID REFERENCES public.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.cancelled_loans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    loan_id UUID NOT NULL UNIQUE REFERENCES public.loans(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    original_amount DECIMAL(10,2) NOT NULL,
    interest_rate DECIMAL(5,2) NOT NULL,
    total_with_interest DECIMAL(10,2) NOT NULL,
    loan_date DATE NOT NULL,
    due_date DATE NOT NULL,
    cancellation_date DATE NOT NULL DEFAULT CURRENT_DATE,
    cancellation_reason TEXT NOT NULL,
    total_paid_before_cancellation DECIMAL(10,2) DEFAULT 0,
    refund_amount DECIMAL(10,2) DEFAULT 0,
    cancellation_fee DECIMAL(10,2) DEFAULT 0,
    cancelled_by UUID REFERENCES public.users(id),
    created_by UUID REFERENCES public.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- ÍNDICES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_users_email ON public.users(email);
CREATE INDEX IF NOT EXISTS idx_clients_cpf ON public.clients(cpf);
CREATE INDEX IF NOT EXISTS idx_loans_client_id ON public.loans(client_id);
CREATE INDEX IF NOT EXISTS idx_loans_status ON public.loans(status);
CREATE INDEX IF NOT EXISTS idx_loans_due_date ON public.loans(due_date);
CREATE INDEX IF NOT EXISTS idx_loans_capital_raise_id ON public.loans(capital_raise_id);
CREATE INDEX IF NOT EXISTS idx_loans_contract_pdf_path ON public.loans(contract_pdf_path);
CREATE INDEX IF NOT EXISTS idx_loans_is_authorized ON public.loans(is_authorized);
CREATE INDEX IF NOT EXISTS idx_loan_weekly_installments_loan_id ON public.loan_weekly_installments(loan_id);
CREATE INDEX IF NOT EXISTS idx_payments_loan_id ON public.payments(loan_id);
CREATE INDEX IF NOT EXISTS idx_payments_payment_date ON public.payments(payment_date);
CREATE INDEX IF NOT EXISTS loan_fine_waivers_loan_id_idx ON public.loan_fine_waivers(loan_id);
CREATE INDEX IF NOT EXISTS loan_signature_requests_loan_id_idx ON public.loan_signature_requests(loan_id);
CREATE INDEX IF NOT EXISTS loan_signature_requests_token_hash_idx ON public.loan_signature_requests(token_hash);
CREATE INDEX IF NOT EXISTS loan_signature_requests_expires_idx ON public.loan_signature_requests(expires_at);
CREATE INDEX IF NOT EXISTS login_tokens_email_idx ON public.login_tokens(email);
CREATE INDEX IF NOT EXISTS login_tokens_expires_idx ON public.login_tokens(expires_at);
CREATE INDEX IF NOT EXISTS renegotiation_proposals_client_id_idx ON public.renegotiation_proposals(client_id);
CREATE INDEX IF NOT EXISTS renegotiation_proposals_status_idx ON public.renegotiation_proposals(status);
CREATE INDEX IF NOT EXISTS renegotiation_proposals_debt_ref_idx ON public.renegotiation_proposals(debt_ref);
CREATE INDEX IF NOT EXISTS capital_raises_ativo_idx ON public.capital_raises(ativo);
CREATE INDEX IF NOT EXISTS capital_raises_parcelas_idx ON public.capital_raises(parcelas);

-- =====================================================
-- FUNÇÕES E TRIGGERS
-- =====================================================

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.calculate_loan_status()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status IS NOT NULL
       AND NEW.status IN ('paid', 'cancelled', 'finalized', 'installments', 'partial_paid') THEN
        RETURN NEW;
    END IF;

    IF NEW.due_date < CURRENT_DATE THEN
        NEW.status = 'overdue';
    ELSIF NEW.due_date = CURRENT_DATE THEN
        NEW.status = 'due_today';
    ELSE
        NEW.status = 'active';
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.insert_paid_loan()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status = 'paid'
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid') THEN
        INSERT INTO public.paid_loans (
            loan_id, client_id, original_amount, interest_rate,
            total_with_interest, loan_date, due_date, total_paid, created_by
        ) VALUES (
            NEW.id, NEW.client_id, NEW.amount, NEW.interest_rate,
            NEW.amount + (NEW.amount * NEW.interest_rate / 100),
            NEW.loan_date, NEW.due_date,
            COALESCE((SELECT SUM(amount) FROM public.payments WHERE loan_id = NEW.id), 0),
            NEW.created_by
        )
        ON CONFLICT (loan_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.insert_overdue_loan()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.due_date < CURRENT_DATE
       AND NEW.status NOT IN ('paid', 'cancelled', 'finalized') THEN
        INSERT INTO public.overdue_loans (
            loan_id, client_id, original_amount, interest_rate,
            total_with_interest, loan_date, due_date, days_overdue,
            remaining_amount, total_paid, created_by
        ) VALUES (
            NEW.id, NEW.client_id, NEW.amount, NEW.interest_rate,
            NEW.amount + (NEW.amount * NEW.interest_rate / 100),
            NEW.loan_date, NEW.due_date,
            CURRENT_DATE - NEW.due_date,
            (NEW.amount + (NEW.amount * NEW.interest_rate / 100))
                - COALESCE((SELECT SUM(amount) FROM public.payments WHERE loan_id = NEW.id), 0),
            COALESCE((SELECT SUM(amount) FROM public.payments WHERE loan_id = NEW.id), 0),
            NEW.created_by
        )
        ON CONFLICT (loan_id) DO UPDATE SET
            days_overdue = CURRENT_DATE - NEW.due_date,
            remaining_amount = (NEW.amount + (NEW.amount * NEW.interest_rate / 100))
                - COALESCE((SELECT SUM(amount) FROM public.payments WHERE loan_id = NEW.id), 0),
            total_paid = COALESCE((SELECT SUM(amount) FROM public.payments WHERE loan_id = NEW.id), 0),
            updated_at = NOW();
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.insert_partial_paid_loan()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status = 'partial_paid'
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'partial_paid') THEN
        INSERT INTO public.partial_paid_loans (
            loan_id, client_id, original_amount, interest_rate,
            total_with_interest, loan_date, due_date, total_paid,
            remaining_amount, payment_count, last_payment_date, created_by
        ) VALUES (
            NEW.id, NEW.client_id, NEW.amount, NEW.interest_rate,
            NEW.amount + (NEW.amount * NEW.interest_rate / 100),
            NEW.loan_date, NEW.due_date,
            COALESCE((SELECT SUM(amount) FROM public.payments WHERE loan_id = NEW.id), 0),
            (NEW.amount + (NEW.amount * NEW.interest_rate / 100))
                - COALESCE((SELECT SUM(amount) FROM public.payments WHERE loan_id = NEW.id), 0),
            (SELECT COUNT(*) FROM public.payments WHERE loan_id = NEW.id),
            (SELECT MAX(payment_date) FROM public.payments WHERE loan_id = NEW.id),
            NEW.created_by
        )
        ON CONFLICT (loan_id) DO UPDATE SET
            total_paid = COALESCE((SELECT SUM(amount) FROM public.payments WHERE loan_id = NEW.id), 0),
            remaining_amount = (NEW.amount + (NEW.amount * NEW.interest_rate / 100))
                - COALESCE((SELECT SUM(amount) FROM public.payments WHERE loan_id = NEW.id), 0),
            payment_count = (SELECT COUNT(*) FROM public.payments WHERE loan_id = NEW.id),
            last_payment_date = (SELECT MAX(payment_date) FROM public.payments WHERE loan_id = NEW.id),
            updated_at = NOW();
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.insert_cancelled_loan()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status = 'cancelled'
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'cancelled') THEN
        INSERT INTO public.cancelled_loans (
            loan_id, client_id, original_amount, interest_rate,
            total_with_interest, loan_date, due_date, total_paid_before_cancellation,
            created_by, cancellation_reason
        ) VALUES (
            NEW.id, NEW.client_id, NEW.amount, NEW.interest_rate,
            NEW.amount + (NEW.amount * NEW.interest_rate / 100),
            NEW.loan_date, NEW.due_date,
            COALESCE((SELECT SUM(amount) FROM public.payments WHERE loan_id = NEW.id), 0),
            NEW.created_by, 'Cancelamento automático'
        )
        ON CONFLICT (loan_id) DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_loan_status_tables()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status IN ('paid', 'cancelled', 'finalized') THEN
        DELETE FROM public.overdue_loans WHERE loan_id = NEW.id;
    END IF;

    IF NEW.status IN ('paid', 'cancelled', 'finalized') THEN
        DELETE FROM public.partial_paid_loans WHERE loan_id = NEW.id;
    END IF;

    IF NEW.status = 'cancelled' THEN
        DELETE FROM public.paid_loans WHERE loan_id = NEW.id;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.cleanup_paid_loans_on_finalize()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.status = 'finalized' AND OLD.status IS DISTINCT FROM 'finalized' THEN
        DELETE FROM public.paid_loans WHERE loan_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_installment_status()
RETURNS TRIGGER AS $$
DECLARE
    total_parcelas INTEGER;
    parcelas_pagas INTEGER;
BEGIN
    SELECT i.total_installments, COUNT(CASE WHEN ip.status = 'paid' THEN 1 END)
    INTO total_parcelas, parcelas_pagas
    FROM public.installments i
    LEFT JOIN public.installment_payments ip ON i.id = ip.installment_id
    WHERE i.id = NEW.installment_id
    GROUP BY i.total_installments;

    IF parcelas_pagas = total_parcelas THEN
        UPDATE public.installments SET status = 'completed', updated_at = NOW() WHERE id = NEW.installment_id;
    ELSIF parcelas_pagas > 0 THEN
        UPDATE public.installments SET status = 'active', updated_at = NOW() WHERE id = NEW.installment_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.update_cash_balance()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.cash_settings
    SET current_balance = NEW.balance_after,
        last_updated = NOW(),
        updated_by = NEW.created_by
    WHERE id = (SELECT id FROM public.cash_settings LIMIT 1);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.update_capital_raises_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers updated_at
DROP TRIGGER IF EXISTS update_users_updated_at ON public.users;
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_clients_updated_at ON public.clients;
CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON public.clients
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_loans_updated_at ON public.loans;
CREATE TRIGGER update_loans_updated_at BEFORE UPDATE ON public.loans
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS trigger_calculate_loan_status ON public.loans;
CREATE TRIGGER trigger_calculate_loan_status
    BEFORE INSERT OR UPDATE ON public.loans
    FOR EACH ROW EXECUTE FUNCTION public.calculate_loan_status();

DROP TRIGGER IF EXISTS trigger_insert_paid_loan ON public.loans;
CREATE TRIGGER trigger_insert_paid_loan
    AFTER INSERT OR UPDATE ON public.loans
    FOR EACH ROW EXECUTE FUNCTION public.insert_paid_loan();

DROP TRIGGER IF EXISTS trigger_insert_overdue_loan ON public.loans;
CREATE TRIGGER trigger_insert_overdue_loan
    AFTER INSERT OR UPDATE ON public.loans
    FOR EACH ROW EXECUTE FUNCTION public.insert_overdue_loan();

DROP TRIGGER IF EXISTS trigger_insert_partial_paid_loan ON public.loans;
CREATE TRIGGER trigger_insert_partial_paid_loan
    AFTER INSERT OR UPDATE ON public.loans
    FOR EACH ROW EXECUTE FUNCTION public.insert_partial_paid_loan();

DROP TRIGGER IF EXISTS trigger_insert_cancelled_loan ON public.loans;
CREATE TRIGGER trigger_insert_cancelled_loan
    AFTER INSERT OR UPDATE ON public.loans
    FOR EACH ROW EXECUTE FUNCTION public.insert_cancelled_loan();

DROP TRIGGER IF EXISTS trigger_cleanup_loan_status_tables ON public.loans;
CREATE TRIGGER trigger_cleanup_loan_status_tables
    AFTER UPDATE ON public.loans
    FOR EACH ROW EXECUTE FUNCTION public.cleanup_loan_status_tables();

DROP TRIGGER IF EXISTS trigger_cleanup_paid_on_finalize ON public.loans;
CREATE TRIGGER trigger_cleanup_paid_on_finalize
    AFTER UPDATE ON public.loans
    FOR EACH ROW EXECUTE FUNCTION public.cleanup_paid_loans_on_finalize();

DROP TRIGGER IF EXISTS trigger_update_installment_status ON public.installment_payments;
CREATE TRIGGER trigger_update_installment_status
    AFTER INSERT OR UPDATE ON public.installment_payments
    FOR EACH ROW EXECUTE FUNCTION public.update_installment_status();

DROP TRIGGER IF EXISTS trigger_update_cash_balance ON public.cash_transactions;
CREATE TRIGGER trigger_update_cash_balance
    AFTER INSERT ON public.cash_transactions
    FOR EACH ROW EXECUTE FUNCTION public.update_cash_balance();

DROP TRIGGER IF EXISTS update_capital_raises_timestamp ON public.capital_raises;
CREATE TRIGGER update_capital_raises_timestamp
    BEFORE UPDATE ON public.capital_raises
    FOR EACH ROW EXECUTE FUNCTION public.update_capital_raises_timestamp();

-- =====================================================
-- VIEWS
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

CREATE OR REPLACE VIEW public.loans_with_details AS
SELECT
    l.*,
    c.name AS client_name,
    c.cpf AS client_cpf,
    c.email AS client_email,
    c.phone AS client_phone,
    c.photo AS client_photo,
    u.full_name AS created_by_name,
    u.role AS created_by_role
FROM public.loans l
JOIN public.clients c ON l.client_id = c.id
LEFT JOIN public.users u ON l.created_by = u.id;

CREATE OR REPLACE VIEW public.financial_summary AS
SELECT
    COUNT(DISTINCT c.id) AS total_clients,
    COUNT(l.id) AS total_loans,
    SUM(l.amount) AS total_loaned,
    SUM(l.total_amount - l.amount) AS total_interest,
    SUM(l.total_amount) AS total_with_interest,
    COUNT(CASE WHEN l.status = 'active' THEN 1 END) AS active_loans,
    COUNT(CASE WHEN l.status = 'overdue' THEN 1 END) AS overdue_loans,
    COUNT(CASE WHEN l.status = 'paid' THEN 1 END) AS paid_loans
FROM public.clients c
LEFT JOIN public.loans l ON c.id = l.client_id;

-- =====================================================
-- STORAGE (contratos PDF)
-- =====================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('contratos', 'contratos', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Public read contratos'
    ) THEN
        CREATE POLICY "Public read contratos"
        ON storage.objects FOR SELECT
        USING (bucket_id = 'contratos');
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Write contratos (insert) by role'
    ) THEN
        CREATE POLICY "Write contratos (insert) by role"
        ON storage.objects FOR INSERT
        WITH CHECK (bucket_id = 'contratos' AND auth.role() IN ('anon', 'authenticated'));
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Write contratos (update) by role'
    ) THEN
        CREATE POLICY "Write contratos (update) by role"
        ON storage.objects FOR UPDATE
        USING (bucket_id = 'contratos' AND auth.role() IN ('anon', 'authenticated'))
        WITH CHECK (bucket_id = 'contratos' AND auth.role() IN ('anon', 'authenticated'));
    END IF;
END $$;

-- =====================================================
-- RLS — desabilitado (login customizado via tabela users + anon key)
-- =====================================================

DO $$
DECLARE
    t TEXT;
BEGIN
    FOR t IN
        SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    LOOP
        EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
    END LOOP;
END $$;

-- =====================================================
-- DADOS INICIAIS
-- =====================================================

INSERT INTO public.cash_settings (current_balance, initial_balance)
SELECT 0, 0
WHERE NOT EXISTS (SELECT 1 FROM public.cash_settings);

INSERT INTO public.expense_categories (name, description, color, icon) VALUES
('Alimentação', 'Despesas com comida e bebidas', '#EF4444', 'utensils'),
('Transporte', 'Despesas com locomoção', '#3B82F6', 'car'),
('Escritório', 'Material de escritório e equipamentos', '#8B5CF6', 'briefcase'),
('Marketing', 'Despesas com publicidade e marketing', '#F59E0B', 'megaphone'),
('Tecnologia', 'Equipamentos e software', '#10B981', 'laptop'),
('Saúde', 'Despesas médicas e farmácia', '#EC4899', 'heart'),
('Educação', 'Cursos, livros e treinamentos', '#6366F1', 'book'),
('Limpeza', 'Produtos de limpeza e higiene', '#14B8A6', 'spray'),
('Manutenção', 'Reparos e manutenções', '#F97316', 'wrench'),
('Outros', 'Despesas diversas', '#6B7280', 'folder')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.users (email, password_hash, full_name, role, is_active) VALUES
    ('admin@nexus.com', '1020', 'Administrador Nexus', 'admin', true),
    ('douglas@nexus.com', '1020', 'Douglas Nexus', 'admin', true),
    ('vinicius@nexus.com', '36996352123', 'Vinicius Admin', 'admin', true)
ON CONFLICT (email) DO UPDATE SET
    role = EXCLUDED.role,
    is_active = true,
    updated_at = NOW();

-- =====================================================
-- VERIFICAÇÃO
-- =====================================================

SELECT
    'UNAÍ CRED DATABASE SETUP COMPLETED' AS status,
    'Schema completo com loan_product e loan_weekly_installments' AS message,
    'Admins: admin@nexus.com, douglas@nexus.com, vinicius@nexus.com' AS login_info;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;
