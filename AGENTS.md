# AGENTS.md

olh'o'posto: serviço comunitário de fotos de postos e tomadas de carregamento em Portugal. Guarda as fotos e serve links estáticos pelo ID oficial (`OPC-XXXXXXXXXX` para postos, `PTOPCEYYYYYYYYY` para tomadas), para qualquer app ou mapa (OSM, NAP dashboard).

O que já funciona está em `Docs/arquitetura.md` (o estado das fases no início); o que falta, em `Docs/plan.md`; o que está publicado na Cloudflare, no `Docs/cloudflare.md`, secção 1. Cada push para `main` que mexa em `worker/` publica o Worker pelo Workers Builds (`npm run deploy`, que aplica as migrações primeiro); cada push para `main` faz deploy do Panoramax pelo webhook do Zerops.

## Onde está o quê

- `Docs/arquitetura.md`: o que já está a funcionar (objetivos, princípios, domínios, porquê o Panoramax, postos e tomadas, tabelas da D1, site e API, links estáticos).
- `Docs/plan.md`: só o que falta construir, com o design dessas partes (fases, envio, moderação, login, API, MCP, OSM). Quando uma parte fica feita, sai do plano e vai para a `arquitetura.md`, o `cloudflare.md` ou o `infra.md`.
- `LICENSE` (MIT, código) e `Docs/licenca.md`: resumo das licenças do código e das fotos; a marca e a mascote não estão licenciadas.
- `Design/*.dc.html`: mockups das páginas (Main, Galeria, Enviar, Admin) e `canvas.json`.
- `Docs/infra.md`: infraestrutura do servidor Panoramax no Zerops (serviços, segredos, R2, DNS, deploy, ensaio). Atualizar sempre que a infra mudar.
- `Docs/cloudflare.md`: recursos Cloudflare do olh'o'posto (buckets `pictures` e `pictures-staging`, Cache Rule, CORS, Worker e as suas rotas, login, página de envio, D1, custos medidos e o import dos postos). Atualizar sempre que mudarem.
- `worker/`: Worker `olhaoposto` (TypeScript, D1): API, páginas em HTML em pt-PT e inglês (`src/pages.ts`; privacidade em `src/privacy.ts`; login e sessões em `src/auth.ts`; página de envio em `src/upload.ts`; envio em `src/photos.ts`; fila de moderação em `src/moderation.ts`, motivos de recusa em `src/reasons.ts`, histórico de decisões em `src/decisions.ts`, «os meus envios» em `src/uploads.ts`; fotos principais em `src/publish.ts`; página de crédito de cada foto em `src/photopage.ts`; alvos sem principal em `src/mains.ts`; papéis em `src/admin.ts`; página do grupo em `src/grupo.ts`; conta, pontos e *tokens* em `src/account.ts`, `src/points.ts` e `src/tokens.ts`; crédito e pseudónimo em `src/credit.ts`; postos em construção em `src/merge.ts` (fusão, partilhada com o import) e `src/construction.ts` (o que a fusão deixa para o *cron*); servidor MCP em `src/mcp.ts` (ferramentas), `src/oauth.ts` (transporte e OAuth, só no Worker) e `src/mcpauth.ts` (consentimento e âmbitos); formas JSON partilhadas pela API e pelo MCP em `src/bodies.ts`; condições de utilização em `src/terms.ts`), ficheiros estáticos em `worker/public/` (CSS, fontes, ícones, `robots.txt`, `llms.txt`, o modelo de caras em `models/` e os *scripts*: `site.js`, `theme.js`, `install.js` («Instalar app», o mesmo nos sites do grupo; o markup é o `installMarkup` do `src/pages.ts`), `upload.js`, `heic.js`, `detect.js`, e `jpeg.js` e `heif.js`, os leitores de EXIF partilhados com os testes). As bibliotecas do browser (libheif, MediaPipe, Leaflet) são `devDependencies` copiadas para `public/vendor/` pelo `scripts/vendor.ts` no `npm run dev` e no deploy, nunca *commitadas*; `sitemap.xml`, migrações e o import dos postos (`scripts/import-stations.ts`, corrido pelo `.github/workflows/import-stations.yml`). Comandos remotos só com `npm run remote` (`Docs/cloudflare.md`, secção 4). Recursos da conta e da zona (R2, domínios, DNS, cache) com o `cf`; Worker, D1 e segredos com o wrangler pelos *scripts* do `npm`, nunca `cf dev`/`cf deploy`/`cf migrate` (porquê no início do `Docs/cloudflare.md`). A política de privacidade (e as condições de utilização, se mudarem as regras de envio ou dos *tokens*) muda no mesmo PR que mudar o que o Worker guarda ou pede.
- `zerops.yml`, `zerops-import.yaml`, `panoramax/`: configuração do serviço `pano` (Panoramax) e do `db`. Um push para `main` faz deploy pelo webhook do Zerops. `panoramax/map_override.py` põe as fotos no mapa a partir do zoom 7 (tiles, `style.json` e o nosso `/viewer` em `panoramax/templates/`, cujo botão «Report» abre o formulário de remoção); `panoramax/author_override.py` mostra como autor de cada foto o nome da etiqueta `OlhaOPosto|author`, e não a conta de serviço; os testes de drift em `panoramax/tests/` correm no job `panoramax` de cada PR (`Docs/infra.md`, «Mapa: fotos de uma só foto»).
- `Design/marca/`: mascote Pic (versão âmbar) em SVG e PNG, favicon, ícones de app e `site.webmanifest`; cores e `<head>` no `LEIA-ME.md`.
- `Design/Fluxo-panoramax.html` e `Design/Ecras-panoramax.html`: fluxo olh'o'posto ↔ Panoramax e ecrãs do plano revisto (envio, moderação, posto, Panoramax, ranking).

