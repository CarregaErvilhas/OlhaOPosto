# Arquitetura — o que está a funcionar

Este documento descreve o VoltFrame tal como existe hoje. O que ainda falta
construir, e o design dessas partes, está em [`plan.md`](plan.md). Os
detalhes de operação estão em [`infra.md`](infra.md) (servidor Panoramax no
Zerops) e em [`cloudflare.md`](cloudflare.md) (R2, Worker, D1 e o import dos
postos). As licenças estão em [`licenca.md`](licenca.md).

## Objetivo

Um servidor **Panoramax** próprio, só para postos de carregamento, guarda as
fotos. Um **Worker da Cloudflare** (VoltFrame) faz o resto: a lista de postos
do NAP, os links estáticos pelo ID oficial, a escolha da foto principal, o
envio, a moderação, o ranking, a API e o MCP. Exemplo de link:
`https://pictures.ocarroeletrico.com/TRK-VNT-00005.jpg`. Orçamento: **10 €/mês**
no total.

Requisitos (proposta de Alexandre Moleiro):

- Servidor que aloja as fotos e gera links estáticos.
- Upload obrigatoriamente associado a um posto (`OPC-XXXXXXXXXX`) ou a uma tomada (`PT-OPC-E-YYYYYYYYY`).
- O posto tem de existir; pesquisa por referência, morada ou coordenadas. Postos novos entram numa fila de revisão humana.
- Quando há várias fotos, escolher qual alimenta cada link estático.
- Links por posto (`/OPC-XXXXXXXXXX.jpg`) e por tomada (`/PTOPCEYYYYYYYYY.jpg`), usáveis por qualquer app ou mapa (OSM, NAP dashboard).

Princípios:

- **URL estável, conteúdo trocável**: o link nunca muda; muda apenas a foto que ele aponta.
- **Dados oficiais como base**: postos e EVSE vêm do NAP/Mobi.E; o OSM serve de complemento.
- **Privacidade por defeito**: desfocagem de caras e matrículas e remoção do EXIF antes de publicar.
- **Licença aberta obrigatória** (CC BY-SA 4.0, com autorização ODbL), para poder ser usada no OSM.
- **Saída fácil**: dados exportáveis, código aberto e fotos num servidor Panoramax federado, para a comunidade não depender de uma pessoa ou conta.

Responsável (RGPD): Fernando, na conta Cloudflare existente. Passar para uma
associação fica como saída futura.

## Nomes e domínios

- **Marca:** "pIcŧU/Re" (lê-se "picture"). Só apresentação: logótipo, títulos e `display_name` da app OAuth do OSM. Leitores de ecrã: `aria-label="picture"`. O site mostra os dois nomes, VoltFrame e pIcŧU/Re. Ficheiros e cores em `Design/marca/`.
- **Repositório:** VoltFrame.
- **Slug técnica:** `pictures` (ASCII, minúsculas), usada em endpoints, nome do servidor MCP, User-Agent, conta de serviço do Panoramax e recursos da Cloudflare (Worker, R2, D1). O `/` e o `ŧ` nunca entram num identificador técnico.

| Host | O que serve hoje | Como |
| --- | --- | --- |
| `voltframe.ocarroeletrico.com` | Páginas dos postos (pt-PT e inglês), API `/api/v1` só de leitura, `sitemap.xml`, `robots.txt`, `llms.txt` | Worker `pictures` + D1 ([`cloudflare.md`](cloudflare.md), secção 4) |
| `pictures.ocarroeletrico.com` | Links estáticos (`/<id>.jpg` e tamanhos); por agora todos dão `404` | Custom domain do bucket R2 `pictures`, servido pela CDN **sem Worker** ([`cloudflare.md`](cloudflare.md), secção 3) |
| `panoramax.ocarroeletrico.com` | Servidor Panoramax (API, visualizador, imagens), fora da federação | Zerops, com o bucket R2 `panoramax` como armazenamento ([`infra.md`](infra.md)) |

O `pictures.*` não tem Worker à frente de propósito: um Worker corre antes da
cache, por isso cada pedido contaria para o limite dos Workers mesmo com a
foto em cache. Uma Cache Rule no `pictures.*` dá um Edge TTL longo; um *cache
miss* é uma leitura Classe B no R2 (10 milhões grátis por mês).

## Componentes

```
   Pessoas, apps, mapas, agentes
              |
   Worker VoltFrame (voltframe.*)          R2 "pictures" (pictures.*)
   páginas, API só de leitura,             links estáticos pela CDN
   sitemap, llms.txt                       (vazio até haver fotos)
              |
   D1 "pictures": stations, evses
              ^
   GitHub Actions, todos os dias:
   ohmigo_chargers.json (NAP dashboard) --> D1

   Panoramax (panoramax.*, Zerops)
     PostgreSQL+PostGIS, worker de imagens
     R2 "panoramax" (originais e tamanhos)
     conta de serviço "pictures", sem OAuth
```

O Worker ainda não fala com o Panoramax: isso chega com o envio de fotos
([`plan.md`](plan.md)).

## Porque o Panoramax

**Porque o Panoramax.** Dá de graça o armazenamento e os tamanhos das
imagens, a licença por servidor, as etiquetas por foto, uma API de envio, os
pedidos de remoção e a federação: as fotos aparecem no mapa geral do
Panoramax e o OSM aponta para elas com `panoramax=<uuid>`, a etiqueta que a
comunidade já usa. Não há servidor Panoramax em Portugal; o da OSM França só
aceita envios de fora de França para testes, e o do MapComplete só aceita
envios pelo MapComplete.

