# Deploy no Vercel – NEXUS (sistema novo)

## 1. Configurar o projeto

- **Root Directory**: Defina como `nexus-fintech-hub-main` nas configurações do projeto no Vercel para que apenas este app seja construído.

## 2. Variáveis de ambiente

Em **Settings → Environment Variables**, adicione:

| Variável | Descrição |
|----------|-----------|
| `VITE_SUPABASE_URL` ou `VITE_SUPABASE_URL_EMPRESA1` | URL do projeto Supabase |
| `VITE_SUPABASE_ANON_KEY` ou `VITE_SUPABASE_ANON_KEY_EMPRESA1` | Chave anônima do Supabase |
| `VITE_COMPANY_NAME` | (Opcional) Nome da empresa nos PDFs |
| `VITE_COMPANY_BRANCH` | (Opcional) Filial nos PDFs |

## 3. Importar / conectar ao repositório

- Se o repositório incluir o sistema antigo e o novo, use **Root Directory** = `nexus-fintech-hub-main`.
- Ou faça o deploy a partir de um branch/ repo que contenha apenas a pasta do sistema novo.

## 4. Build e deploy

- Build Command: `npm run build` (ou `bun run build`)
- Output Directory: `dist`
- Framework: Vite

O `vercel.json` já está configurado para SPA (React Router) e build com Vite.
