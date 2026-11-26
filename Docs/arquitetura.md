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
- **Slug técnica:** `OlhaOPosto` onde as maiúsculas se mantêm e alguém o lê (conta de serviço e produtor no Panoramax, etiquetas `OlhaOPosto|…`, User-Agent, nome do servidor MCP, título dos *upload sets*), para não se ler "Olhão". `olhaoposto` em minúsculas só onde tem de ser ou onde as maiúsculas se perdem: subdomínio e URLs, nome do Worker, pacote npm, `photos.origin`. Os apóstrofos nunca entram num identificador técnico.
- **Nomes que ficam `pictures`:** o bucket R2 `pictures` (e `pictures.ocarroeletrico.com`, o host dos links estáticos), o `pictures-staging` e a D1 `pictures`. São internos ou já estão em links, e mudar a D1 obriga a criar outra base.

| Host | O que serve hoje | Como |
| --- | --- | --- |
| `olhaoposto.ocarroeletrico.com` | Páginas dos postos e pesquisa (pt-PT e inglês), API `/api/v1` (leitura aberta, escrita com sessão ou *token*), privacidade e condições de utilização, login OSM, conta, envio, moderação, ranking, `sitemap.xml`, `robots.txt`, `llms.txt` | Worker `olhaoposto` + D1 ([`cloudflare.md`](cloudflare.md), secção 4) |
| `pictures.ocarroeletrico.com` | Links estáticos (`/<id>.jpg` e tamanhos): a foto principal de cada posto e tomada, ou `404` | Custom domain do bucket R2 `pictures`, servido pela CDN **sem Worker** ([`cloudflare.md`](cloudflare.md), secção 3) |
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
   páginas, API, tokens, login OSM,        links estáticos pela CDN
   envio, postos propostos, moderação,     (fotos principais)
   pontos e ranking, sitemap
              |
   D1 "pictures": stations, evses,         R2 "pictures-staging"
   users, sessions, photos, selections,    (privado, cópias até à aprovação)
   points, api_tokens, review_queue...
              ^
   GitHub Actions, todos os dias:
   ohmigo_chargers.json (NAP dashboard) --> D1

   Panoramax (panoramax.*, Zerops)
     PostgreSQL+PostGIS, worker de imagens
     R2 "panoramax" (originais e tamanhos)
     conta de serviço "OlhaOPosto", sem OAuth
