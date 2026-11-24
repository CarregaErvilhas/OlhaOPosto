# CLAUDE.md

VoltFrame: serviço comunitário de fotos de postos e tomadas de carregamento em Portugal. Guarda as fotos e serve links estáticos pelo ID oficial (`OPC-XXXXXXXXXX` para postos, `PTOPCEYYYYYYYYY` para tomadas), para qualquer app ou mapa (OSM, NAP dashboard).

Estado: fase 1 quase feita. O servidor Panoramax está em produção em `panoramax.ocarroeletrico.com` (Zerops, atrás da Cloudflare, fora da federação), com o ensaio feito (faltam o custo e a conversa com a comunidade). Fase 2 a meio: o Worker em `worker/` tem as páginas dos postos (pt-PT e inglês), a pesquisa por texto e por proximidade, a API só de leitura, o `sitemap.xml`, o `llms.txt`, a política de privacidade, o seletor de tema e o import diário dos postos (GitHub Actions para a D1). O login OSM e a página de envio estão feitos mas desligados até haver os segredos do OSM; a página de envio prepara a foto no browser e ainda não envia. O que está ou não publicado está no `Docs/cloudflare.md`, secção 1.

## Onde está o quê

- `Docs/arquitetura.md`: o que já está a funcionar (objetivos, princípios, domínios, porquê o Panoramax, postos e tomadas, tabelas da D1, site e API, links estáticos).
- `Docs/plan.md`: só o que falta construir, com o design dessas partes (fases, envio, moderação, login, API, MCP, OSM). Quando uma parte fica feita, sai do plano e vai para a `arquitetura.md`, o `cloudflare.md` ou o `infra.md`.
- `LICENSE` (MIT, código) e `Docs/licenca.md`: resumo das licenças do código e das fotos; a marca e a mascote não estão licenciadas.
- `Design/*.dc.html`: mockups das páginas (Main, Galeria, Enviar, Admin) e `canvas.json`.
- `Docs/infra.md`: infraestrutura do servidor Panoramax no Zerops (serviços, segredos, R2, DNS, deploy, ensaio). Atualizar sempre que a infra mudar.
- `Docs/cloudflare.md`: recursos Cloudflare do VoltFrame (buckets `pictures` e `pictures-staging`, Cache Rule, CORS, Worker e as suas rotas, login, página de envio, D1, custos medidos e o import dos postos). Atualizar sempre que mudarem.
- `worker/`: Worker `pictures` (TypeScript, D1): API, páginas em HTML em pt-PT e inglês (`src/pages.ts`; privacidade em `src/privacy.ts`; login e sessões em `src/auth.ts`; envio em `src/upload.ts`), ficheiros estáticos em `worker/public/` (CSS, fontes, ícones, `robots.txt`, `llms.txt` e os *scripts*: `site.js`, `theme.js`, `upload.js` e `jpeg.js`, o leitor de EXIF partilhado com os testes), `sitemap.xml`, migrações e o import dos postos (`scripts/import-stations.ts`, corrido pelo `.github/workflows/import-stations.yml`). Comandos remotos só com `npm run remote` (`Docs/cloudflare.md`, secção 4). A política de privacidade muda no mesmo PR que mudar o que o Worker guarda ou pede.
- `zerops.yml`, `zerops-import.yaml`, `panoramax/`: configuração do serviço `pano` (Panoramax) e do `db`. Um push para `main` faz deploy pelo webhook do Zerops.
- `Design/marca/`: mascote Pic (versão âmbar) em SVG e PNG, favicon, ícones de app e `site.webmanifest`; cores e `<head>` no `LEIA-ME.md`.
- `Design/Fluxo-panoramax.html` e `Design/Ecras-panoramax.html`: fluxo VoltFrame ↔ Panoramax e ecrãs do plano revisto (envio, moderação, posto, Panoramax, ranking).

## Stack

- Servidor Panoramax próprio (só postos), no Zerops (Python 3.14 em Ubuntu, PostgreSQL 18 gerido), com armazenamento no R2: guarda as fotos. Sem logins nem OAuth; o VoltFrame envia com a conta de serviço `pictures`, que não é admin. Em produção.
- Cloudflare Worker (`voltframe.ocarroeletrico.com`) + D1: postos, pesquisa, login OSM, envio e API; mais tarde seleções, moderação, ranking e MCP.
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
- `.github/dependabot.yml` cobre GitHub Actions, o pip de `panoramax/` (lock `requirements.txt` gerado do `requirements.in` com o `uv`) e o npm de `worker/`.
- Sem IPs, IDs de recursos (Zerops, Cloudflare) nem datas das alterações nos docs, commits e PRs.
