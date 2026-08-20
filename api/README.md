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
