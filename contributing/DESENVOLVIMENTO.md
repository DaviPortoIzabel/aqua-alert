# Desenvolvimento local

[Voltar ao README](../README.md) · [Como contribuir](../CONTRIBUTING.md)

## Rodar com Python e Flask (recomendado)

Pré-requisito: Python 3.10 ou superior. Siga os comandos de instalação do [README](../README.md). Você também pode baixar **Code → Download ZIP**, extrair os arquivos e abrir um terminal na pasta do projeto; o Git só é necessário para contribuir por PR.

```sh
python -m venv .venv
# Ative: .venv\Scripts\Activate.ps1 (PowerShell) ou source .venv/bin/activate (Linux/macOS)
python -m pip install -r requirements.txt
python app.py
```

Se o PowerShell bloquear a ativação, use diretamente `.venv\Scripts\python.exe -m pip install -r requirements.txt` e `.venv\Scripts\python.exe app.py`. Não é necessário mudar a política do Windows.

Abra **http://127.0.0.1:5000**. O Flask serve as mesmas páginas do Pages e injeta uma configuração para que o navegador consulte a API Python no próprio servidor. Não edite `BASE` para esse modo. Cadastro, login, perfil, fotos, temas, senha, Meu ESP e consumo por período usam o SQLite local.

### Dados e configuração

- `instance/aqua-alert.sqlite3`: contas, dispositivos, preferências e leituras locais.
- `instance/auth-secret`: segredo aleatório criado na primeira execução. Preserve-o junto com o banco; removê-lo invalida sessões e impede recuperar chaves cifradas com ele.
- `AUTH_SECRET`: variável de ambiente opcional para definir um segredo próprio (mínimo de 32 caracteres). Use sempre o mesmo valor entre execuções.
- `AQUA_DATABASE`: caminho opcional para outro arquivo SQLite. Preserve também o segredo correspondente.

Esses arquivos privados não devem ser enviados ao GitHub. Faça o backup do banco com o aplicativo parado e guarde banco e segredo juntos em local privado. As contas do site publicado não são importadas automaticamente; crie uma conta local.

O schema é inicializado automaticamente a partir de `api/schema.sql`. Atualizações futuras de estrutura em bancos existentes exigem avaliar as migrations; o schema inicial não altera colunas de tabelas já criadas.

### Recuperação de senha por e-mail

Configure `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` e, opcionalmente, `BREVO_SENDER_NAME` no ambiente do terminal antes de iniciar o Flask. O remetente precisa estar autorizado no Brevo. O Flask lê variáveis do processo; não carrega `api/.dev.vars` ou `.env` automaticamente. Não coloque os valores no código.

Sem essa configuração, cadastro e login funcionam, mas a solicitação de recuperação de uma conta existente retorna uma mensagem de indisponibilidade. Os códigos não são impressos no terminal. Os testes de recuperação simulam o envio, sem mandar e-mails reais.

### Conectar um ESP ao Flask

O identificador e a chave são os da **conta local**, disponíveis na área Meu ESP. O endpoint é `POST /api/leituras`, com os mesmos cabeçalhos e formato da [API](../api/README.md).

Por padrão, o Flask escuta apenas `127.0.0.1`. Para um ESP na sua rede local conseguir acessá-lo, inicie explicitamente:

```sh
python -m flask --app app run --host 0.0.0.0 --port 5000
```

No ESP, use `http://IP-DO-SEU-COMPUTADOR:5000/api/leituras` e permita a porta na rede privada do firewall, se necessário. Use somente uma rede de desenvolvimento sob seu controle; esse comando não configura HTTPS. Para acesso externo, use hospedagem com HTTPS e servidor WSGI apropriado. Não encaminhe diretamente a porta desse servidor de desenvolvimento para a internet.

### Testes da versão Flask

Sem iniciar um servidor, execute:

```sh
python -m unittest discover -s tests -v
```

Os testes criam bancos temporários, verificam páginas, persistência após reinício, recuperação de senha, validação de leituras e sessões inválidas. Não usam os seus dados nem serviços externos.

Para verificar também o contrato compartilhado com o Worker, com `python app.py` ativo, use Node.js 22 ou superior em outro terminal:

```sh
# Linux/macOS
API_TEST_BASE=http://127.0.0.1:5000 node --test api/tests/*.test.mjs
```

No PowerShell, defina `$env:API_TEST_BASE = "http://127.0.0.1:5000"` e execute `node --test api/tests/*.test.mjs`. As suítes criam contas e leituras descartáveis no banco local. Node.js é opcional para usar o Flask.

## Opção avançada: desenvolver a API Cloudflare

Este fluxo é para quem vai alterar o Worker publicado. Para baixar e usar o sistema, prefira o Flask descrito acima.

### 1. Preparar a API

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

### 2. Conectar o site à API local

Em `docs/account.js`, substitua temporariamente a declaração inteira de `BASE` (incluindo a seleção da meta) por:

```js
const BASE = 'http://127.0.0.1:8787';
```

Essa alteração é só para o seu computador. Antes de enviar o PR, restaure a URL publicada, a menos que a proposta seja justamente mudar a configuração da API.

Na raiz do repositório:

```sh
python3 -m http.server 8080 --directory docs --bind 127.0.0.1
```

Abra `http://127.0.0.1:8080/auth.html`. Use contas descartáveis. No DevTools, confirme que as requisições vão para `127.0.0.1:8787`.

### 3. Executar as verificações

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

## Problemas comuns do Worker

- **Connection refused nos testes:** inicie o Worker na porta 8787 e confira `/health`.
- **No such table/column:** confira se o comando de schema/migration usou `--local` e foi executado em `api/`, no mesmo estado local do Worker.
- **Painel consulta produção:** revise `BASE` em `docs/account.js` e recarregue a página.
- **401 após trocar a senha:** sessões anteriores são invalidadas; entre novamente.
- **E-mail não chega:** confira as variáveis Brevo e a autorização do remetente. Nunca cole seus valores em issues ou PRs.
