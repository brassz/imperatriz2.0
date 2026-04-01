-- Totais para Dashboard (evita agregações via PostgREST querystring, que dão 400)

create or replace view public.dashboard_payments_totals as
select
  coalesce(sum(p.amount), 0)::numeric as amount_sum,
  coalesce(sum(p.fine_amount), 0)::numeric as fine_amount_sum,
  (coalesce(sum(p.amount), 0) + coalesce(sum(p.fine_amount), 0))::numeric as total_received
from public.payments p;

create or replace view public.dashboard_expenses_totals as
select
  coalesce(sum(e.amount), 0)::numeric as expenses_total
from public.expenses e
where coalesce(e.status, '') <> 'cancelled';

