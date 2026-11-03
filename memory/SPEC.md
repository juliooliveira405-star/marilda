# Madrila ERP — Spec
Idealizado e criado por **Julio Acauã**. Free app (no billing). UI in pt-BR, BRL.
Turns the workbook `Analise_CMV_Estoque_Locale_POA.xlsx` (restaurant Locale POA) into an automated app.

## Auth & roles (Emergent-managed Clerk, email+password only)
- Clerk `<SignIn/>` `/sign-in`, `<SignUp/>` `/sign-up`. Frontend sends `Authorization: Bearer <getToken()>` (lib/api.ts `setAuthTokenGetter`, registered in `AppLayout`'s AuthBridge).
- Roles (code list in `backend/lib/auth.py`): `gerente` (admin: all + Administração, undo uploads, settings), `alimentador` (views + uploads + manual entry), `chefe` (Chefe de Departamento: views only), `pendente` (default for new sign-ups; sees "Aguardando aprovação").
- First gerente: `ADMIN_EMAIL=juliooliveira405@gmail.com` (verified email on first sign-in → gerente). User creates own password at /sign-up.
- Role stored in `db.users {user_id, role, email, name, env}`; enforced server-side on every route.

## Data model (Mongo)
- `purchases` {id, key(dedupe sha1), date, month, numero, serie, fornecedor, razao_social, valor, batch_id}
- `inventory` {id, month, item, descricao, um, qty, ggrupo, grupo, sgrupo, batch_id} — upload for a month replaces that month
- `costs` {item, descricao, grupo, custo (V. Custo Médio), ref, batch_id} — upsert by item
- `periods` {month, faturamento, faturamento_parcial, status aberto|fechado, obs}
- `uploads` {id, kind, filename, month, status processando|concluido|erro|desfeito, rows, message, ai_used, undoable, user_email, created_at}
- `settings` {_id: global, empresa, cmv_meta_min 0.28, cmv_meta_max 0.30}; `insights` {id, model, model_name, focus, question, content, created_at}

## Calculations (backend/lib/metrics.py)
- Stock value month = Σ max(qty,0) × custo (by item code). CMV(m) = Estoque(m-1) + Compras(m) − Estoque(m) (consecutive months only); CMV% = CMV / faturamento.
- Projection for open month: compras × days_in_month / last purchase day.
- ABC: cumulative share before the supplier <80% → A, <95% → B, else C.
- Reorder (last two inventories): ZERADO, NOVO, ESTÁVEL, BAIXOU FORTE (≤-40% and ≤-2 un), BAIXOU, SUBIU MUITO (≥50% and ≥5 un), SUBIU. Reposição R$ = (ant − atual) × custo for ZERADO/BAIXOU FORTE.
- Alerts: CMV above/below target, missing faturamento, items without cost, projection, supplier concentration, zerados, sobreestoque.
- Savings simulator (frontend, Economia.tsx): (CMV atual − meta) × faturamento + negociação% × compras classe A/mês; accumulated over horizon; months to reach a R$ goal.

## Uploads (POST /api/uploads multipart kind, month?, file) — processed in background, UI polls
- kinds: compras, inventario (month), custos, faturamento, completa (full workbook).
- xlsx/csv: header auto-detection (lib/parsers.py); if nothing found → AI fallback (Gemini 3 Flash reads CSV text). PDF → Gemini 3 Flash extraction.
- Manual entry: PUT /api/periods/{YYYY-MM}.

## AI (Emergent universal key) — POST /api/insights {model: claude-sonnet-4.5|gemini-3-flash|gpt-5.2, focus, question}

## Seed facts (python seed.py; --reset to reload)
Imported from the user's workbook: 664 costs, inventories Jul/Ago/Set/Out-26 (444/697/705/668 items), 1143 notas (R$ 1.454.200,12), faturamento Ago 1.133.052 / Set 1.078.183 / Out 941.734 (parcial). Expected: CMV Ago 22,9%, Set 19,6%, Out 39,8%; estoque Out R$ 366.708; reorder Set→Out: 62 ZERADO, 78 BAIXOU FORTE; top supplier PESCADOS DO PORTO R$ 289.879,18.

## API
GET /api/me, /api/users (gerente), PATCH /api/users/{id}/role (gerente), GET/PUT /api/settings, GET /api/dashboard, /api/suppliers, /api/reorder?from_month&to_month, GET/POST/DELETE /api/uploads, GET/PUT /api/periods, GET /api/ai/models, GET/POST /api/insights.
