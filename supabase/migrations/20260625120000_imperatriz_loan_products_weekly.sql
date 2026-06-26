-- CRED CARD - IMPERATRIZ: tipos de empréstimo e parcelas semanais
-- Preserva todos os dados existentes (loan_format permanece intacto).

ALTER TABLE loans
  ADD COLUMN IF NOT EXISTS loan_product TEXT;

-- Migra loan_format legado para loan_product (sem apagar coluna antiga)
UPDATE loans
SET loan_product = CASE
  WHEN loan_format = 'semanal' THEN 'semanal_1'
  WHEN loan_format = 'mensal' THEN 'mensal'
  ELSE COALESCE(loan_product, 'mensal')
END
WHERE loan_product IS NULL;

ALTER TABLE loans
  ALTER COLUMN loan_product SET DEFAULT 'mensal';

UPDATE loans SET loan_product = 'mensal' WHERE loan_product IS NULL;

ALTER TABLE loans
  ALTER COLUMN loan_product SET NOT NULL;

ALTER TABLE loans DROP CONSTRAINT IF EXISTS loans_loan_product_check;
ALTER TABLE loans
  ADD CONSTRAINT loans_loan_product_check
  CHECK (loan_product IN ('mensal', 'semanal_1', 'semanal_2'));

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
