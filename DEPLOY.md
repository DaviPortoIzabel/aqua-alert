# Publicação do Aqua Alert sem custo fixo

## 1. Publicar a API

API já publicada em:

`https://aqua-alert-api.davipizabel.workers.dev`

Crie duas chaves diferentes com pelo menos 32 caracteres:

- `DEVICE_KEY`: use somente no Arduino, no cabeçalho `X-Device-Key`.
- `DASHBOARD_KEY`: informe manualmente na primeira abertura de `dashboard.html`.

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

Salve. O GitHub mostrará a URL pública do site. Abra `/dashboard.html`, informe a URL do Worker, `aqua-001` e a `DASHBOARD_KEY` para usar o painel.

> Não coloque nenhuma chave em `docs/`, no repositório GitHub ou no JavaScript. O painel guarda a chave apenas no navegador que a digitou.
