# Como contribuir com o Aqua Alert

Obrigado por ajudar a melhorar o projeto! Correções de texto, melhorias de acessibilidade e explicações de código também são contribuições.

## Escolher uma mudança

Consulte as [issues](https://github.com/DaviPortoIzabel/aqua-alert/issues) e os [pull requests abertos](https://github.com/DaviPortoIzabel/aqua-alert/pulls) para evitar trabalho duplicado. Para uma mudança grande, abra uma issue explicando o problema e a proposta. Correções pequenas podem ir direto para um PR.

Antes de começar, leia o [mapa do código](contributing/ARQUITETURA.md) e configure o [ambiente local](contributing/DESENVOLVIMENTO.md). Bons primeiros passos incluem corrigir um link, esclarecer uma instrução ou melhorar foco e rótulos acessíveis de uma página.

## Criar sua branch

Se você não tem permissão de escrita, clique em **Fork** no GitHub e clone sua cópia:

```sh
git clone https://github.com/SEU-USUARIO/aqua-alert.git
cd aqua-alert
git remote add upstream https://github.com/DaviPortoIzabel/aqua-alert.git
git fetch upstream
git switch -c docs/explicar-configuracao upstream/main
```

Se você já trabalha no repositório original, atualize `main` com `git pull --ff-only` e crie sua branch a partir dela. Use um nome descritivo, por exemplo `fix/filtro-de-datas` ou `feat/exportacao`.

## Implementar e revisar

- Mantenha cada PR focado em um problema.
- Comente o motivo de uma regra ou decisão difícil de perceber; prefira nomes claros a comentários que apenas repetem cada linha.
- Ao alterar uma rota, atualize a documentação da API e os testes do comportamento afetado.
- Ao alterar o banco, inclua a migration e atualize `api/schema.sql`.
- Ao mudar a interface, confira teclado, celular, temas e mensagens de erro.
- Use dados locais descartáveis. Não inclua senhas, tokens, chaves do ESP ou dados pessoais em código, logs ou capturas.

Execute as verificações relevantes do [guia local](contributing/DESENVOLVIMENTO.md). Para documentação, confira os links, os caminhos e os comandos. Não declare um teste como aprovado se ele não foi executado.

Revise e envie apenas os arquivos da sua mudança:

```sh
git status
git diff
git diff --check
git add CAMINHO-DO-ARQUIVO
git commit -m "docs: explica a configuração local"
git push -u origin docs/explicar-configuracao
```

Substitua o caminho e o nome da branch pelos usados na sua contribuição.

## Abrir e acompanhar o pull request

1. No GitHub, clique em **Compare & pull request** (ou **Pull requests → New pull request**).
2. Confira o destino: `DaviPortoIzabel/aqua-alert`, branch `main`; selecione sua branch como origem.
3. Preencha o modelo: problema, mudança, como testar e possíveis impactos. Se resolver uma issue, inclua `Closes #NUMERO`.
4. Confira a aba **Files changed**. Remova arquivos gerados, segredos e alterações temporárias de `BASE`.
5. Use **Draft** enquanto estiver trabalhando; marque como pronto quando puder ser revisado.
6. Responda às sugestões e envie novos commits na mesma branch. Eles aparecem no mesmo PR.

O merge depende da revisão de quem mantém o projeto. Para incorporar atualizações da base sem reescrever os commits da contribuição:

```sh
git fetch upstream
git merge upstream/main
# Resolva eventuais conflitos, revise e execute novamente os testes afetados.
git push
```

Quem clonou o repositório original pode usar `origin` no lugar de `upstream`.
