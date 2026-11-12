# Aqua Alert 💧

Sistema de monitoramento de consumo de água com sensor conectado ao ESP8266, painel web e histórico por período. Cada conta acompanha as leituras do seu próprio dispositivo.

**[Abrir o site](https://daviportoizabel.github.io/aqua-alert/)** · **[Como contribuir](CONTRIBUTING.md)** · **[Entender o código](contributing/ARQUITETURA.md)** · **[Documentação da API](api/README.md)**

## O que o sistema oferece

- Cadastro, login e recuperação de senha por e-mail.
- Consumo por hora, dia ou mês, filtros de datas e exportação CSV no painel.
- Perfil com foto e temas claro, escuro ou conforme o sistema.
- Identificador e chave individual do ESP, com confirmação de senha para acessar ou renovar a chave.

## Por onde começar

| Quero… | Consulte |
|---|---|
| Rodar o projeto no computador | [Desenvolvimento local](contributing/DESENVOLVIMENTO.md) |
| Entender as pastas e o caminho de uma leitura | [Arquitetura e mapa do código](contributing/ARQUITETURA.md) |
| Corrigir um problema ou propor melhoria | [Guia de contribuição e pull requests](CONTRIBUTING.md) |
| Integrar um sensor ou consultar endpoints | [API e formato das mensagens](api/README.md) |
| Publicar uma versão | [Guia de publicação](DEPLOY.md) |

## Estrutura do repositório

```text
api/            API Cloudflare Workers, schema D1, migrations e testes
  src/index.js  Rotas, autenticação e processamento das leituras
docs/           Site estático publicado pelo GitHub Pages
contributing/   Guias para desenvolvedores (não fazem parte do site)
.github/        Modelos de issues e pull requests
app.py          Implementação Flask/MySQL anterior
templates/      Páginas da implementação Flask
static/         Estilos e scripts da implementação Flask
codigo*.txt     Referências de firmware Arduino/ESP8266
```

A aplicação publicada usa **`docs/` + `api/`**. O Flask é uma implementação separada, com banco e rotas próprios; ele não é necessário para desenvolver o painel atual. A pasta `docs/` contém o site servido ao público: a documentação técnica fica em `contributing/`.

## Desenvolvimento rápido

Pré-requisitos: Git, Python 3 para servir arquivos estáticos e Node.js 22 ou superior com npm para a API e os testes.

```sh
git clone https://github.com/DaviPortoIzabel/aqua-alert.git
cd aqua-alert
python3 -m http.server 8080 --directory docs --bind 127.0.0.1
```

Abra `http://127.0.0.1:8080`. **Por padrão, o site aponta para a API publicada.** Antes de cadastrar contas ou enviar dados em desenvolvimento, siga o [guia local](contributing/DESENVOLVIMENTO.md) para conectar o site à sua API e ao banco local.

## Contribuições

Você pode ajudar com documentação, acessibilidade, interface, testes, API ou integração do sensor. O [CONTRIBUTING.md](CONTRIBUTING.md) explica como escolher uma tarefa, criar uma branch, validar a mudança e abrir seu primeiro pull request.
