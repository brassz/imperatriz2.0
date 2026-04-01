# Envios automáticos (backend)

Backend Node.js (Express + Socket.IO + node-cron) para:

- CRUD de agendamentos persistidos em `auto-schedules.json`
- Execução de agendamento (busca no Supabase + enfileira mensagens)
- Fila por instância (`omnibot2`, `vinicius`, `douglas`) com delay entre envios
- Eventos realtime via Socket.IO

## Tabelas e campos usados (Supabase / por empresa)

### `loans`
- `id`
- `client_id`
- `due_date`
- `amount`
- `original_amount`
- `total_amount`
- `interest_rate`
- `status` (ignora `paid` e `cancelled`)

### `clients`
- `id`
- `name`
- `phone`

### `installments`
- `id`
- `loan_id`
- `client_id`
- `first_due_date`
- `total_amount`
- `installment_amount`
- `total_installments`
- `interest_rate`
- `status` (ignora `paid` e `cancelled`)

### `installment_payments`
- `installment_id`
- `installment_number`
- `status` (conta `paid`)
- `paid_date`
- `paid_amount`

## Endpoints

### Agendamentos
- `GET /api/auto-send/schedules`
- `POST /api/auto-send/schedules` (upsert)
- `DELETE /api/auto-send/schedules/:id`
- `POST /api/auto-send/schedules/:id/execute`
- `POST /api/auto-send/schedules/reload` (recria crons sem duplicar)

### Fila por instância
- `POST /api/queue/add`
- `GET /api/queue/stats?instanceId=vinicius`
- `POST /api/queue/stop`
- `POST /api/queue/clear`

## Exemplo concreto (obrigatório)

### Agendamento diário 07:30 (franca, overdue + dueToday, delay 7, instância vinicius)

Arquivo `auto-schedules.json`:

```json
[
  {
    "id": "daily-0730-franca",
    "name": "Cobrança diária 07:30",
    "company": "franca",
    "time": "07:30",
    "days": ["all"],
    "filters": ["overdue", "dueToday"],
    "delayMinutes": 7,
    "instanceId": "vinicius",
    "active": true
  }
]
```

### O que ele busca

- **overdue**:
  - busca no banco: `loans` com `due_date < tomorrowLocal` e `status` diferente de `paid/cancelled`
  - filtra em JS (timezone `America/Sao_Paulo`): `toLocalDateString(loan.due_date) < todayLocal`
- **dueToday**:
  - busca no banco: `loans` no intervalo `[yesterdayLocal, tomorrowLocal)` e `status` diferente de `paid/cancelled`
  - filtra em JS: `toLocalDateString(loan.due_date) === todayLocal`

Depois consolida tudo e **deduplica por telefone** (1 mensagem por cliente/telefone) antes de enfileirar.

### Quantos itens coloca na fila

O retorno do endpoint `POST /api/auto-send/schedules/:id/execute` inclui:
- `fetched`: total encontrado somando filtros
- `added`: total realmente enfileirado (após dedupe)

### Como validar a fila

Chame:

- `GET /api/queue/stats?instanceId=vinicius`

E observe:
- `pending` / `queueLength`
- `sent`
- `failed`
- `processing`

## Timezone (crítico)

O backend normaliza datas para `YYYY-MM-DD` em `America/Sao_Paulo` em:
- `backend/src/lib/time.js`

E o cron é criado com:
- `timezone: "America/Sao_Paulo"` (node-cron)

