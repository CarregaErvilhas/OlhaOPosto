# API — `olhaoposto.ocarroeletrico.com/api/v1`

Documentação de uso da API do olh'o'posto. Atualizar sempre que uma rota mudar ou surgir. A descrição formal (OpenAPI 3.1) está em [`/api/v1/openapi.json`](https://olhaoposto.ocarroeletrico.com/api/v1/openapi.json); um teste garante que cada rota de `/api/v1` está lá. Os `GET` são públicos, com CORS aberto (`*`) e cache de 5 minutos (salvo indicação). As escritas pedem um *token* (`Authorization: Bearer oop_…`, criado na conta, ver *Tokens*) ou a sessão do site (*cookie*, só a partir das páginas do próprio site).

Base: `https://olhaoposto.ocarroeletrico.com/api/v1`

## Pesquisa

### `GET /stations?q=<texto>`

Pesquisa por texto (nome, morada, concelho, operador, ID).

```bash
curl 'https://olhaoposto.ocarroeletrico.com/api/v1/stations?q=EZC+AMD'
```

Resposta: `{ "q": "...", "results": [ { "id", "name", "operator": { "id", "name" }, "address", "municipality", "region", "lat", "lon", "status" } ] }`.

### `GET /stations?lat=&lon=&radius=`

Pesquisa por proximidade. `radius` em metros (1 a 50000, inteiro).

```bash
curl 'https://olhaoposto.ocarroeletrico.com/api/v1/stations?lat=38.7879&lon=-9.2268&radius=1000'
```

Resposta: `{ "lat", "lon", "radius", "results": [ { ...searchBody, "distance_m" } ] }`.

Não se pode combinar `q` com coordenadas (erro `q_or_coordinates`).

### Filtros: `opc`, `municipality`, `has_photo`

Juntam-se à pesquisa por texto e por proximidade, ou usam-se sozinhos:

| Parâmetro | Faz |
| --- | --- |
| `opc` | Só os postos deste operador (o `operator.id`, por exemplo `EZC3`; sem distinguir maiúsculas) |
| `municipality` | Só os postos deste concelho (o nome exato, sem distinguir maiúsculas) |
| `has_photo` | `true`: só postos com foto principal; `false`: só os sem foto (o link estático do posto dá `404`). Aceita também `1` e `0` |

```bash
# os postos EZC sem foto
curl 'https://olhaoposto.ocarroeletrico.com/api/v1/stations?opc=EZC3&has_photo=false&limit=50'
```

Só com filtros (sem `q` nem coordenadas) a lista vem por ordem de id, em páginas: `{ "results": [...], "next": "<id>" | null }`, e `?after=<next>` dá a página seguinte. Um filtro inválido dá `400 bad_filter`. A página [`/postos/sem-foto`](https://olhaoposto.ocarroeletrico.com/postos/sem-foto) (`/en/stations/without-photo`) mostra a mesma lista, com filtros por concelho e operador.

### `GET /stations/{id}`

Posto e suas tomadas.

```bash
curl 'https://olhaoposto.ocarroeletrico.com/api/v1/stations/EZC-AMD-00051'
```

Resposta: `{ "id", "code", "name", "operator": { "id", "name" }, "address", "municipality", "region", "lat", "lon", "status", "osm", "photo", "photos": [ ... ], "externalPhotos": [ ... ], "points": [ { "id", "evse", "compact", "connector", "kw", "dc", "status", "photo" } ], "updatedAt" }`.

`photo` é a foto principal do posto ou da tomada, ou `null` quando não há (ver *Objeto `photo`*, abaixo).

`photos` são as outras fotos enviadas pelo olh'o'posto e publicadas, as que não são principais de nada (no máximo 24): `[ { "id", "socket", "credit", "license", "attribution", "page", "thumb" } ]` (`socket` é o código EVSE compacto da tomada que a foto mostra, ou `null` para o posto em geral). Não têm link estático: `thumb` é a miniatura do Panoramax e `page` a página de crédito. Num posto sem mais fotos vem `[]`.

`externalPhotos` são as fotos que outras pessoas puseram no OSM e estão noutro sítio (Panoramax, Wikimedia Commons), no máximo 12, só como referência. Nunca são a foto principal, não têm link estático e não entram em `/main-photos`:

```json
{
  "id": "ext_7b817c1c57b3392533da706f",
  "external": true,
  "origin": "osm_panoramax",
  "thumb": "https://nap.ocarroeletrico.com/photos/5354aeece5480a4d.jpg",
  "credit": "5R-MFT",
  "license": "CC-BY-SA-4.0",
  "source": "https://api.panoramax.xyz/#focus=pic&pic=b0a380da-9b5f-43c8-8037-72d109137120",
  "takenAt": "2025-10-28"
}
```

`origin` é `osm_panoramax` ou `commons`. Quem as mostra deve dar o `credit` e a `license` e ligar a `source`. `credit` pode ser `null` e `takenAt` também.

**Postos em construção.** Um posto que o OpenStreetMap diz estar em obra e o NAP ainda não tem (id `OSM-w…` ou `OSM-n…`, o elemento OSM) traz também `"lifecycle": "construction"`, `"codes": ["ALM-00114", "ALM-00155"]` (os códigos MOBI.E que o OSM traz, pode ser vazio); em `photos` vêm todas as fotos publicadas, porque não tem principal. Não carrega: não o apresentes como sítio para carregar. Não tem tomadas, `photo` é sempre `null` e não há link estático. Quando o NAP o publica, junta-se ao posto do NAP: as fotos passam para lá e o id antigo responde `301`. Na pesquisa (`GET /stations?q=` e `?lat=&lon=`) também vêm com `lifecycle`; o `has_photo=false` deixa-os de fora.

### `GET /evses/{evse}`

Tomada pelo código EVSE (com ou sem `*`). Se o código repetir, responde `300` com `{ "error": "ambiguous", "candidates": [...] }`.

```bash
curl 'https://olhaoposto.ocarroeletrico.com/api/v1/evses/PTEDPELSB9005001'
```

Resposta: `{ "evse", "compact", "station": { "id", "name", "operator", "photo" }, "point": { ... }, "photo", "updatedAt" }`. `photo` é a da tomada e `station.photo` a do posto; cada uma pode ser `null`. Os `candidates` de um `300` têm a mesma forma.

### Objeto `photo`

```json
{
  "target": "EZC-AMD-00051",
  "credit": "Ana",
  "license": "CC-BY-SA-4.0",
  "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
  "attribution": "© Ana, CC BY-SA 4.0, via olh'o'posto",
  "sizes": {
    "thumb": { "url": "https://pictures.ocarroeletrico.com/EZC-AMD-00051.thumb.jpg", "maxPx": 400 },
    "main":  { "url": "https://pictures.ocarroeletrico.com/EZC-AMD-00051.jpg", "maxPx": 1024 },
    "full":  { "url": "https://pictures.ocarroeletrico.com/EZC-AMD-00051.full.jpg", "maxPx": 2048 }
  },
  "page": "https://olhaoposto.ocarroeletrico.com/postos/EZC-AMD-00051",
  "panoramax": "https://panoramax.ocarroeletrico.com/viewer?focus=map&map=19/…&pic=…",
  "report": "https://olhaoposto.ocarroeletrico.com/report?alvo=EZC-AMD-00051"
}
```

- `maxPx` é o lado maior, não a largura: a foto mantém a proporção.
- `attribution` é o texto pronto a colar ao lado da foto (a licença pede o crédito); é o mesmo texto do XMP de cada ficheiro, que aponta para a página de crédito da foto (`/p/{photo_id}`).
- `page` é a página do posto (com `#t-<tomada>` numa tomada); `panoramax` pode ser `null`; `report` abre o formulário de remoção já preenchido.
- Os URLs de imagem são estáveis: quando a foto principal muda, o URL continua o mesmo.

## Fotos principais

### `GET /me`

Para as páginas do próprio site: `{ "role", "moderator" }` da sessão (o *cookie*), ou `role: null` sem sessão. Nunca em cache; não lê *tokens*. A página do posto usa-o para mostrar «Moderar as fotos deste posto» a moderadores e administradores.

### `GET /main-photos`

Lista de todas as fotos principais publicadas (licença CC BY-SA 4.0), para sites que copiem as miniaturas com o crédito (o NAP dashboard lê uma vez por dia).

```bash
curl 'https://olhaoposto.ocarroeletrico.com/api/v1/main-photos'
```

Resposta: `{ "license": "CC-BY-SA-4.0", "photos": [ { "target", "station": { "id", "code" }, "credit", "thumb", "main", "full", "page", "panoramax", "publishedAt" } ] }`.

Os URLs de imagem apontam para `pictures.ocarroeletrico.com`.

## Fotos

### `GET /photos/{id}`

Uma foto: autor, licença, alvo, posto, tamanhos e id no Panoramax. O `id` é o que o `POST /photos` devolve e o que aparece em `/p/{id}`.

```bash
curl 'https://olhaoposto.ocarroeletrico.com/api/v1/photos/3f2b8d3e-0f0a-4c55-9c44-0a1c1b8d9e10'
```

```json
{
  "id": "3f2b8d3e-…",
  "origin": "olhaoposto",
  "target": "PTEZCEAMD000511",
  "socket": "PTEZCEAMD000511",
  "station": { "id": "EZC-AMD-00051", "code": "AMD-00051", "name": "…", "operator": { "id": "EZC3", "name": "…" }, "municipality": "Amadora", "lat": 38.7879, "lon": -9.2268 },
  "credit": "Ana",
  "license": "CC-BY-SA-4.0",
  "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
  "attribution": "© Ana, CC BY-SA 4.0, via olh'o'posto",
  "takenAt": "2026-11-20T10:15:00Z",
  "publishedAt": "2026-11-21T09:00:00.000Z",
  "isMain": true,
  "sizes": { "thumb": { "url": "…", "maxPx": 400 }, "main": { "url": "…", "maxPx": 1024 }, "full": { "url": "…", "maxPx": 2048 } },
  "page": "https://olhaoposto.ocarroeletrico.com/postos/EZC-AMD-00051#t-PTEZCEAMD000511",
  "creditPage": "https://olhaoposto.ocarroeletrico.com/p/3f2b8d3e-…",
  "panoramaxId": "…",
  "panoramax": "https://panoramax.ocarroeletrico.com/viewer?…",
  "report": "https://olhaoposto.ocarroeletrico.com/report?alvo=PTEZCEAMD000511"
}
```

- `target` é o posto, ou a tomada (o código sem `*`) quando a foto é de uma tomada; `socket` é `null` numa foto do posto em geral.
- `lat` e `lon` são as do posto. O GPS da própria foto nunca se publica.
- Só a foto principal tem os links estáticos de `pictures.*` e os tamanhos conhecidos. Qualquer outra foto publicada traz em `sizes` as imagens do próprio Panoramax (`thumb` e `main`, com `maxPx: null`).
- Uma foto externa não tem cópia nossa: `sizes` só tem a miniatura (`thumb`, `maxPx: null`), `sourceUrl` é onde ela vive (e onde se tratam o autor, a licença e uma remoção), e `creditPage`, `panoramax` e `report` são `null`. O `attribution` é «© autor, licença», sem «via olh'o'posto». Não se retira com o `DELETE`.
- Uma foto publicada é pública. O autor e os moderadores, com *token* ou sessão, veem também as outras fotos deles (para seguir um envio): a resposta traz `status` (`pending`, `published`, `hidden` ou `removed`) e, numa recusa, `refusal: { reason, note }`, sem links de imagem, e não fica em cache. Para os outros, essas fotos dão `404`, como um id que não existe.

### `GET /photos.json`

Exportação completa para quem reutiliza as fotos: **todas** as fotos publicadas dos postos públicos, galeria incluída (não só as principais), cada uma como no `GET /photos/{id}`. Inclui também as referências a fotos externas (Panoramax de outros autores e Commons, ligadas do OSM): distinguem-se por `origin` (`osm_panoramax` ou `commons`, em vez de `olhaoposto`). Cada foto traz a sua licença: não assumas CC BY-SA 4.0 para todas.

```bash
curl 'https://olhaoposto.ocarroeletrico.com/api/v1/photos.json'
```

Resposta: `{ "license", "licenseUrl", "count", "photos": [ … ] }`. Fica em cache um dia: lê-a uma vez por dia e larga as fotos que deixarem de vir na lista (foram removidas). Quando uma foto é removida o Worker pede o *purge* da lista, mas uma cópia noutra cache pode demorar até um dia a sair. O NAP dashboard continua a ler `/main-photos`, que é mais pequena.

## Ranking

### `GET /ranking?period=month|all`

Top de contribuidores (pontos). `period` opcional, por defeito `month`.

```bash
curl 'https://olhaoposto.ocarroeletrico.com/api/v1/ranking?period=month'
```

Resposta: `{ "period", "month" (só no mês, `YYYY-MM` UTC), "contributors": [ { "rank", "name", "points", "photos", "medal" } ] }`. `name` é o crédito (pseudónimo ou nome OSM), `medal` é `bronze`, `silver`, `gold` ou `null` (pelo total de sempre). Só contam fotos publicadas; quem saiu do ranking não aparece.

## Escrita

### Tokens

Quem tem sessão cria *tokens* na conta (`/conta`, `/en/account`): um nome, os âmbitos e a validade (30, 90 ou 365 dias), até 5 ativos. O *token* só aparece uma vez. Âmbitos:

| Âmbito | Dá acesso a | Quem o pode ter |
| --- | --- | --- |
| `photos:write` | `POST /photos`, `POST /stations`, `DELETE /photos/{id}` | Todas as contas |
| `selections:write` | `PUT /selections/{target}` | `trusted`, `moderator`, `admin` |

O *token* age como a conta, com o papel e os limites dela, lidos em cada pedido. Erros: `401 sign_in_required` (*token* desconhecido, expirado ou revogado), `403 missing_scope`. Sem *token*, a sessão só vale a partir do próprio site (`403 cross_site`).

### `POST /photos`

Envio de uma foto (multipart). Campos: `full`, `main`, `thumb` (JPEGs dos três tamanhos: lado maior até 2048, 1024 e 400 px, a mesma imagem, já desfocados e sem nenhum metadado), `meta` (JSON com `station`, `target`, `taken_at`, `exif_lat`, `exif_lon`, `license: true`, `no_people: true`) e, só com a sessão do site, `turnstile`.

```bash
curl -X POST 'https://olhaoposto.ocarroeletrico.com/api/v1/photos' \
  -H 'authorization: Bearer oop_...' \
  -F full=@2048.jpg -F main=@1024.jpg -F thumb=@400.jpg \
  -F 'meta={"station":"EZC-AMD-00051","target":"PTEZCEAMD000511","taken_at":"2026-11-20T10:15:00Z","exif_lat":38.7879,"exif_lon":-9.2268,"license":true,"no_people":true}'
```

Responde `201 { "id", "status": "pending"|"published" }`. Contas `trusted` publicam direto quando a foto foi tirada a 300 m ou menos de um posto ativo. O GPS é só para a moderação, nunca publicado. Erros: `400 bad_photo` (EXIF ou outro metadado, tamanho, forma), `400 bad_target`, `400 consent_required`, `429 daily_limit` (50 por dia para contribuidores), `429 too_fast`, `409 duplicate`.

### `DELETE /photos/{id}`

Retirar uma foto. O autor retira as suas (à espera, publicadas ou ocultas); moderadores e administradores, qualquer uma. Usa o mesmo caminho dos pedidos de remoção: as cópias saem do armazenamento, a cache é purgada, a foto sai do Panoramax, e se era a principal o posto ou a tomada fica em «Sem foto principal» até um moderador escolher outra (a seguinte nunca passa a principal sozinha). Os pontos da foto deixam de contar.

```bash
curl -X DELETE 'https://olhaoposto.ocarroeletrico.com/api/v1/photos/3f2b8d3e-…' \
  -H 'authorization: Bearer oop_...'
```

Responde `200 { "removed": true }`. Um moderador a retirar a foto de outra pessoa pode mandar um corpo JSON `{ "reason": "privacy", "note": "…" }` (`reason`: `wrong_station`, `privacy`, `quality`, `duplicate`, `advertising` ou `other`, por omissão `other`; `note` até 200 caracteres): o autor vê-os em «os meus envios» e a decisão fica no histórico. Erros: `403 forbidden` (foto pública de outra pessoa), `404 not_found` (não existe, já foi retirada, ou não é tua e não é pública), `400 bad_reason`, `502 panoramax` (o Panoramax não respondeu; não se perdeu nada, repete).

### `PUT /selections/{target}`

Escolher a foto principal de um posto ou tomada. Corpo JSON: `{ "photo": "<id>" }`. A conta tem de ser `trusted`, `moderator` ou `admin`, e a foto tem de estar `published` e pertencer ao mesmo alvo.

```bash
curl -X PUT 'https://olhaoposto.ocarroeletrico.com/api/v1/selections/EZC-AMD-00051' \
  -H 'content-type: application/json' \
  -H 'authorization: Bearer oop_...' \
  -d '{ "photo": "uuid-da-foto" }'
```

Resposta: `{ "targets": ["EZC-AMD-00051"] }` (vazia se a foto não servir para esse alvo).

### `POST /report`

O formulário público de remoção (`/report`), não é uma API JSON: campos `alvo`, `motivo` (`face`, `plate`, `property`, `copyright`, `other`), `detalhes` e o `cf-turnstile-response` do widget, mesma origem. Responde `303` de volta ao formulário. O pedido vira uma denúncia no Panoramax (`/api/reports`). Ver [`cloudflare.md`](cloudflare.md), *Pedidos de remoção*.

## Servidor MCP

As mesmas leituras e escritas, como ferramentas para assistentes de IA, em `https://olhaoposto.ocarroeletrico.com/mcp` (nome `OlhaOPosto`, *Streamable HTTP*). Ler não precisa de login; escrever pede OAuth (o cliente regista-se sozinho e a pessoa autoriza com o login OSM) ou um *token* `oop_` no `Authorization`. Ferramentas, âmbitos e regras em [`arquitetura.md`](arquitetura.md), *Servidor MCP*.

```bash
curl -s https://olhaoposto.ocarroeletrico.com/mcp \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_photo_link","arguments":{"id":"EZC-AMD-00051"}}}'
```
