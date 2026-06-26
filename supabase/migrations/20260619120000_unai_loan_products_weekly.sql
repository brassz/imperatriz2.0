-- Unaí Cred: tipos de empréstimo e parcelas semanais (4 semanas)

ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS loan_product TEXT NOT NULL DEFAULT 'mensal';

ALTER TABLE loans DROP CONSTRAINT IF EXISTS loans_loan_product_check;
ALTER TABLE loans
  ADD CONSTRAINT loans_loan_product_check
  CHECK (loan_product IN ('mensal', '20_dias', 'semanal_1', 'semanal_2'));

CREATE TABLE IF NOT EXISTS loan_weekly_installments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  loan_id UUID NOT NULL REFERENCES loans(id) ON DELETE CASCADE,
  week_number SMALLINT NOT NULL CHECK (week_number BETWEEN 1 AND 4),
  due_date DATE NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  paid_at TIMESTAMPTZ,
  payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (loan_id, week_number)
);

CREATE INDEX IF NOT EXISTS idx_loan_weekly_installments_loan_id
  ON loan_weekly_installments (loan_id);

ALTER TABLE loan_weekly_installments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS loan_weekly_installments_all ON loan_weekly_installments;
CREATE POLICY loan_weekly_installments_all ON loan_weekly_installments
  FOR ALL USING (true) WITH CHECK (true);
