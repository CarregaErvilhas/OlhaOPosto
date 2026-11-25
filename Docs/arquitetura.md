# Arquitetura — o que está a funcionar

Este documento descreve o olh'o'posto tal como existe hoje. O que ainda falta
construir, e o design dessas partes, está em [`plan.md`](plan.md). Os
detalhes de operação estão em [`infra.md`](infra.md) (servidor Panoramax no
Zerops) e em [`cloudflare.md`](cloudflare.md) (R2, Worker, D1 e o import dos
postos). As licenças estão em [`licenca.md`](licenca.md).

## Objetivo

Um servidor **Panoramax** próprio, só para postos de carregamento, guarda as
fotos. Um **Worker da Cloudflare** (`olhaoposto`) faz o resto: a lista de postos
do NAP, os links estáticos pelo ID oficial, a escolha da foto principal, o
envio, a moderação, o ranking, a API e o MCP. Exemplo de link:
`https://pictures.ocarroeletrico.com/TRK-VNT-00005.jpg`.

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

Responsável (RGPD): O Carro Elétrico. Passar para uma associação fica como saída futura.

## Nomes e domínios

- **Marca:** "olh'o'posto" (lê-se "Olha o posto"). Só apresentação: logótipo, títulos e `display_name` da app OAuth do OSM. Leitores de ecrã: "Olha o posto" (`aria-label` dos SVG e texto escondido no cabeçalho). No código, `BRAND` e `BRAND_SPOKEN` em `worker/src/pages.ts`. Ficheiros e cores em `Design/marca/`.
- **Repositório:** `CarregaErvilhas/OlhaOPosto`.
- **Slug técnica:** `olhaoposto` (ASCII, minúsculas), usada no subdomínio, nome do servidor MCP, User-Agent, conta de serviço do Panoramax, etiquetas `olhaoposto|…` e Worker. Os apóstrofos nunca entram num identificador técnico.
- **Nomes que ficam `pictures`:** o bucket R2 `pictures` (e `pictures.ocarroeletrico.com`, o host dos links estáticos), o `pictures-staging` e a D1 `pictures`. São internos ou já estão em links, e mudar a D1 obriga a criar outra base.

| Host | O que serve hoje | Como |
| --- | --- | --- |
| `olhaoposto.ocarroeletrico.com` | Páginas dos postos e pesquisa (pt-PT e inglês), API `/api/v1` só de leitura, política de privacidade, conta e página de envio (desligadas até ao login OSM), `sitemap.xml`, `robots.txt`, `llms.txt` | Worker `olhaoposto` + D1 ([`cloudflare.md`](cloudflare.md), secção 4) |
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
   Worker olhaoposto (olhaoposto.*)        R2 "pictures" (pictures.*)
   páginas, API só de leitura,             links estáticos pela CDN
   login OSM e envio (fechados),           (vazio até haver fotos)
   sitemap
              |
   D1 "pictures": stations, evses,         R2 "pictures-staging"
   users, sessions, photos                 (privado, cópias até à aprovação)
              ^
   GitHub Actions, todos os dias:
   ohmigo_chargers.json (NAP dashboard) --> D1

   Panoramax (panoramax.*, Zerops)
     PostgreSQL+PostGIS, worker de imagens
     R2 "panoramax" (originais e tamanhos)
     conta de serviço "olhaoposto", sem OAuth