## Stack

- Servidor Panoramax próprio (só postos), no Zerops (Python 3.14 em Ubuntu, PostgreSQL 18 gerido), com armazenamento no R2: guarda as fotos. Sem logins nem OAuth; o olh'o'posto envia com a conta de serviço `OlhaOPosto`, que não é admin. Em produção.
- Cloudflare Worker (`olhaoposto.ocarroeletrico.com`) + D1: postos, pesquisa, login OSM, envio e API; mais tarde seleções, moderação, ranking e MCP.
- R2 `pictures` em `pictures.ocarroeletrico.com`, sem Worker: links estáticos.
- Import de hora a hora (GitHub Actions) lê o `ohmigo_chargers.json` do NAP dashboard.
- Marca "olh'o'posto" (lê-se "Olha o posto") só na apresentação; slug técnica `OlhaOPosto` onde as maiúsculas se veem (Panoramax, etiquetas, User-Agent, MCP) e `olhaoposto` onde têm de ser minúsculas (domínio, Worker, npm, `photos.origin`); detalhe em `Docs/arquitetura.md`. Ficam `pictures` só o R2 (`pictures`, `pictures-staging`) e a D1.

## Princípios (não negociar sem falar com o responsável do projeto)

- URL estável, conteúdo trocável: o link nunca muda, só a foto a que aponta.
- Dados oficiais (NAP/MOBI.E) como base; OSM como complemento.
- Privacidade por defeito: desfocar caras e matrículas e remover EXIF antes de publicar.
- Licença aberta obrigatória (CC BY-SA 4.0, com autorização ODbL).
- Postos que desaparecem do NAP passam a `missing_from_nap`, nunca são apagados.

## Convenções

- Docs e UI em pt-PT; código e commits em inglês.
- Commits com `-s` (DCO).
- `.github/dependabot.yml` cobre GitHub Actions, o pip de `panoramax/` (lock `requirements.txt` gerado do `requirements.in` com o `uv`; testes em `requirements-test.txt`), a versão do visualizador em `panoramax/viewer/` e o npm de `worker/`.
- Sem IPs, IDs de recursos (Zerops, Cloudflare) nem datas das alterações nos docs, commits e PRs.
