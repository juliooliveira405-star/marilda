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
- `periods` {month, faturamento, faturamento_parcial, faturamento_ate, estoque_ate, compras_completas (null=auto), obs} — status is COMPUTED, not stored
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

## Month completeness (v2) — metrics.completeness()
- Month list = continuous range from first month with data up to the CURRENT month (America/Sao_Paulo), so Nov/26 appears even without data.
- fechado only if: inventário de fechamento (inventory exists and estoque_ate empty or ≥ last day−2) + faturamento completo (value, not parcial, faturamento_ate empty or ≥ month end) + compras completas (override flag, else last purchase ≥ last day−3). Otherwise "aberto/incompleto" with `pendencias` and `alerta_parcial` text ("Out/26 incompleto — estoque até 18/10 · compras até 22/10 · faturamento parcial. CMV % é parcial até o fechamento.").
- Banners (PartialMonthAlerts) on Painel, CMV & Estoque, Simulador; "Parcial" tag on CMV cards/cells. Manual entry form sets the cut-off dates.

## Users (v2)
- Gerente approves Pendente users via dialog with mandatory role, or invites by e-mail (POST /api/users/invite → Clerk invitation email; role applied on first sign-in from db.invites). Users list shows status Ativo/Pendente; mobile cards.

## QR Code (Suflex, flexible) — lib/qr.py, routers/stock.py
- Camera (qr-scanner, iOS/Android/desktop) or text field (USB/Bluetooth scanner/paste). POST /api/qr/resolve parses JSON / URL params / key:value / free text (produto, peso g→kg, lote, validade) and suggests catalog items. Unknown label → user confirms once → POST /api/qr/labels memorises label code (sha1 of raw) + product alias. Known labels auto-sum in counts.
- Contagem por QR (/contagem-qr): POST /api/counts entries per month; POST /api/counts/{month}/apply upserts summed qty into that month's inventory (other items untouched), logs an upload record. Entries soft-deleted.
## Requisições de retirada (/requisicoes)
- Sectors: Bar, Salão, Boqueta, Cozinha, Produção, Garde, Café. Gerente/Chefe → direct "entregue". Alimentador → direct only inside time windows (settings _id retirada_windows, set by Gerente/Chefe; days 0=Seg..6=Dom, sectors empty=all), otherwise "pendente" until Gerente/Chefe approves/rejects. Valued at unit cost; GET /api/withdrawals-summary per sector for the month.
## Platform: responsive PWA (manifest.webmanifest) — installable on iOS/Android home screen, works on desktop browsers.

## v3 (planilha "Ai do app.xlsx") — permissões, requisições, auditoria
- Permission matrix (backend-enforced): Gerente = everything. Alimentador = Painel (alerts/qty only), Sugestão (NO costs), Contagem QR, Requisições (own + sector Estoque; marks comprada/recebida), Carregar Dados. Chefe = has `sector` (Cozinha|Bar|Salão|Quiosque, set by Gerente on approve/invite); sees only own-sector items/requisitions; sees costs/stock value only if sector in Cozinha/Bar/Quiosque (Salão never). CMV & Estoque, ABC, Simulador, IA, Admin = Gerente only (/api/dashboard, /suppliers, /insights, /ai/models → 403 otherwise). Value-free /api/overview for everyone.
- Item→sector mapping lib/sectors.item_sector(ggrupo,grupo,sgrupo): BEBIDAS→Bar, DESCARTAVEIS/UTENSILIOS→Salão, sgrupo CAFE/CHA/DOCE/SNACK→Quiosque, ALIMENTOS→Cozinha, else Estoque. "Café" renamed "Quiosque".
- Requisitions (db.requisitions, routers/requisitions.py): rascunho→enviada→aprovada|rejeitada|devolvida→comprada→recebida; priority normal|urgente; only Gerente approves/rejects/devolve (comment required for rejeitar/devolver/excluir); Gerente can excluir (soft). Alimentador inside time window → auto aprovada. Duplicate same item+sector open today → 409 (UI confirm → force). Notifications GET /api/notifications (gerente: enviadas; requester: status changes) + badge + toast; POST /notifications/seen. Print (HTML window.print) + CSV export. Sugestão "Gerar requisição dos zerados" → draft with ZERADO + BAIXOU FORTE.
- QR: same qr_code twice in the same month's count → 409 "Esta etiqueta já foi contada nesta sessão".
- Audit log db.audit (uploads, undo, manual entries, roles, invites, settings, windows, counts apply, requisition actions) → GET /api/audit (Admin). Backup GET /api/backup → xlsx in "Planilha completa" layout (re-importable) + Requisições sheet.
- Idle logout after 30 min (frontend, localStorage last-activity, checked on resume).
- NOT done (deviations): CMV % per sector (purchases have no item detail yet), saved favourite filters, supplier/price-variation filters, iFood tab, Suflex real label format (awaiting photo).