```

O Worker fala com o Panoramax só no envio, com a conta de serviço
`olhaoposto`: cria um *upload set* escondido por foto. Enquanto o segredo
`PANORAMAX_TOKEN` não existir, não fala de todo ([`cloudflare.md`](cloudflare.md),
*Abrir o envio*).

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
recebe fotos de postos, enviadas pelo olh'o'posto. Só se chama "Panoramax PT"
se a OSM Portugal e a equipa do Panoramax concordarem, e pode crescer para
isso mais tarde.

**Sem logins no Panoramax.** O olh'o'posto envia tudo com uma única conta de
serviço (`olhaoposto`, que não é admin); o registo no Panoramax está fechado,
como no servidor do MapComplete. Os contribuidores só entram no olh'o'posto,
com OSM. Isto garante que só entram fotos de postos e que a moderação é a do
olh'o'posto. O visualizador, as páginas das fotos e a API de leitura do
Panoramax continuam públicos. O que se perde (o envio pelo Panoramax e as
apps dele, a página "as minhas fotos" do Panoramax) não faz falta ou é
refeito no olh'o'posto.

O servidor está configurado para isto: licença CC BY-SA 4.0, envio só com
token, fotos `owner-only` até o olh'o'posto as aprovar, sem desfocagem no
servidor. Configuração e resultados do ensaio em [`infra.md`](infra.md),
secções 4 e 9.

## Postos e tomadas

A lista de postos válidos vem do NAP (fonte oficial): mais de 8 900 locais e 19 700 pontos.

**Sincronização.** O olh'o'posto lê o `ohmigo_chargers.json` que o NAP
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
| `stations_fts` | Índice FTS5 de `id`, `code`, `name`, `address`, `municipality`, `operator`, `opc` | Para a pesquisa. Só o índice: o texto fica em `stations`, e três *triggers* mantêm-no a par, por isso o import não muda |
| `import_state` | `key`, `value` | O `generatedAt` do último feed importado |
| `users` | `id` (UUID nosso), `osm_uid` (único), `osm_name`, `pseudonym`, `role` (`contributor`, `trusted`, `moderator`, `admin`), `ranking_opt_out`, `promoted_by`, `promoted_at`, `license_accepted_at`, `created_at`, `last_login_at` | Só do login OSM: sem email. Hoje só se escrevem o OSM, o papel `contributor` e as datas; o resto fica para o envio e a moderação |
| `sessions` | `token_hash` (PK, SHA-256 do *cookie*), `user_id` (FK), `created_at`, `expires_at` | Uma cópia da tabela não abre sessões. As expiradas saem no login seguinte |
| `photos` | `id` (UUID), `origin`, `station_id` (FK), `evse_compact` (nulo = foto geral), `uploader_id` (FK), `panoramax_set`, `panoramax_id`, `taken_at`, `exif_lat`, `exif_lon`, `distance_m`, `license`, `credit`, `status` (`uploading`, `failed`, `pending`, `published`, `hidden`, `removed`), `approved_by`, `approved_at`, `created_at` | Uma linha por envio. O GPS do EXIF é só para a moderação, nunca publicado. `uploading` e `failed` são envios a meio ou falhados |

As tabelas da moderação, das seleções e dos pontos estão em [`plan.md`](plan.md), *Modelo de dados*.

## Site e API

O Worker serve as páginas dos postos em pt-PT (`/postos/{id}`) e em inglês
(`/en/stations/{id}`), a procura de uma tomada pelo código EVSE
(`/tomadas/{evse}`, `/en/sockets/{evse}`), a pesquisa de postos (`/pesquisa`,
`/en/search`, também no formulário da página inicial), a API só de leitura
(`/api/v1/stations?q=`, `/api/v1/stations?lat=&lon=`, `/api/v1/stations/{id}`,
`/api/v1/evses/{evse}`), a política de privacidade (`/privacidade`), o
`sitemap.xml`, o `robots.txt` e o `llms.txt`.

Tem também o início de sessão com o OpenStreetMap, a conta (`/conta`) e a
página de envio (`/enviar`), que prepara a foto no browser (EXIF, posto,
desfocagem à mão, três tamanhos sem metadados), e o envio
(`POST /api/v1/photos`), que a guarda escondida no Panoramax e em
`pictures-staging` à espera de moderação. O login fica desligado até
existirem os segredos do OSM, e o envio até haver também o token do
Panoramax. Rotas, cabeçalhos,
acessibilidade e cache em [`cloudflare.md`](cloudflare.md), secção 4.

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
- **Galerias e metadados** ficam na API: `olhaoposto.ocarroeletrico.com/api/v1/stations/{id}`.
- **Sem foto:** o R2 responde `404`, para cada app decidir o que mostrar.
- **Cache:** Edge TTL de 30 dias e `404` de 1 h na Cache Rule, sem query strings na chave ([`cloudflare.md`](cloudflare.md), secção 3).
