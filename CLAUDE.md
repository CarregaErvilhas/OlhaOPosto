# CLAUDE.md

VoltFrame: serviço comunitário de fotos de postos e tomadas de carregamento em Portugal. Guarda as fotos e serve links estáticos pelo ID oficial (`OPC-XXXXXXXXXX` para postos, `PTOPCEYYYYYYYYY` para tomadas), para qualquer app ou mapa (OSM, NAP dashboard).

Estado: fase de design. Só existem mockups e o plano técnico, ainda sem código.

## Onde está o quê

- `Docs/plan.md`: design técnico (arquitetura, fontes de dados, fases). É a fonte de verdade.
- `Design/*.dc.html`: mockups das páginas (Main, Galeria, Enviar, Admin) e `canvas.json`.

## Stack prevista

- Servidor Panoramax próprio (só postos), no Zerops, com armazenamento no R2: guarda as fotos. Sem logins; o VoltFrame envia com uma conta de serviço.
- Cloudflare Worker (`voltframe.ocarroeletrico.com`) + D1: postos, seleções, moderação, ranking, API, MCP.
- R2 `pictures` em `pictures.ocarroeletrico.com`, sem Worker: links estáticos.
- Cron diário lê o `ohmigo_chargers.json` do NAP dashboard.
- Marca "pIcŧU/Re" só na apresentação; slug técnica `pictures`.

## Princípios (não negociar sem falar com o Fernando)

- URL estável, conteúdo trocável: o link nunca muda, só a foto a que aponta.
- Dados oficiais (NAP/MOBI.E) como base; OSM como complemento.
- Privacidade por defeito: desfocar caras e matrículas e remover EXIF antes de publicar.
- Licença aberta obrigatória (CC BY-SA 4.0, com autorização ODbL).
- Postos que desaparecem do NAP passam a `missing_from_nap`, nunca são apagados.

## Convenções

- Docs e UI em pt-PT; código e commits em inglês.
- Commits com `-s` (DCO).
- `.github/dependabot.yml` só cobre GitHub Actions; acrescentar o ecossistema (npm, pip) quando houver lockfile.
