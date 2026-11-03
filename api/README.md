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

## Visualização horária e acesso protegido ao ESP

`/api/consumo/periodo` também aceita `granularity=auto|hour|day|month` e devolve
`series.granularity` e `series.points`. Automático usa horas para 1 ou 2 dias,
dias para 3 a 92 dias e meses acima disso. A opção horária manual aceita até
31 dias. Horas sem leitura continuam ausentes, sem inventar consumo zero.

Antes de publicar esta versão, aplique uma vez (a migration é idempotente):

```sh
cd api
wrangler d1 execute aqua-alert --remote --file=migrations/0004_device_access.sql
wrangler deploy
```

`POST /api/dispositivos/acesso`, com sessão e `{ "password": "..." }`, verifica
a senha e libera a chave e uma autorização de acesso por 3 minutos. A autorização
é limitada ao usuário, dispositivo e versão da senha. Não pode ser usada como
sessão de login. A rotação em `POST /api/dispositivos/chave` agora exige esse token
no cabeçalho `X-Device-Access`. Após 5 tentativas incorretas, a confirmação fica
bloqueada por até 10 minutos; a sessão normal continua válida.

Chaves novas e renovadas são armazenadas com AES-GCM e IV aleatório, usando HKDF
para derivar uma chave de armazenamento a partir de `AUTH_SECRET`. Usuário e
identificador do dispositivo são autenticados como dados associados. O hash da
chave continua sendo usado para autenticar o sensor. Preserve `AUTH_SECRET` nas
publicações: substituí-lo impede recuperar chaves cifradas com o valor antigo
(e invalida as sessões). Nesse caso, as chaves devem ser renovadas.

Chaves anteriores a essa migration só possuem hash e não podem ser recuperadas;
o usuário precisa gerar uma nova uma vez e atualizar o ESP. As leituras e os
vínculos existentes são preservados. A chave não fica no localStorage: no
navegador, ela é apagada ao bloquear a seção, sair da página ou expirar o acesso.

## Chaves de cinco números

Chaves recém-criadas ou renovadas têm exatamente cinco dígitos. Preserve os zeros
iniciais: a chave é uma **string**, não um número. Para autenticar o sensor, envie
**identificador e chave** juntos:

```http
POST /api/leituras
Content-Type: application/json
X-Device-Id: ESP-SEU-ID
X-Device-Key: 01234

{"litros":0.2}
```

O identificador também pode ser enviado no JSON como `device_id`, mantendo a
chave no cabeçalho `X-Device-Key`. No firmware com HTTPClient, acrescente:

```cpp
http.addHeader("X-Device-Id", DEVICE_ID);
http.addHeader("X-Device-Key", DEVICE_KEY); // string: mantém zeros iniciais
```

Use a conexão HTTPS com validação de certificado já configurada no firmware.
Os valores do exemplo são ilustrativos; copie os seus dados pela área Meu ESP.
Chaves longas existentes continuam funcionando sem esse cabeçalho adicional até
que o proprietário escolha renová-las. Nenhuma chave existente é trocada no deploy.

Chaves curtas são verificadas por HMAC com o identificador e `AUTH_SECRET`. Cada
tentativa é reservada de forma atômica no D1; após cinco erros o sensor fica
bloqueado por até dez minutos. Renovar pela conta, após confirmar a senha, também
remove esse bloqueio. O armazenamento recuperável continua criptografado.

Antes de publicar esta versão:

```sh
cd api
wrangler d1 execute aqua-alert --remote --file=migrations/0005_short_device_codes.sql
wrangler deploy
```

Essa migration apenas adiciona o controle de tentativas dos sensores. Ela não
altera chaves, dispositivos ou leituras existentes.
