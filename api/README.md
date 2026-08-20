# API do Aqua Alert

API serverless para Cloudflare Workers com banco Cloudflare D1. Ela é independente do Flask: `app.py` permanece intacto.

## Rotas

| Método | Rota | Acesso | Finalidade |
|---|---|---|---|
| GET | `/health` | público | confirma se a API está online |
| POST | `/api/leituras` | `X-Device-Key` | grava leitura do ESP8266 |
| POST | `/api/auth/register` | público | cria conta e ESP exclusivo |
| POST | `/api/auth/login` | público | inicia a sessão do usuário |
| GET | `/api/consumo/hoje` | sessão do usuário | total do dia |
| GET | `/api/consumo/diario` | Bearer token | gráfico hora a hora |
| GET | `/api/consumo/semanal` | Bearer token | gráfico dos últimos 7 dias |
| GET | `/api/historico` | Bearer token | totais diários |

Todas as rotas de consulta aceitam `?device_id=aqua-001`.

## Mensagem do sensor

O firmware atual pode continuar enviando fluxo a cada 5 segundos:

```json
{"device_id":"aqua-001","fluxo":2.4,"intervalo_segundos":5}
```

A API converte isso em litros consumidos. No firmware novo, prefira enviar o valor já acumulado:

```json
{"device_id":"aqua-001","litros":0.2,"medido_em":"2026-08-17T15:30:00Z"}
```

## Publicação (executar quando a conta Cloudflare estiver pronta)

```powershell
cd api
npx wrangler login
npx wrangler d1 create aqua-alert
# Cole o database_id retornado em wrangler.toml
npx wrangler d1 execute aqua-alert --remote --file=schema.sql
npx wrangler secret put AUTH_SECRET
npx wrangler deploy
```

`AUTH_SECRET` é uma chave longa usada para assinar as sessões e nunca deve ir para o GitHub. Cada conta recebe um código e uma chave próprios para o ESP no momento do cadastro.