**Porque um servidor só para postos.** Um "Panoramax PT" geral, aberto a
fotos de rua de qualquer pessoa, faria de nós o responsável RGPD por tudo,
com terabytes de armazenamento e moderação muito maior. Este servidor só
recebe fotos de postos, enviadas pelo VoltFrame. Só se chama "Panoramax PT"
se a OSM Portugal e a equipa do Panoramax concordarem, e pode crescer para
isso mais tarde.

**Sem logins no Panoramax.** O VoltFrame envia tudo com uma única conta de
serviço (`pictures`, que não é admin); o registo no Panoramax está fechado,
como no servidor do MapComplete. Os contribuidores só entram no VoltFrame,
com OSM. Isto garante que só entram fotos de postos e que a moderação é a do
VoltFrame. O visualizador, as páginas das fotos e a API de leitura do
Panoramax continuam públicos. O que se perde (o envio pelo Panoramax e as
apps dele, a página "as minhas fotos" do Panoramax) não faz falta ou é
refeito no VoltFrame.

O servidor está configurado para isto: licença CC BY-SA 4.0, envio só com
token, fotos `owner-only` até o VoltFrame as aprovar, sem desfocagem no
servidor. Configuração e resultados do ensaio em [`infra.md`](infra.md),
secções 4 e 9.

## Postos e tomadas

A lista de postos válidos vem do NAP (fonte oficial): cerca de 8 900 locais
e 19 700 pontos.

**Sincronização.** O VoltFrame lê o `ohmigo_chargers.json` que o NAP
dashboard já publica (o mesmo que o site e o ohmigo usam), todos os dias,
pelo GitHub Actions, e faz *upsert* na D1: postos novos entram como
`active`, postos que desaparecem passam a `missing_from_nap` (nunca são
apagados, para os links e as fotos continuarem a funcionar). Funcionamento e
travões em [`cloudflare.md`](cloudflare.md), secção 5.

**Chave dos links.** O posto usa o `id` do local (`EZC-AMD-00051`: prefixo do
operador + código), que é único e é o formato `OPC-XXXXXXXXXX` do Alexandre.
A tomada usa o código EVSE do NAP sem os `*` (`PTEZCEAMD000511`), vindo do
campo `evse` de cada ponto do feed. Pontos sem código EVSE no NAP não têm
link de tomada.

**Armadilhas de IDs** (do [gotchas.md](https://github.com/CarregaErvilhas/nap-dashboard/blob/main/references/gotchas.md) do NAP dashboard):

- Juntar pelo `site_external_id` do NAP. O `point_external_id` (`PT*op*[E]*reg*num*tom`) não é fiável como chave: às vezes traz `ELSB` em vez de `LSB` e tem entre 3 e 7 segmentos.
- O código EVSE não é garantidamente único: já houve um operador a publicar o mesmo em dois postos. Por isso a chave das tomadas é (`station_id`, `point_id`) e o código tem um índice simples.
- Os EVSE do MOBI.Data aparecem em vários formatos (`ABF-00011-01`, `PT-EDP-EABF-00008-1`) e centenas são só números (`97`).
- O `ref:EU:EVSE` do OSM está rigorosamente igual ao código EVSE do NAP, por isso a junção faz-se pelo código tal como vem, sem normalizar nem tirar zeros à esquerda.

**Tabelas na D1** (`worker/migrations/`):

| Tabela | Colunas principais | Notas |
| --- | --- | --- |
| `stations` | `id` (PK, ex. `EZC-AMD-00051`), `code`, `opc`, `operator`, `name`, `address`, `municipality`, `region`, `lat`, `lon`, `source` (`nap`, `community`), `status` (`active`, `missing_from_nap`, `pending_review`, `rejected`), `osm_ref`, `updated_at` | `community` = proposto por utilizador (ainda não há envios) |
| `evses` | `station_id` (FK) + `point_id` (PK), `evse_id` (forma original com `*`), `evse_compact` (sem `*`, índice simples), `connector`, `max_kw`, `dc`, `status` | Uma linha por ponto/tomada. O `point_id` do MOBI.Data repete-se entre postos |
| `import_state` | `key`, `value` | O `generatedAt` do último feed importado |

As tabelas das fotos, dos utilizadores e da moderação estão em
[`plan.md`](plan.md), *Modelo de dados*.

## Site e API

O Worker serve as páginas dos postos em pt-PT (`/postos/{id}`) e em inglês
(`/en/stations/{id}`), a procura de uma tomada pelo código EVSE
(`/tomadas/{evse}`, `/en/sockets/{evse}`), a API só de leitura
(`/api/v1/stations/{id}`, `/api/v1/evses/{evse}`), o `sitemap.xml`, o
`robots.txt` e o `llms.txt`. Rotas, cabeçalhos, acessibilidade e cache em
[`cloudflare.md`](cloudflare.md), secção 4.

## Links estáticos

O URL é o ID e nunca muda. O bucket, o domínio e a cache já existem; as
fotos ainda não (a publicação está em [`plan.md`](plan.md)).

| URL (`pictures.ocarroeletrico.com`) | Devolve |
| --- | --- |
| `/EZC-AMD-00051.jpg` | Foto principal do posto (1024 px) |
| `/EZC-AMD-00051.thumb.jpg` | 400 px |
| `/EZC-AMD-00051.full.jpg` | 2048 px |
| `/PTTRKEVNT0000501.jpg` (e `.thumb.jpg`, `.full.jpg`) | Foto principal da tomada |

- **Sem query strings.** O R2 ignora-as, por isso cada tamanho tem a sua chave.
- **Galerias e metadados** ficam na API: `voltframe.ocarroeletrico.com/api/v1/stations/{id}`.
- **Sem foto:** o R2 responde `404`, para cada app decidir o que mostrar.
- **Cache:** Edge TTL de 30 dias e `404` de 1 h na Cache Rule, sem query strings na chave ([`cloudflare.md`](cloudflare.md), secção 3).
