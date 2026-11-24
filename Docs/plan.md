# Fotos dos postos de carregamento — design técnico

Fernando · revisto depois de uma sessão de perguntas e respostas ao plano. Diagrama e ecrãs: `Design/Fluxo-panoramax.html` e `Design/Ecras-panoramax.html`.

## Resumo e objetivos

Proposta: um servidor **Panoramax** próprio, só para postos de carregamento, guarda as fotos; um **Worker da Cloudflare** (VoltFrame) faz o resto: lista de postos do NAP, links estáticos pelo ID oficial, escolha da foto principal, página de envio, moderação, ranking, API e MCP. Exemplo de link: `https://pictures.ocarroeletrico.com/TRK-VNT-00005.jpg`. Orçamento: **10 €/mês** no total.

Requisitos (proposta de Alexandre Moleiro):

- Servidor que aloja as fotos e gera links estáticos.
- Upload obrigatoriamente associado a um posto (`OPC-XXXXXXXXXX`) ou a uma tomada (`PT-OPC-E-YYYYYYYYY`).
- O posto tem de existir; pesquisa por referência, morada ou coordenadas. Postos novos entram numa fila de revisão humana.
- Quando há várias fotos, escolher qual alimenta cada link estático.
- Links por posto (`/OPC-XXXXXXXXXX.jpg`) e por tomada (`/PTOPCEYYYYYYYYY.jpg`), usáveis por qualquer app ou mapa (OSM, NAP dashboard).

Princípios de design:

- **URL estável, conteúdo trocável**: o link nunca muda; muda apenas a foto que ele aponta.
- **Dados oficiais como base**: postos e EVSE vêm do NAP/Mobi.E; o OSM serve de complemento.
- **Privacidade por defeito**: desfocagem de caras e matrículas e remoção do EXIF antes de publicar.
- **Licença aberta obrigatória** (CC BY-SA 4.0, com autorização ODbL), para poder ser usada no OSM.
- **Saída fácil**: dados exportáveis, código aberto e fotos num servidor Panoramax federado, para a comunidade não depender de uma pessoa ou conta.

## Nomes e domínios

- **Marca:** "pIcŧU/Re" (lê-se "picture"). Só apresentação: logótipo, títulos e `display_name` da app OAuth do OSM. Leitores de ecrã: `aria-label="picture"`. O site mostra os dois nomes, VoltFrame e pIcŧU/Re.
- **Repositório:** VoltFrame.
- **Slug técnica:** `pictures` (ASCII, minúsculas), usada em endpoints, nome do servidor MCP, User-Agent, conta de serviço do Panoramax e recursos da Cloudflare (Worker, R2, D1). O `/` e o `ŧ` nunca entram num identificador técnico.

| Host | O que serve | Como |
| --- | --- | --- |
| `voltframe.ocarroeletrico.com` | Site (páginas, envio, moderação), `/api/v1`, `/mcp`, `/llms.txt` | Worker. Redirect URI do OAuth OSM e cookies de sessão só aqui |
| `pictures.ocarroeletrico.com` | Links estáticos (`/<id>.jpg` e tamanhos) | Custom domain do bucket R2 `pictures`, servido pela CDN **sem Worker** |
| `panoramax.ocarroeletrico.com` | Servidor Panoramax (API, visualizador, imagens) | Zerops, com o bucket R2 `panoramax` como armazenamento |

O `pictures.*` não tem Worker à frente de propósito: um Worker corre antes da cache, por isso cada pedido contaria para o limite dos Workers mesmo com a foto em cache. Uma Cache Rule no `pictures.*` dá um Edge TTL longo; um *cache miss* é uma leitura Classe B no R2 (10 milhões grátis por mês).

Responsável (RGPD): Fernando, na conta Cloudflare existente. Passar para uma associação fica como saída futura, não bloqueia o lançamento.

## Arquitetura

```
 Contribuidor (browser)        Apps / mapas / ohmigo       Agentes (MCP)
   desfoca + tira EXIF               |                         |
          \                          |                         |
           +-------- Worker VoltFrame (voltframe.*) -----------+
           |      D1 (postos, fotos, seleções, pontos)          |
           |                                                    |
           | conta de serviço                       copia a principal
           v                                                    v
   Panoramax (panoramax.*, Zerops)              R2 "pictures" (pictures.*)
     PostgreSQL+PostGIS, workers                  links estáticos, CDN
     R2 "panoramax" (originais e tamanhos)
           |
           +--> federação (api.panoramax.xyz) --> OSM: panoramax=<uuid>

   ETL diário: ohmigo_chargers.json (NAP dashboard) --> D1
```

**Porque o Panoramax.** Dá de graça o armazenamento e os tamanhos das imagens, a licença por servidor, as etiquetas por foto, uma API de envio, os pedidos de remoção e a federação: as fotos aparecem no mapa geral do Panoramax e o OSM aponta para elas com `panoramax=<uuid>`, a etiqueta que a comunidade já usa. Não há servidor Panoramax em Portugal; o da OSM França só aceita envios de fora de França para testes, e o do MapComplete só aceita envios pelo MapComplete.

