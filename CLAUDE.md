# CLAUDE.md

VoltFrame: serviço comunitário de fotos de postos e tomadas de carregamento em Portugal. Guarda as fotos e serve links estáticos pelo ID oficial (`OPC-XXXXXXXXXX` para postos, `PTOPCEYYYYYYYYY` para tomadas), para qualquer app ou mapa (OSM, NAP dashboard).

Estado: fase de design. Só existem mockups e o plano técnico, ainda sem código.

## Onde está o quê

- `Docs/plan.md`: design técnico (arquitetura, fontes de dados, fases). É a fonte de verdade.
- `Design/*.dc.html`: mockups das páginas (Main, Galeria, Enviar, Admin) e `canvas.json`.

## Stack prevista

Cloudflare Workers + R2 (fotos) + D1 (metadados) + Queues. ETL diário em GitHub Actions a partir do NAP, MOBI.Data e OSM.

## Princípios (não negociar sem falar com o Fernando)

- URL estável, conteúdo trocável: o link nunca muda, só a foto a que aponta.
- Dados oficiais (NAP/MOBI.E) como base; OSM como complemento.
- Privacidade por defeito: desfocar caras e matrículas e remover EXIF antes de publicar.
- Licença aberta obrigatória (CC BY-SA 4.0 ou CC0).
- Postos que desaparecem do NAP passam a `missing_from_nap`, nunca são apagados.

## Convenções

- Docs e UI em pt-PT; código e commits em inglês.
- Commits com `-s` (DCO).
- `.github/dependabot.yml` só cobre GitHub Actions; acrescentar o ecossistema (npm, pip) quando houver lockfile.
