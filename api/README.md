# API do Aqua Alert

API serverless para Cloudflare Workers com banco Cloudflare D1. Ela é independente do Flask: `app.py` permanece intacto.

## Rotas

| Método | Rota | Acesso | Finalidade |
|---|---|---|---|
| GET | `/health` | público | confirma se a API está online |
| POST | `/api/leituras` | `X-Device-Key` | grava leitura do ESP8266 |
| POST | `/api/auth/register` | público | cria conta e ESP exclusivo |
| POST | `/api/auth/login` | público | inicia a sessão do usuário |
| POST | `/api/auth/forgot-password` | público | envia código de redefinição por e-mail |
| POST | `/api/auth/reset-password` | público | valida o código e troca a senha |
| GET | `/api/consumo/hoje` | sessão do usuário | total do dia |
| GET | `/api/consumo/diario` | Bearer token | gráfico hora a hora |
| GET | `/api/consumo/semanal` | Bearer token | gráfico dos últimos 7 dias |
| GET | `/api/historico` | Bearer token | totais diários |

Cada sessão enxerga somente o dispositivo da própria conta.

## Mensagem do sensor

O firmware atual pode continuar enviando fluxo a cada 5 segundos:

```json
{"fluxo":2.4,"intervalo_segundos":5}
```

A API converte isso em litros consumidos. No firmware novo, prefira enviar o valor já acumulado:

```json
{"litros":0.2,"medido_em":"2026-08-17T15:30:00Z"}
```

## Publicação (executar quando a conta Cloudflare estiver pronta)

```powershell
cd api
npx wrangler login
npx wrangler d1 create aqua-alert
# Cole o database_id retornado em wrangler.toml
npx wrangler d1 execute aqua-alert --remote --file=schema.sql
npx wrangler secret put AUTH_SECRET
npx wrangler secret put BREVO_API_KEY
npx wrangler secret put BREVO_SENDER_EMAIL
npx wrangler secret put BREVO_SENDER_NAME
npx wrangler deploy
```

`AUTH_SECRET` é uma chave longa usada para assinar as sessões e nunca deve ir para o GitHub. `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` e `BREVO_SENDER_NAME` ficam nos segredos da Cloudflare para o envio de e-mails. Cada conta recebe somente uma chave própria para o ESP no momento do cadastro; o firmware envia essa chave no cabeçalho `X-Device-Key`.

## Conta, foto e aparência

O menu da conta usa `GET /api/me`, `POST /api/account` e
`POST /api/account/password`. Foto e tema ficam no D1, vinculados ao usuário
identificado pela sessão. A foto é recortada ao centro e convertida pelo navegador
para JPEG de 192 × 192; a API aceita até 100 KB. Envie `avatar: null` para remover.
Os temas são `system`, `light` e `dark`.

A troca de senha exige `current_password` e `new_password` (8–128 caracteres).
Ela devolve um novo token e invalida os anteriores, inclusive os de outros
navegadores. Uma senha atual incorreta devolve 403 sem encerrar a sessão válida.
A recuperação por e-mail também invalida as sessões anteriores.

### Atualização de uma instalação existente

Na pasta `api`, com autenticação Cloudflare disponível, **aplique esta migration
antes de publicar o Worker**:

```sh
wrangler d1 execute aqua-alert --remote --file=migrations/0003_user_settings.sql
wrangler deploy
```

A migration é aditiva e idempotente; não altera usuários, senhas ou leituras
existentes. Não reaplique `0001_accounts.sql` sobre o schema atual. Em banco novo,
`schema.sql` já inclui a tabela de preferências.

Para desenvolvimento, substitua `--remote` por `--local`, inicie `wrangler dev
--local` e execute na raiz do repositório:

```sh
node --test api/tests/account.test.mjs
```

Os testes criam contas descartáveis apenas na API local (porta 8787 por padrão).
Cobrem persistência após novo login, isolamento entre usuários, remoção e validação
da foto, preferências concorrentes e revogação de sessões na troca de senha.

## Consumo por período

`GET /api/consumo/periodo?start=AAAA-MM-DD&end=AAAA-MM-DD` exige a sessão do
usuário e retorna apenas o seu dispositivo. Ambas as datas são inclusivas e usam
o horário de São Paulo. Datas inválidas, invertidas, futuras ou intervalos com
mais de 3.660 dias retornam HTTP 400.

A resposta contém `days` (totais diários, quantidade de leituras e última medição)
e `summary` (total, dias com leituras, média por dia com leitura e maior total
diário). Dias sem medições não são tratados como consumo zero. O novo dashboard
usa esse endpoint para gráfico, indicadores, histórico paginado e exportação CSV;
intervalos acima de 92 dias são agrupados por mês somente na visualização.

Não há migration adicional para este endpoint: ele usa o índice existente
`idx_readings_device_time`. Publique o Worker antes dos arquivos do dashboard.

Testes locais da API, incluindo os filtros de datas:

```sh
node --test api/tests/*.test.mjs
```