**Porque um servidor só para postos.** Um "Panoramax PT" geral, aberto a fotos de rua de qualquer pessoa, faria de nós o responsável RGPD por tudo, com terabytes de armazenamento e moderação muito maior. Este servidor só recebe fotos de postos, enviadas pelo VoltFrame. Só se chama "Panoramax PT" se a OSM Portugal e a equipa do Panoramax concordarem, e pode crescer para isso mais tarde.

**Sem logins no Panoramax.** O VoltFrame envia tudo com uma única conta de serviço (`pictures`); o registo no Panoramax fica fechado, como no servidor do MapComplete. Os contribuidores só entram no VoltFrame, com OSM. Isto garante que só entram fotos de postos e que a moderação é a do VoltFrame. O visualizador, as páginas das fotos e a API de leitura do Panoramax continuam públicos. O que se perde (o envio pelo Panoramax e as apps dele, a página "as minhas fotos" do Panoramax) não faz falta ou é refeito no VoltFrame.

## Servidor Panoramax

Componentes (API v2.17): API em Python 3.12+ (imagem Docker `panoramax/api`), *workers* de processamento de imagens e PostgreSQL 15+ com PostGIS 3.4+ ([instalação](https://docs.panoramax.fr/backend/install/install/)).

Configuração principal ([settings](https://docs.panoramax.fr/backend/install/settings/)):

- `FS_URL` (ou `FS_TMP_URL`, `FS_PERMANENT_URL`, `FS_DERIVATIVES_URL`): `s3://panoramax/...?endpoint_url=https://<conta>.r2.cloudflarestorage.com&region=auto`.
- `API_PICTURES_LICENSE_SPDX_ID=CC-BY-SA-4.0` e `API_PICTURES_LICENSE_URL`.
- Sem `OAUTH_PROVIDER`: ninguém entra pela web, nem a conta de serviço nem o admin, que usam tokens emitidos no servidor ([`infra.md`](infra.md), secção 4); `API_FORCE_AUTH_ON_UPLOAD`; registo fechado.
- `API_BLUR_URL` vazio: sem desfocagem no servidor por agora (ver *Desfocagem*).

Cada foto tem etiquetas `chave=valor` ([sintaxe](https://docs.panoramax.fr/tags/syntax/)):

```
osm|ref:EU:EVSE=PT*TRK*E*VNT*00005*01
pictures|site=TRK-VNT-00005
pictures|author=joao_osm
```

**Federação.** Abre-se um pedido no repositório do catálogo federado e os operadores acrescentam o servidor ao *harvester* ([como](https://docs.panoramax.fr/how-to-contribute/hosting-instance/)). Só depois da conversa com a OSM Portugal e com a equipa do Panoramax; até lá o servidor fica privado.

**Ensaio antes de construir (fase 1), feito.** O servidor está em produção em `panoramax.ocarroeletrico.com`, fora da federação. Detalhe e números em [`infra.md`](infra.md), secção 9.

| Verificar | Resultado |
| --- | --- |
| PostGIS 3.4+ no PostgreSQL gerido do Zerops | Passa: PostGIS 3.6.4 no PostgreSQL 18 |
| R2 como `FS_URL` | Passa: originais e tamanhos no bucket `panoramax`, e apagar pela API limpa o bucket |
| Envio de uma foto isolada (não uma sequência) com etiquetas, pela API | Passa |
| Foto enviada como `owner-only` e passada a `anyone` ao aprovar | Passa: aprovar é mudar a visibilidade do upload set (passo 13) |
| Crédito por foto (autor diferente da conta de serviço) | Não passa: o Panoramax mostra sempre `pictures` como produtor. Fica a alternativa: crédito no VoltFrame e no XMP das cópias em `pictures.*`; a etiqueta `pictures\|author=` continua |
| Custo mensal dentro dos 10 € (com Cloudflare) | Por medir. Se passar, VPS pequena com o Docker Compose do Panoramax |

## Fontes de postos existentes

A lista de postos válidos vem do NAP (fonte oficial). No snapshot de 2026-11-21 do NAP dashboard havia **8 862 locais e 19 693 pontos** ([network-census.json](https://github.com/CarregaErvilhas/nap-dashboard/blob/main/network-census.json)).

**Sincronização.** O VoltFrame lê o `ohmigo_chargers.json` que o NAP dashboard já publica (o mesmo que o site e o ohmigo usam) num cron diário no próprio repo, e faz *upsert* na D1: postos novos entram como `active`, postos que desaparecem passam a `missing_from_nap` (nunca são apagados, para os links e as fotos continuarem a funcionar). Não há um `sites.json` novo nem token de importação.

O que falta no `ohmigo_chargers.json` acrescenta-se lá, no NAP dashboard:

- **`evse` em cada ponto**: o código EVSE do NAP tal como vem (`PT*EDP*E*LSB*90050*01`), tirado do inventário estático. Hoje os pontos só têm o ID do MOBI.Data (`AMD-00051-1`). Pontos sem código EVSE do NAP não têm link de tomada.
- Outros campos que o VoltFrame precise (morada já existe; confirmar o resto ao implementar).

**Chave dos links.** O posto usa o `id` do local (`EZC-AMD-00051`: prefixo do operador + código), que é único e é o formato `OPC-XXXXXXXXXX` do Alexandre. A tomada usa o código EVSE do NAP sem os `*`.

**Fotos que já existem.** As fotos que a comunidade já pôs no OSM (`panoramax=`, `wikimedia_commons=`, `mapillary=`, `image=`; o MapComplete grava-as no Panoramax dele) e que o `charger_photos.py` do NAP dashboard já recolhe **ficam só referenciadas**, com o autor e a licença de origem. Aparecem na galeria do posto e na API, com o link para a origem, mas **não podem ser a foto principal** (ver *Fotos externas e links estáticos*).

**Armadilhas de IDs** (do [gotchas.md](https://github.com/CarregaErvilhas/nap-dashboard/blob/main/references/gotchas.md) do NAP dashboard):

- Juntar pelo `site_external_id` do NAP. O `point_external_id` (`PT*op*[E]*reg*num*tom`) não é fiável: às vezes traz `ELSB` em vez de `LSB` e tem entre 3 e 7 segmentos.
- Os EVSE do MOBI.Data aparecem em vários formatos (`ABF-00011-01`, `PT-EDP-EABF-00008-1`) e centenas são só números (`97`).
- O `ref:EU:EVSE` do OSM está rigorosamente igual ao código EVSE do NAP, por isso a junção faz-se pelo código tal como vem, sem normalizar nem tirar zeros à esquerda.

**Mudanças de código (re-key).** O NAP às vezes muda o código de um local. Quando isso acontece, o posto antigo fica `missing_from_nap` com as fotos. O admin tem uma lista "postos com fotos que saíram do NAP"; um moderador escreve o código novo e o link antigo passa a responder `301` para o novo. Sem sugestões automáticas.

## Modelo de dados (D1)

As imagens vivem no Panoramax (originais e tamanhos) e, para as fotos principais, no bucket `pictures`. A D1 guarda metadados, a ligação a postos e tomadas e as escolhas.

| Tabela | Colunas principais | Notas |
| --- | --- | --- |
| `stations` | `id` (PK, ex. `EZC-AMD-00051`), `code`, `opc`, `name`, `address`, `municipality`, `lat`, `lon`, `source` (`nap`, `community`), `status` (`active`, `missing_from_nap`, `pending_review`, `rejected`), `osm_ref`, `updated_at` | Importada do `ohmigo_chargers.json`; `community` = proposto por utilizador |
| `station_aliases` | `old_id` (PK), `new_id` (FK), `created_by`, `created_at` | Re-keys do NAP, só à mão; o link antigo responde `301` |
| `evses` | `station_id` (FK) + `point_id` (PK), `evse_id` (forma original com `*`), `evse_compact` (sem `*`), nenhum dos dois único: o NAP não o garante e já houve códigos repetidos entre postos (índice simples em `evse_compact`), `connector`, `max_kw`, `dc`, `status` | Uma linha por ponto/tomada. O `point_id` do MOBI.Data repete-se entre postos; o `evse_id` vem do `evse` do feed e fica vazio quando o NAP não o tem |
| `photos` | `id` (UUID), `panoramax_id`, `origin` (`pictures`, `osm_panoramax`, `commons`, `mapillary`), `station_id`, `evse_id` (nulo = foto geral), `uploader_id`, `taken_at`, `exif_lat`, `exif_lon`, `distance_m`, `license`, `credit`, `status` (`pending`, `published`, `hidden`, `removed`), `approved_by`, `created_at` | GPS do EXIF guardado só para moderação, nunca publicado. Fotos externas: só referência |
| `selections` | `target` (PK: `id` do posto ou EVSE compacto), `photo_id`, `chosen_by`, `chosen_at`, `published_at` | Qual foto o link estático serve; ver *Links estáticos* |
| `users` | `id`, `osm_uid`, `osm_name`, `pseudonym` (opcional), `role` (`contributor`, `trusted`, `moderator`, `admin`), `ranking_opt_out`, `promoted_by`, `promoted_at`, `license_accepted_at`, `created_at` | Sem email |
| `review_queue` | `id`, `kind` (`new_station`, `photo`, `takedown`), `payload` (JSON), `submitted_by`, `status`, `decided_by`, `decided_at`, `note` | Fila única para tudo o que precisa de um humano |
| `points` | `user_id`, `photo_id`, `points`, `reason` (`approved`, `first_photo`, `refresh`), `month` | Ver *Gamificação* |
| `osm_edits` | `osm_element`, `key`, `value`, `photo_id`, `changeset`, `written_at` | O que o bot escreveu no OSM, para só alterar valores dele |

Sessões e *tokens* de API ficam no KV ou numa tabela própria (só o hash dos *tokens*).

Regras:

- Um `photo_id` em `selections` tem de pertencer ao mesmo posto ou EVSE (verificado no Worker).
- Quando não há seleção explícita, a primeira foto aprovada de um alvo passa a principal.
- Apagar uma foto = `status=removed`, apagar no Panoramax e, se for principal, apagar as cópias em `pictures`; o registo fica para auditoria.

## Fluxo de upload

Tudo o que envolve a foto original acontece no browser: lê-se o EXIF, desfoca-se e re-codifica-se antes do envio. O servidor nunca recebe o original nem os metadados.

1. **Entrar com OSM.** Na primeira vez, aceitar os termos e a licença (`license_accepted_at`).
2. **Escolher fotos.** Aceita JPEG e HEIC. O Safari descodifica HEIC nativamente; nos outros browsers usa-se `heic2any` (libheif em WebAssembly).
3. **Ler o EXIF antes de mexer na imagem** com a biblioteca [`exifr`](https://github.com/MikeKovarik/exifr): `GPSLatitude`/`GPSLongitude`, `DateTimeOriginal` e `Orientation`.
4. **Sugerir o posto.** Com GPS, a página pede ao Worker os postos num raio de 500 m, ordenados pela distância, e pré-seleciona o mais próximo. Sem GPS, pesquisa por código, morada ou mapa.
5. **Associar a posto ou tomada.** "Foto geral do posto" ou uma tomada concreta da lista de EVSE desse posto.
6. **Posto não existe?** Formulário "novo posto": nome, operador, coordenadas (pré-preenchidas pelo GPS) e código se for conhecido. Cria `stations.status=pending_review` e uma entrada em `review_queue`.
7. **Desfocar caras e matrículas** no browser, com revisão manual das caixas e a confirmação "Não há caras nem matrículas legíveis".
8. **Rodar, redimensionar e limpar.** Aplica-se a `Orientation` e re-codifica-se num `<canvas>` para 2048 px (mestre), 1024 px e 400 px, JPEG qualidade ~0,85. A re-codificação descarta todo o EXIF. Não é opcional: o Panoramax guarda o ficheiro recebido tal como vem e serve-o como `hd.jpg`.
9. **Enviar.** `POST /api/v1/photos` com as três imagens e um JSON: alvo, `taken_at`, `exif_lat`/`exif_lon`.
10. **Validar no Worker.** Sessão, limite de envios (50 fotos/dia para `contributor`), Turnstile, alvo existente, nenhum segmento APP1/EXIF nos bytes, `distance_m` ao posto.
11. **Enviar para o Panoramax** com a conta de serviço: `POST /api/upload_sets`, depois `.../files` com a mestre de 2048 px, as coordenadas do posto, a data do EXIF, `isBlurred=true` e as etiquetas (`osm|ref:EU:EVSE=…`, `pictures|site=…`, `pictures|author=…`), e `.../complete`. Visibilidade `owner-only` até ser aprovada. As versões de 1024 e 400 px ficam num bucket R2 privado (`pictures-staging`) até à aprovação.
12. **Publicar ou rever.**
    - Conta `trusted` (promovida à mão), posto `active` e dentro de 300 m → aprovada logo.
    - Conta `contributor` → sempre `pending`, à espera de um moderador. Todas as contas novas começam aqui.
    - Sem GPS, a mais de 300 m ou com posto novo → `pending` mesmo para `trusted`. Estes sinais também ordenam a fila e aparecem como avisos.
13. **Ao aprovar.** O Worker passa o upload set a `anyone` no Panoramax (`PATCH /api/upload_sets/<id>` com `{"visibility": "anyone"}`; a visibilidade da foto sozinha não chega, porque vale a mais restritiva entre foto e coleção), marca-a `published`, atribui os pontos e, se o alvo não tinha principal, publica-a em `pictures` (ver *Links estáticos*).

**O que se faz com a localização do EXIF**

- Sugere o posto e evita fotos no posto errado.
- Sinaliza discrepâncias: uma foto a 2 km do posto vai para revisão.
- Ajuda a corrigir coordenadas: se várias fotos de pessoas diferentes concordam entre si e divergem do NAP, gera-se uma pista para reportar ao OPC ou corrigir no OSM.
- Fica só na D1, visível para moderadores; a API pública mostra a data, nunca as coordenadas de quem tirou a foto.
- O Panoramax é um mapa de fotos e pede coordenadas: recebe as **coordenadas do posto**, nunca as do EXIF, para manter a regra de nunca publicar o GPS de quem tirou a foto.

## Links estáticos

O URL é o ID e nunca muda. A resolução código → foto acontece **na escrita, não no pedido**: quando a foto principal muda, o Worker copia-a para a chave pública no bucket `pictures` e faz *purge* desse URL na cache.

| URL (`pictures.ocarroeletrico.com`) | Devolve |
| --- | --- |
| `/EZC-AMD-00051.jpg` | Foto principal do posto (1024 px) |
| `/EZC-AMD-00051.thumb.jpg` | 400 px |
| `/EZC-AMD-00051.full.jpg` | 2048 px |
| `/PTTRKEVNT0000501.jpg` (e `.thumb.jpg`, `.full.jpg`) | Foto principal da tomada |

Notas:

- **Sem query strings.** O R2 ignora-as, por isso cada tamanho tem a sua chave.
- **Galerias e metadados** ficam na API: `voltframe.ocarroeletrico.com/api/v1/stations/{id}`.
- **Sem foto:** o R2 responde `404`, para cada app decidir o que mostrar.
- **Re-keys:** o `301` do código antigo é uma regra de redirect da Cloudflare gerada a partir de `station_aliases`.
- **Cache:** `Cache-Control: public, max-age=86400` em cada objeto; Edge TTL de 30 dias e `404` de 1 h na Cache Rule, sem query strings na chave; *purge* ao mudar a principal (também na primeira foto, por causa do `404` em cache). No pior caso, um browser mostra a foto antiga durante 24 h. Configuração em [`cloudflare.md`](cloudflare.md).
- **Atribuição:** o R2 não devolve cabeçalhos próprios, por isso o autor e a licença vão no **XMP/IPTC** da cópia pública (sem GPS), escritos pelo Worker ao publicar. O crédito completo fica em `voltframe.ocarroeletrico.com/p/{photo_id}`, que a CC BY-SA exige.
- **Fotos externas** (MapComplete, Commons): só na galeria, nunca a principal. Ver abaixo.

### Fotos externas e links estáticos

**Caso de uso.** Um posto tem uma foto que alguém pôs no OSM (pelo MapComplete, guardada no Panoramax deles) ou no Commons, mas ninguém a enviou pelo VoltFrame. O NAP dashboard já a mostra. O link estático `pictures.ocarroeletrico.com/<id>.jpg`, porém, só serve ficheiros que estejam no bucket: o `pictures.*` não tem Worker e não faz redirects.

**Em comum às duas opções.** O cron diário lê as fotos que o `charger_photos.py` do NAP dashboard já recolhe do OSM (com autor, licença e miniatura) e guarda-as em `photos` com `origin=osm_panoramax` ou `commons`, só como referência. A API mostra-as com o link para a origem. As do Mapillary ficam de fora (a API deles pede uma chave).

**B — só na galeria (decidido).**

- As externas aparecem na página do posto e na API, mas nunca são a principal.
- O link estático só existe para fotos enviadas pelo VoltFrame.
- A favor: sem cópias de fotos de terceiros, sem sincronizar remoções.
- Contra: no início, muitos postos que já têm foto noutro lado dão `404` no link estático.

**A — copiar quando é escolhida como principal (para discutir mais tarde).**

- O Worker vai buscar a imagem à origem (2048 px do Panoramax, ou a miniatura do Commons) e grava as três chaves em `pictures`, com o crédito do autor original no XMP.
- A favor: o link estático cobre logo todos os postos que já têm foto.
- Contra: guardamos cópias de fotos de outras pessoas (a licença permite-o com crédito). Se a foto sair da origem (o autor apaga-a ou há um pedido de remoção lá), o cron diário tem de o detetar e apagar a cópia.

Outras alternativas a procurar: por exemplo, convidar o autor a reenviar a foto pelo VoltFrame, ou um host separado com Worker que faça redirect para a origem (sem cópia, mas com o custo de pedidos dos Workers).

## OSM

- **Etiqueta:** só `panoramax=<uuid>`, que aponta para a foto no nosso servidor Panoramax (as imagens vêm do bucket R2 `panoramax`). O `osm_tags.photo_refs()` do NAP dashboard já a lê. Os links de `pictures.*` são para apps e mapas fora do OSM.
- **Que fotos:** só a principal de cada elemento. Promover outra foto torna-a a principal.
- **Bot** (`pictures_bot`, fase 3), segundo o [código de conduta das edições automáticas](https://wiki.openstreetmap.org/wiki/Automated_Edits_code_of_conduct):
  - conta dedicada, um *changeset* por dia, com etiquetas que o descrevem;
  - só em elementos já ligados por `ref` ou `ref:EU:EVSE`; a foto de uma tomada vai para o ponto `man_made=charge_point`, se existir;
  - só acrescenta; substitui apenas valores que ele próprio escreveu (registados em `osm_edits`). Se o elemento já tem outro `panoramax=`, a nova vai para a chave numerada seguinte (confirmar a convenção que o MapComplete usa);
  - desligado até a comunidade aprovar. A aprovação não é opcional: sem ela, a conta pode ser bloqueada e as edições revertidas. Por isso a conversa começa já na fase 1.
- **Manual:** depois de aprovada, a página da foto oferece um link "acrescentar ao OSM" para quem mapeia, sem precisar de aprovação nenhuma.

## Ligação ao NAP dashboard e ao ohmigo

Na fase 3, o refresh do NAP dashboard lê a exportação `voltframe.ocarroeletrico.com/api/v1/photos.json` como uma fonte nova do `charger_photos.py`, incluindo as fotos por tomada. As miniaturas continuam a ser copiadas para `/photos/` do próprio site, para o browser de quem lê não pedir nada a terceiros. O ohmigo recebe-as pelo `ohmigo_chargers.json`. Antes disso, as fotos do VoltFrame podem chegar pelo OSM (`panoramax=`), mas o `charger_photos.py` só resolve UUIDs pela pesquisa federada (`api.panoramax.xyz`): até o servidor entrar na federação, é preciso que também pergunte a `panoramax.ocarroeletrico.com/api` (tarefa da fase 2).

## API, MCP e llms.txt

Há uma única camada de serviço no Worker (`searchStations`, `getStation`, `submitPhoto`…) e três portas para ela: a página web, a API REST e o servidor MCP. Assim as regras (validação, licença, desfocagem, moderação) são as mesmas para pessoas e para agentes.

### API REST (`/api/v1`)

Descrita em OpenAPI 3.1 em `/api/v1/openapi.json`. Os `GET` são públicos e têm CORS aberto; as escritas pedem sessão ou token.

| Método e rota | Faz | Auth |
| --- | --- | --- |
| `GET /stations?q=&lat=&lon=&radius=&opc=&has_photo=` | Pesquisa por texto, proximidade, operador ou falta de foto | — |
| `GET /stations/{id}` | Posto, EVSE, fotos, links estáticos e galeria | — |
| `GET /evses/{evse_id}` | Tomada e as suas fotos (com ou sem os `*`) | — |
| `GET /photos/{id}` | Metadados: autor, licença, data, URLs | — |
| `GET /photos.json` | Exportação diária completa | — |
| `GET /ranking?period=month\|all` | Top de contribuidores | — |
| `POST /photos` | Envio (multipart: imagens + JSON de metadados) | `photos:write` |
| `PUT /selections/{target}` | Escolher a foto principal de um posto ou tomada | `trusted` |
| `POST /stations` | Propor posto novo (vai para a fila) | `photos:write` |
| `DELETE /photos/{id}` | Retirar uma foto (autor ou moderador) | sessão/token |
| `POST /takedown` | Pedido de remoção por privacidade, sem login | Turnstile |

**Tokens para scripts e agentes** (fase 3). Cada utilizador gera *personal access tokens* na sua página, com âmbitos (`photos:read`, `photos:write`, `selections:write`) e validade. Envio com `Authorization: Bearer <token>`. Na D1 guarda-se só o hash. Os limites de envio são os da conta, não do token.

**Envio pela API:** só `mode=clean`. O cliente já desfocou e tirou o EXIF, e manda as coordenadas e a data no JSON; o Worker confirma que não há EXIF nos bytes. A foto fica `pending` salvo se a conta for `trusted`. Um `mode=raw` (o servidor desfoca) só existe se a desfocagem no servidor vier a existir.

### Servidor MCP (`/mcp`)

Servidor MCP remoto no mesmo Worker, com o transporte *Streamable HTTP*. A Cloudflare dá o `McpAgent` (Agents SDK) e o `workers-oauth-provider` para o OAuth que os clientes MCP esperam ([guia](https://developers.cloudflare.com/agents/guides/build-mcp-server)). O OAuth do MCP reutiliza o login OSM: o utilizador autoriza o agente uma vez e o token herda o papel da conta. Nome do servidor: `pictures`.

| Ferramenta | Faz | Auth |
| --- | --- | --- |
| `search_stations` | Por texto, coordenadas e raio, operador ou `has_photo=false` | — |
| `get_station` | Posto, EVSE, fotos e links | — |
| `get_photo_link` | Link estático de um posto ou tomada (com tamanho) e a atribuição pronta a colar | — |
| `list_missing_photos` | Postos ou tomadas sem foto num concelho ou operador, para campanhas | — |
| `submit_photo` | Envio a partir de URL ou base64, em `mode=clean` | `photos:write` |
| `propose_station` | Posto novo para revisão | `photos:write` |
| `set_primary_photo` | Escolher a foto principal | `moderator` |

As ferramentas de leitura funcionam sem login, para qualquer assistente poder mostrar fotos de um posto. O ohmigo pode incluir o link estático de cada posto nas respostas; não é preciso juntar os dois servidores.

### llms.txt

Um `/llms.txt` em Markdown, segundo a [proposta](https://llmstxt.org/), e o cabeçalho `Link: </llms.txt>; rel="describedby"; type="text/markdown"` nas páginas HTML. Conteúdo proposto:

```markdown
# pIcŧU/Re — fotos dos postos de carregamento (Portugal)

> Fotos comunitárias de postos e tomadas de carregamento em Portugal, com links estáticos pelo código do posto (ex. EZC-AMD-00051) ou pelo EVSE (ex. PTTRKEVNT0000501) em https://pictures.ocarroeletrico.com. Fotos sob CC BY-SA 4.0; atribuição obrigatória.

## Usar

- [Links estáticos](https://voltframe.ocarroeletrico.com/docs/links.md): formato dos URLs, tamanhos, código EVSE
- [API REST](https://voltframe.ocarroeletrico.com/api/v1/openapi.json): OpenAPI 3.1
- [Servidor MCP](https://voltframe.ocarroeletrico.com/docs/mcp.md): https://voltframe.ocarroeletrico.com/mcp, ferramentas e autenticação
- [Licença e atribuição](https://voltframe.ocarroeletrico.com/docs/licenca.md)

## Contribuir

- [Enviar fotos](https://voltframe.ocarroeletrico.com/docs/enviar.md): regras de privacidade, desfocagem, moderação
- [Tokens de API](https://voltframe.ocarroeletrico.com/docs/tokens.md)

## Optional

- [Exportação completa](https://voltframe.ocarroeletrico.com/api/v1/photos.json)
- [Servidor Panoramax](https://panoramax.ocarroeletrico.com/)
```

Cada página de `docs/` existe também em `.md`, que é o que a proposta pede para os links do `llms.txt`.

## Autenticação

**Só login com conta OpenStreetMap (OAuth2)**, no `voltframe.*`. Ler as fotos e a API é público; só o envio e a moderação pedem login. GitHub fica para depois, se alguém o pedir: a maior parte da comunidade EV não tem conta lá.

OSM OAuth2: Authorization Code + PKCE em `openstreetmap.org/oauth2/authorize`; só o âmbito `read_prefs`; depois `GET /api/0.6/user/details.json` dá o ID e o nome. Não dá email. Nunca se pede `write_api` aos contribuidores: as edições no OSM são do bot ou manuais.

**O que é preciso implementar**

1. Registar a aplicação em `openstreetmap.org/oauth2/applications`, com `display_name` "pIcŧU/Re" e o redirect `https://voltframe.ocarroeletrico.com/auth/osm/callback`.
2. Guardar `CLIENT_ID`/`CLIENT_SECRET` e o token da conta de serviço do Panoramax como *secrets* do Worker (`wrangler secret put`).
3. Rotas no Worker: `/auth/osm/login` (gera `state` e `code_verifier` e guarda-os num cookie curto), `/auth/osm/callback` (troca o código, lê `user/details`, cria ou atualiza `users`), `/auth/logout`.
4. Sessão: cookie `HttpOnly; Secure; SameSite=Lax` com um ID aleatório, só em `voltframe.*`; a sessão fica na D1 ou no KV, com validade de 30 dias. O token do OSM não se guarda.
5. Proteção: Cloudflare Turnstile no formulário de upload, limite de envios por utilizador (50 fotos/dia para `contributor`) e verificação de CSRF nos `POST`.
6. Painéis `/admin` (fila de revisão, remoções, postos fora do NAP) atrás de Cloudflare Access, além do papel `moderator` na D1: duas camadas para a parte sensível.

**Papéis**

| Papel | Pode |
| --- | --- |
| `contributor` | Papel de todas as contas novas. Enviar fotos e propor postos; tudo fica `pending` até um moderador aprovar |
| `trusted` | Publicar direto, escolher a foto principal de um posto ou tomada |
| `moderator` | Aprovar ou rejeitar a fila, ocultar fotos, tratar pedidos de remoção, promover a `trusted`, criar aliases de postos |
| `admin` | Gerir moderadores, importações e configuração |

**Sem promoção automática.** Todos os contribuidores ficam moderados até um moderador ou admin os promover manualmente a `trusted`. A promoção fica registada (`promoted_by`, `promoted_at`) e pode ser revertida.

**Crédito.** Por defeito, o nome OSM. Na página de perfil, a pessoa pode escrever um pseudónimo, que passa a ser o crédito em todo o lado (VoltFrame, etiqueta no Panoramax, XMP). Mudar o crédito volta a publicar as cópias em `pictures`. O `uploader_id` fica sempre, para a moderação.

## Desfocagem de caras e matrículas

**No browser, para já.** ONNX Runtime Web ou MediaPipe corre um detetor de caras e matrículas no telemóvel e desfoca no `<canvas>`. Há sempre um editor de retângulos: o utilizador confirma, acrescenta ou remove zonas antes de enviar. O original nunca sai do telemóvel, e o envio para o Panoramax vai com `isBlurred=true`.

- **Caras:** MediaPipe Face Detector (Apache 2.0).
- **Matrículas:** modelo por escolher, com pesos de licença permissiva. Os YOLO da Ultralytics são AGPL-3.0, por isso não servem para distribuir no browser. Matrículas de carros a carregar são o caso comum; vale a pena dar prioridade a este detetor.
- **Abuso:** um cliente alterado pode enviar fotos sem desfocar. A mitigação: só publicam direto os `trusted`, promovidos à mão; o resto passa pela fila.

**No servidor, mais tarde (fase 4).** O Panoramax liga-se a um serviço de desfocagem por `API_BLUR_URL`; o de produção é o [sgblur](https://gitlab.com/panoramax/server/sgblur) (código MIT, modelo YOLOv11 para caras e matrículas). A deteção pede uma GPU NVIDIA (a CPU não é recomendada em produção) e a imagem Docker tem cerca de 7 GB. O Zerops não tem GPU. Falta encontrar uma forma barata de o correr em escala (GPU à hora, Cloudflare, ou outro fornecedor) antes de o ligar.

## Gamificação

Um ranking simples no site, para incentivar fotos novas e cobrir o que falta.

- **Pontos**, só para fotos aprovadas:
  - 1 ponto por foto aprovada;
  - +3 pela primeira foto de um posto ou tomada;
  - +2 por substituir uma foto principal com mais de 12 meses;
  - a mesma pessoa no mesmo alvo dentro de 30 dias conta uma vez.
- **Ranking:** top 5 do mês na página inicial e uma página "desde sempre".
- **Nome:** o crédito da pessoa (nome OSM ou pseudónimo). Opção no perfil para sair do ranking; as fotos continuam a contar pontos.
- **Prémios:** só medalhas no site, sem prémios. Prémios convidam a fazer batota e um sorteio pode cair nas regras dos sorteios promocionais.

## Licença, RGPD e moderação

**Licença das fotos.** Segue o modelo do Panoramax da OSM França: **CC BY-SA 4.0** para as fotos e derivados fotográficos, com autorização adicional para criar dados não fotográficos sob CC BY 4.0 ou ODbL ([wiki](https://wiki.openstreetmap.org/wiki/FR:Panoramax)). Sem essa autorização, a CC BY-SA sozinha não permite usar as fotos para melhorar o OSM. O uploader aceita isto uma vez (`license_accepted_at`) e declara que tirou a foto. Fotos referenciadas do OSM ou do Commons mantêm a licença e o autor de origem.

**Código.** MIT (`LICENSE`), a mesma do Panoramax, para qualquer pessoa poder montar uma cópia. O nome e a mascote ficam de fora, como nos outros sites do grupo: um fork precisa de nome e imagem próprios. Resumo em `Docs/licenca.md`.

**RGPD**

- **Responsável:** Fernando.
- **Dados de quem envia:** ID e nome do OSM, pseudónimo opcional, papel e GPS das fotos. Sem email.
- **Pessoas e matrículas nas fotos:** desfocagem obrigatória e caixa a confirmar no envio.
- **Pedidos de remoção:** formulário público `/takedown` (sem login, com Turnstile). A foto fica `hidden` de imediato (no VoltFrame, no Panoramax e em `pictures`) e um moderador decide em **72 h**.
- **Política de privacidade** publicada no site, com o responsável identificado.
- **Conservação:** o GPS fica na D1 só para moderação; as versões em `pictures-staging` apagam-se ao aprovar ou rejeitar; logs com retenção curta.

**Moderação**

- Fila única (`review_queue`) com três tipos: posto novo, foto pendente e remoção.
- Todos os envios de contas `contributor` passam pela fila; só `trusted` (promovidos à mão) publicam direto.
- Critérios de rejeição: posto errado, privacidade, qualidade (desfocada, escura), duplicado, publicidade.
- Histórico de decisões visível para moderadores; o autor recebe o motivo na sua página.
- Moderadores: só o Fernando no lançamento; a lista de moderadores da comunidade vem depois. Com um só moderador, o prazo de 72 h depende de ele estar disponível; como a foto fica oculta logo, o risco é atraso, não exposição.

## Custos, fases e questões em aberto

**Custos.** Orçamento: **10 €/mês** no total.

- **Panoramax no Zerops** (API, *workers*, PostgreSQL): o custo fixo maior, ainda por medir (ponto 6 do ensaio). Em repouso usa os mínimos (0,5 GB de RAM e 0,06 de 1 CPU no `pano`) e o pico de 20 fotos ficou abaixo de 1 GB. Se passar o orçamento, VPS pequena.
- **R2:** com 100k fotos, ~100 GB no bucket `panoramax` (mestre e tamanhos) e ~25 GB em `pictures` (só as principais, três tamanhos), ~1,7 $/mês: 10 GB-mês grátis e depois 0,015 $/GB-mês, sem custos de tráfego ([preços R2](https://developers.cloudflare.com/r2/pricing)). As leituras de `pictures.*` são Classe B (10 milhões grátis por mês).
- **Workers e D1:** plano grátis. Como as fotos não passam pelo Worker, o limite de 100 000 pedidos/dia só conta para o site e a API em `voltframe.*`. Workers Paid (5 $/mês) só se o site ou a API o pedirem.

**Fases**

1. **Panoramax.** Feito: ensaio e servidor em produção, fora da federação (falta só o custo). Falta começar a conversa com a OSM Portugal e a equipa do Panoramax (proposta no fórum da comunidade OSM, categoria Portugal, e no fórum do Panoramax).
2. **O site para pessoas.** Importação diária do `ohmigo_chargers.json` (com o `evse` novo), login OSM, página de envio com desfocagem no browser, fila de moderação com promoção manual, página do posto, foto principal e links estáticos em `pictures.*`, aliases de postos, ranking e medalhas, API `GET`, `llms.txt`, link manual "acrescentar ao OSM". Entrada na federação depois da conversa com a comunidade.
3. **Bot e agentes.** Bot do OSM (depois da aprovação da comunidade), servidor MCP, escrita pela API com tokens, exportação `photos.json` lida pelo NAP dashboard e pelo ohmigo, listas de postos sem foto.
4. **Desfocagem no servidor**, quando houver uma GPU a um custo razoável.

**Questões em aberto**

- [ ] Lista de moderadores da comunidade.
- [ ] Como correr a desfocagem no servidor com GPU de forma barata, em escala.
- [ ] Modelo de deteção de matrículas para o browser, com pesos de licença permissiva.
- [ ] Resposta da OSM Portugal e da equipa do Panoramax (federação, nome, bot).
- [ ] Convenção do MapComplete para várias fotos no mesmo elemento (`panoramax:1=`?).
- [ ] Custo mensal do Panoramax no Zerops (o único ponto do ensaio por fechar).
- [ ] Fotos externas e links estáticos: rever a opção B (em uso) contra a A ou outras alternativas.
