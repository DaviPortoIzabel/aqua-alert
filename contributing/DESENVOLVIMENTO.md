# Desenvolvimento local

[Voltar ao README](../README.md) · [Como contribuir](../CONTRIBUTING.md)

## 1. Preparar a API

Use Node.js 22 ou superior, npm e Python 3. Os comandos abaixo partem da raiz do repositório; não é necessário entrar na conta Cloudflare para usar o D1 local.

Crie `api/.dev.vars` (ignorado pelo Git) com uma chave exclusiva para desenvolvimento:

```dotenv
AUTH_SECRET="substitua-por-uma-chave-local-aleatoria-de-pelo-menos-32-caracteres"
```

Inicialize um banco **local novo** com o schema consolidado:

```sh
cd api
npx wrangler@4.157.0 d1 execute aqua-alert --local --file=schema.sql
npx wrangler@4.157.0 dev --local --ip 127.0.0.1 --port 8787
```

Mantenha esse terminal aberto. Em outro terminal, confirme:

```sh
curl http://127.0.0.1:8787/health
```

Resultado esperado: `{"ok":true}`. O estado local fica em `api/.wrangler/`. Se houver tabelas antigas, consulte as migrations e aplique apenas as necessárias; `CREATE TABLE IF NOT EXISTS` não atualiza colunas de tabelas existentes.

Para testar envio real de recuperação de senha, a API também precisa de `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` e `BREVO_SENDER_NAME` em `api/.dev.vars`, com remetente autorizado no Brevo. Não é necessário configurar e-mail para os testes de integração existentes.

## 2. Conectar o site à API local

Em `docs/account.js`, troque temporariamente o valor de `BASE` por:

```js
const BASE = 'http://127.0.0.1:8787';
```

Essa alteração é só para o seu computador. Antes de enviar o PR, restaure a URL publicada, a menos que a proposta seja justamente mudar a configuração da API.

Na raiz do repositório:

```sh
python3 -m http.server 8080 --directory docs --bind 127.0.0.1
```

Abra `http://127.0.0.1:8080/auth.html`. Use contas descartáveis. No DevTools, confirme que as requisições vão para `127.0.0.1:8787`.

## 3. Executar as verificações

Com o Worker local ativo e o schema inicializado, execute na raiz:

```sh
node --test api/tests/*.test.mjs
node --input-type=module --check < api/src/index.js
git diff --check
```

Os testes fazem requisições HTTP e criam dados no banco local; não são testes isolados de funções. `API_TEST_BASE` permite outra porta local. As suítes rejeitam destinos diferentes de `localhost` e `127.0.0.1`.

| Suíte | O que verifica |
|---|---|
| `account.test.mjs` | Perfil, foto, tema, isolamento e revogação de sessões |
| `range.test.mjs` | Datas inclusivas, horário de São Paulo, agregações e filtros inválidos |
| `device-access.test.mjs` | Confirmação de senha, autorização temporária e rotação de chave |
| `short-code.test.mjs` | Códigos de cinco dígitos, identificador do ESP e bloqueio de tentativas |

Para alterações visuais, confira também navegação por teclado, telas pequenas, estados de carregamento/erro e os três temas. Registre no PR o que foi verificado.

## Problemas comuns

- **Connection refused nos testes:** inicie o Worker na porta 8787 e confira `/health`.
- **No such table/column:** confira se o comando de schema/migration usou `--local` e foi executado em `api/`, no mesmo estado local do Worker.
- **Painel consulta produção:** revise `BASE` em `docs/account.js` e recarregue a página.
- **401 após trocar a senha:** sessões anteriores são invalidadas; entre novamente.
- **E-mail não chega:** confira as variáveis Brevo e a autorização do remetente. Nunca cole seus valores em issues ou PRs.

## Implementação Flask anterior

`app.py`, `templates/` e `static/` dependem de Flask, `mysql-connector-python` e MySQL (`agua_db`). O repositório não fornece um schema MySQL completo nem um arquivo de dependências fixadas. O schema de `api/schema.sql` é para D1 e não substitui esse banco. Para contribuir no sistema publicado, use o fluxo Workers acima.
