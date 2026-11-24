# CLAUDE.md

VoltFrame: serviço comunitário de fotos de postos e tomadas de carregamento em Portugal. Guarda as fotos e serve links estáticos pelo ID oficial (`OPC-XXXXXXXXXX` para postos, `PTOPCEYYYYYYYYY` para tomadas), para qualquer app ou mapa (OSM, NAP dashboard).

Estado: fase de design. Existem mockups, o plano técnico e a configuração do servidor Panoramax no Zerops (ainda por fazer deploy).

## Onde está o quê

- `Docs/plan.md`: design técnico (arquitetura, fontes de dados, fases). É a fonte de verdade.
- `LICENSE` (MIT, código) e `Docs/licenca.md`: resumo das licenças do código e das fotos; a marca e a mascote não estão licenciadas.
- `Design/*.dc.html`: mockups das páginas (Main, Galeria, Enviar, Admin) e `canvas.json`.
- `Docs/infra.md`: infraestrutura do servidor Panoramax no Zerops (serviços, segredos, R2, DNS, deploy, ensaio). Atualizar sempre que a infra mudar.
- `zerops.yml`, `zerops-import.yaml`, `panoramax/`: configuração do serviço `pano` (Panoramax) e do `db`.
- `Design/marca/`: mascote Pic (versão âmbar) em SVG e PNG, favicon, ícones de app e `site.webmanifest`; cores e `<head>` no `LEIA-ME.md`.
- `Design/Fluxo-panoramax.html` e `Design/Ecras-panoramax.html`: fluxo VoltFrame ↔ Panoramax e ecrãs do plano revisto (envio, moderação, posto, Panoramax, ranking).

## Stack prevista

- Servidor Panoramax próprio (só postos), no Zerops (Python 3.14 em Ubuntu, PostgreSQL 18 gerido), com armazenamento no R2: guarda as fotos. Sem logins; o VoltFrame envia com a conta de serviço `pictures`, que não é admin.
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
- `.github/dependabot.yml` cobre GitHub Actions e o pip de `panoramax/` (lock `requirements.txt` gerado do `requirements.in` com o `uv`); acrescentar outros ecossistemas (npm) quando houver lockfile.