```

O Worker fala com o Panoramax com a conta de serviço `OlhaOPosto`: cria um
*upload set* escondido por foto no envio, torna-o público ao aprovar,
apaga-o ao recusar, e trata as denúncias dos pedidos de remoção
([`cloudflare.md`](cloudflare.md), secção 4).

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
serviço (`OlhaOPosto`, que não é admin); o registo no Panoramax está fechado,
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
| `stations` | `id` (PK, ex. `EZC-AMD-00051`), `code`, `opc`, `operator`, `name`, `address`, `municipality`, `region`, `lat`, `lon`, `source` (`nap`, `community`), `status` (`active`, `missing_from_nap`, `pending_review`, `rejected`), `osm_ref`, `updated_at` | `community` = proposto por um utilizador (`id` `OOP-…`), `pending_review` até um moderador decidir; o import só mexe em postos `nap` |
| `evses` | `station_id` (FK) + `point_id` (PK), `evse_id` (forma original com `*`), `evse_compact` (sem `*`, índice simples), `connector`, `max_kw`, `dc`, `status` | Uma linha por ponto/tomada. O `point_id` do MOBI.Data repete-se entre postos |
| `stations_fts` | Índice FTS5 de `id`, `code`, `name`, `address`, `municipality`, `operator`, `opc` | Para a pesquisa. Só o índice: o texto fica em `stations`, e três *triggers* mantêm-no a par, por isso o import não muda |
| `import_state` | `key`, `value` | O `generatedAt` do último feed importado |
| `users` | `id` (UUID nosso), `osm_uid` (único), `osm_name`, `pseudonym`, `role` (`contributor`, `trusted`, `moderator`, `admin`), `ranking_opt_out`, `promoted_by`, `promoted_at`, `license_accepted_at`, `created_at`, `last_login_at` | Só do login OSM: sem email. O `pseudonym` ainda não se edita |
| `sessions` | `token_hash` (PK, SHA-256 do *cookie*), `user_id` (FK), `created_at`, `expires_at` | Uma cópia da tabela não abre sessões. As expiradas saem no login seguinte |
| `photos` | `id` (UUID), `origin`, `station_id` (FK), `evse_compact` (nulo = foto geral), `uploader_id` (FK), `panoramax_set`, `panoramax_id`, `taken_at`, `exif_lat`, `exif_lon`, `distance_m`, `license`, `credit`, `status` (`uploading`, `failed`, `pending`, `published`, `hidden`, `removed`), `approved_by`, `approved_at`, `created_at` | Uma linha por envio. O GPS do EXIF é só para a moderação, nunca publicado. `uploading` e `failed` são envios a meio ou falhados |
| `selections` | `target` (PK), `station_id` (FK), `photo_id` (FK), `chosen_by`, `chosen_at`, `published_at` | Qual foto cada link estático serve. `INSERT OR IGNORE` torna a primeira aprovação atómica |
| `station_aliases` | `old_id` (PK), `new_id` (FK), `created_by`, `created_at` | Re-keys do NAP: o link antigo responde `301` para o novo |
| `points` | `id` (autoincrement), `user_id` (FK), `photo_id` (FK), `points`, `reason` (`approved`, `first_photo`, `refresh`), `month`, `created_at` | Gamificação (*Pontos e ranking*, abaixo). Uma linha por atribuição; só contam as de fotos `published` |
| `api_tokens` | `id`, `user_id` (FK), `token_hash` (único, SHA-256), `prefix`, `name`, `scopes`, `created_at`, `expires_at`, `last_used_at`, `revoked_at` | *Tokens* de API: uma cópia da tabela não abre nada |
| `review_queue` | `id`, `kind` (`new_station`), `station_id` (FK), `payload` (JSON), `submitted_by`, `status` (`pending`, `approved`, `rejected`), `decided_by`, `decided_at`, `note`, `created_at` | O que precisa de um humano e não tem tabela própria: hoje, os postos propostos. As fotos têm o estado em `photos`, e os pedidos de remoção vivem no Panoramax |

## Site e API

O Worker serve as páginas dos postos em pt-PT (`/postos/{id}`) e em inglês
(`/en/stations/{id}`), a procura de uma tomada pelo código EVSE
(`/tomadas/{evse}`, `/en/sockets/{evse}`), a pesquisa de postos (`/pesquisa`,
`/en/search`, também no formulário da página inicial), a API de leitura
(`/api/v1/stations?q=`, `/api/v1/stations?lat=&lon=`, `/api/v1/stations/{id}`,
`/api/v1/evses/{evse}`, `/api/v1/main-photos`, `/api/v1/ranking`), a
política de privacidade (`/privacidade`), as condições de utilização
(`/condicoes`), o ranking (`/ranking`), o `sitemap.xml`, o `robots.txt` e o
`llms.txt`.

Com o login OSM há a conta (`/conta`: pontos, medalha, sair do ranking,
*tokens* de API), a página de envio (`/enviar`), a fila de moderação e os
painéis de administração (`/admin/…`). A escrita na API
(`POST /api/v1/photos`, `POST /api/v1/stations`,
`PUT /api/v1/selections/{target}`) aceita a sessão, só a partir do próprio
site, ou um *token* (`Authorization: Bearer oop_…`) com o âmbito certo. Rotas,
cabeçalhos, acessibilidade e cache em [`cloudflare.md`](cloudflare.md),
secção 4.

## Fluxo de envio

Tudo o que mexe na foto original acontece no browser: o servidor nunca
recebe o original nem os metadados. A página `/enviar`:

1. Abre uma ou várias fotos, JPEG ou HEIC (o HEIC pelo browser ou pelo
   libheif em WebAssembly), e trata-as uma de cada vez.
2. Lê o GPS e a data do EXIF e sugere os postos a 500 m. Sem GPS: pesquisa
   por texto ou mapa (OpenStreetMap, só se a pessoa o abrir). O posto da
   foto anterior fica sugerido para a seguinte.
3. Se o posto não existir, propõe-se um posto novo (nome, operador, código,
   posição), que espera por um moderador com as fotos dele.
4. Procura caras no dispositivo (MediaPipe, BlazeFace) e pré-desenha as
   zonas; a pessoa confirma, desliga ou acrescenta zonas, também para as
   matrículas, e cada zona leva um mosaico.
5. Gera 2048, 1024 e 400 px sem metadados e envia-os, com a data e o GPS à
   parte. O Worker volta a verificar tudo, guarda a de 2048 px escondida no
   Panoramax (com as coordenadas do posto, nunca as do GPS) e as outras em
   `pictures-staging`.

Contas `trusted` publicam logo quando a foto foi tirada a 300 m ou menos de
um posto `active`; o resto fica `pending` para a fila (`/admin/fila`), que
mostra primeiro os postos propostos e avisa das fotos sem GPS ou longe do
posto. Quem envia aceita as condições de utilização e a licença no primeiro
envio (`license_accepted_at`).

**O que se faz com o GPS do EXIF.** Sugere o posto e sinaliza fotos longe
dele (`distance_m`, e o aviso na fila). Fica só na D1, para a moderação; a
API pública mostra a data, nunca as coordenadas de quem tirou a foto. O
Panoramax recebe as coordenadas do posto.

## Links estáticos

O URL é o ID e nunca muda. A resolução código → foto acontece **na escrita,
não no pedido**: quando um moderador aprova uma foto e o alvo (a tomada, ou
o posto para uma foto do posto em geral) ainda não tem principal, o Worker
(`src/publish.ts`) regista-a na tabela `selections` e copia três tamanhos
para o bucket `pictures`. Uma foto de uma tomada também passa a principal do
posto, se o posto não tiver nenhuma. As cópias de 1024 e 400 px vêm do
`pictures-staging`; a de 2048 px vem do Panoramax, sem o EXIF que o
Panoramax lhe escreve. Cada cópia leva um XMP com o autor, a licença
CC BY-SA 4.0 e o link da página de crédito da foto (`/p/{photo_id}`; o R2
não manda cabeçalhos próprios), sem GPS, e `Cache-Control: public,
max-age=86400`. As cópias publicadas antes da página de crédito existir
continuam a apontar para a página do posto até serem publicadas outra vez.
A página do posto mostra a foto principal com o crédito, e as miniaturas das
tomadas; ambas ligam à página de crédito.

**Página de crédito** (`/p/{photo_id}`, `/en/p/{photo_id}`; `src/credit.ts`):
a foto, o autor (`photos.credit`), a data (a da foto, ou a da aprovação), a
licença CC BY-SA 4.0 com o link do texto, o posto ou a tomada que mostra, o
texto de atribuição pronto a copiar e os links para a página do posto, para o
Panoramax e para o pedido de remoção. Só existe para fotos publicadas de
postos públicos: uma foto pendente, oculta ou retirada dá `404`. A foto
principal vem de `pictures.*`; outra foto publicada vem do Panoramax. Não vai
para o `sitemap.xml`: chega-se lá pelas páginas dos postos.
**Acrescentar ao OSM** (só na foto principal atual de um posto ou tomada, sem
bot nem edição automática): o link abre o editor iD no elemento ligado ao
posto (`osm_ref`) ou, se não houver ou se a foto for de uma tomada, no sítio
do posto, e mostra a etiqueta `panoramax=<id>` para copiar.
Um moderador ou uma conta `trusted` pode trocar a principal
(`PUT /api/v1/selections/{target}`): o Worker copia a foto nova por cima das
três chaves e faz *purge* desses URLs.

| URL (`pictures.ocarroeletrico.com`) | Devolve |
| --- | --- |
| `/EZC-AMD-00051.jpg` | Foto principal do posto (1024 px) |
| `/EZC-AMD-00051.thumb.jpg` | 400 px |
| `/EZC-AMD-00051.full.jpg` | 2048 px |
| `/PTTRKEVNT0000501.jpg` (e `.thumb.jpg`, `.full.jpg`) | Foto principal da tomada |

- **Sem query strings.** O R2 ignora-as, por isso cada tamanho tem a sua chave.
- **Galerias e metadados** ficam na API: `olhaoposto.ocarroeletrico.com/api/v1/stations/{id}`.
- **Lista das fotos principais:** `olhaoposto.ocarroeletrico.com/api/v1/main-photos`, com o autor, os três tamanhos, a página do posto e o id da foto no Panoramax. O NAP dashboard copia as miniaturas uma vez por dia e mostra-as com o crédito, como faz com as do OSM.
- **Ligações entre os sites:** a página de cada posto aponta para o NAP dashboard (`nap.ocarroeletrico.com/?posto={código}`, só para postos que o NAP ainda publica) e, quando há foto principal, para ela no mapa do Panoramax (`/viewer?focus=map&map=19/{lat}/{lon}&pic={id}`).
- **Sem foto:** o R2 responde `404`, para cada app decidir o que mostrar.
- **Cache:** Edge TTL de 30 dias e `404` nunca em cache na Cache Rule, sem query strings na chave ([`cloudflare.md`](cloudflare.md), secção 3).

## Publicação e gestão de fotos

- **Publicação direta:** contas `trusted` publicam logo no envio, quando o posto está `active` e a foto foi tirada a ≤300 m dele. Caso contrário (contributor, sem GPS, >300 m, posto proposto) fica `pending` para a fila.
- **Trocar a principal:** `PUT /api/v1/selections/{target}` com `{ "photo": "<id>" }` (`trusted`, moderador, administrador; sessão ou *token* `selections:write`) copia os 3 tamanhos por cima e faz *purge* da cache.
- **Aliases (re-key):** quando o NAP muda o código de um posto, o antigo fica `missing_from_nap`. Um moderador cria o alias em `/admin/postos-fora-do-nap`; o link antigo responde `301` para o novo.
- **Postos propostos:** aprovados passam a `active` e públicos; recusados passam a `rejected`, com as fotos que esperavam por eles.

## Pontos e ranking

- **Pontos**, só para fotos aprovadas e sempre para o autor da foto: +1 por foto, +3 pela primeira foto de um posto ou tomada, +2 quando a foto passa a principal no lugar de uma com mais de 12 meses. A mesma pessoa no mesmo alvo em 30 dias conta uma vez.
- **Só fotos publicadas contam:** uma foto ocultada ou retirada (pedido de remoção, batota) deixa de dar pontos sem se apagar nada.
- **Medalhas**, pelo total de sempre: bronze com 10 pontos, prata com 50, ouro com 200. Sem prémios.
- **Ranking:** `/ranking` (do mês e de sempre), em tabela, com o nome de crédito, a medalha, as fotos e os pontos; `/api/v1/ranking?period=month|all`. Quem sai do ranking na conta deixa de aparecer, e os pontos continuam a contar para si.

## Tokens de API

Na conta, cada pessoa cria *tokens* (até 5 ativos) com um nome, os âmbitos
(`photos:write`; `selections:write` só para `trusted`, moderadores e
administradores) e a validade (30, 90 ou 365 dias). O *token* aparece uma vez;
a D1 guarda só o hash. Age como a conta, com o papel e os limites dela, lidos
em cada pedido. O envio pela API é só `mode=clean`: o cliente manda as três
fotos já desfocadas e sem EXIF, com as coordenadas e a data no JSON, e o
Worker recusa ficheiros com metadados. Não passa pelo Turnstile.
