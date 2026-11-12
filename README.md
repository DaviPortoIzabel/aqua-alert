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
app.py          Entrada da execução local em Python/Flask
local_app/      API Python, autenticação e banco SQLite local
templates/local/ Integração Flask com as páginas atuais de docs/
static/         Arquivos históricos da implementação anterior
requirements.txt Dependências Python para rodar no computador
tests/          Testes da execução Flask
codigo*.txt     Referências de firmware Arduino/ESP8266
```

O site publicado continua usando **GitHub Pages + Cloudflare Workers/D1**. Quem baixa o projeto pode usar **Flask + SQLite no próprio computador**, com a mesma interface e dados independentes. O Flask inclui os HTMLs de `docs/` por meio de `templates/local/page.html`, sem duplicar as páginas. Os templates antigos e `static/` ficam como referência histórica.

## Rodar no computador com Flask

Instale Python **3.10 ou superior**. Não é necessário MySQL, Node.js nem conta Cloudflare para executar a versão local.

```sh
git clone https://github.com/DaviPortoIzabel/aqua-alert.git
cd aqua-alert
python -m venv .venv
```

Ative o ambiente virtual:

```sh
# Windows (PowerShell)
.venv\Scripts\Activate.ps1

# Linux/macOS
source .venv/bin/activate
```

Depois:

```sh
python -m pip install -r requirements.txt
python app.py
```

Abra **http://127.0.0.1:5000** e crie uma conta local. Em Linux/macOS, use `python3` para criar o ambiente caso `python` não esteja disponível.

O SQLite e o segredo da aplicação são criados automaticamente em `instance/`, ignorado pelo Git. Cadastros e leituras locais não vão para o site publicado. Preserve essa pasta para manter seus dados e as chaves legíveis após reiniciar.

A recuperação de senha por e-mail requer configuração do Brevo. Veja [desenvolvimento local](contributing/DESENVOLVIMENTO.md) para configurar o envio, conectar um ESP, rodar testes ou desenvolver a API Cloudflare.

## Contribuições

Você pode ajudar com documentação, acessibilidade, interface, testes, API ou integração do sensor. O [CONTRIBUTING.md](CONTRIBUTING.md) explica como escolher uma tarefa, criar uma branch, validar a mudança e abrir seu primeiro pull request.
