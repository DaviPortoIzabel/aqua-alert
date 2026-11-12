# Publicação do Aqua Alert

O site usa GitHub Pages; a API usa Cloudflare Workers e D1. Para desenvolver sem publicar, veja o [guia local](contributing/DESENVOLVIMENTO.md).

## 1. Preparar e publicar a API

A API configurada no site é `https://aqua-alert-api.davipizabel.workers.dev`. Para uma instalação própria, configure seu banco D1 e os segredos seguindo o [README da API](api/README.md), e ajuste `BASE` em `docs/account.js` para a URL do seu Worker.

Em banco novo, use `api/schema.sql`. Em instalação existente, confira o estado do banco e aplique somente as migrations pendentes, lendo as instruções da API antes de executá-las. Não reaplique `0001_accounts.sql` indiscriminadamente. Quando houver alteração de schema, aplique-a antes de publicar o código que depende dela.

Os segredos são `AUTH_SECRET`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` e `BREVO_SENDER_NAME`. Preserve `AUTH_SECRET`: ele assina sessões e deriva a chave de cifragem dos segredos dos dispositivos. Não inclua valores no GitHub.

Depois de preparar banco e segredos, na pasta `api`:

```sh
npx wrangler@4.157.0 deploy
```

Confira `/health` no Worker publicado. Publique a API antes do painel quando o frontend depender de novos endpoints.

## 2. Revisar a mudança por pull request

Siga o [guia de contribuição](CONTRIBUTING.md): envie uma branch e abra um PR para `main`, descrevendo validação, migrations e ordem de publicação. O merge deve acontecer após revisão.

## 3. Configurar o GitHub Pages

No repositório, abra **Settings → Pages**:

- Source: **Deploy from a branch**.
- Branch: **main**.
- Folder: **/docs**.

O GitHub mostrará a URL do site. Com essa configuração, alterações em `docs/` integradas à `main` são publicadas pelo Pages. Cada visitante cria sua conta em `auth.html` e acompanha o ESP vinculado a ela.

Confira cadastro, login e painel após a publicação. Para validar leituras reais, use um dispositivo de teste sob seu controle. Nunca inclua chaves em exemplos públicos ou capturas. Na área Meu ESP, a chave exige confirmação de senha e fica disponível por tempo limitado.
