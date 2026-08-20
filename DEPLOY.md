# Publicação do Aqua Alert sem custo fixo

## 1. Publicar a API

API já publicada em:

`https://aqua-alert-api.davipizabel.workers.dev`

Crie duas chaves diferentes com pelo menos 32 caracteres:

- `AUTH_SECRET`: usado pela API para assinar as sessões dos usuários.

## 2. Enviar os arquivos ao GitHub

```powershell
git add api docs DEPLOY.md
git commit -m "Add static dashboard and Cloudflare API"
git push origin main
```

## 3. Ativar o GitHub Pages

No repositório `DaviPortoIzabel/aqua-alert`, abra **Settings → Pages** e escolha:

- Source: **Deploy from a branch**
- Branch: **main**
- Folder: **/docs**

Salve. O GitHub mostrará a URL pública do site. Cada visitante deve criar a própria conta em `/auth.html`; o painel mostrará somente os dados vinculados ao ESP daquela conta.

> Não coloque nenhuma chave em `docs/`, no repositório GitHub ou no JavaScript. A chave individual do ESP é exibida só para o dono da conta quando ela é criada ou renovada.
