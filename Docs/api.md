# API — `olhaoposto.ocarroeletrico.com/api/v1`

Documentação de uso da API do olh'o'posto. Atualizar sempre que uma rota
mudar ou surgir. Os `GET` são públicos, com CORS aberto (`*`) e cache de
5 minutos (salvo indicação). As escritas pedem um *token* (`Authorization: Bearer oop_…`,
criado na conta, ver *Tokens*) ou a sessão do site (*cookie*, só a partir das
páginas do próprio site).

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

### `GET /stations/{id}`

Posto e suas tomadas.

```bash
curl 'https://olhaoposto.ocarroeletrico.com/api/v1/stations/EZC-AMD-00051'
```

Resposta: `{ "id", "code", "name", "operator": { "id", "name" }, "address", "municipality", "region", "lat", "lon", "status", "osm", "photo", "points": [ { "id", "evse", "compact", "connector", "kw", "dc", "status", "photo" } ], "updatedAt" }`.

`photo` é a foto principal do posto ou da tomada, ou `null` quando não há
(ver *Objeto `photo`*, abaixo).

### `GET /evses/{evse}`

Tomada pelo código EVSE (com ou sem `*`). Se o código repetir, responde
`300` com `{ "error": "ambiguous", "candidates": [...] }`.

```bash
curl 'https://olhaoposto.ocarroeletrico.com/api/v1/evses/PTEDPELSB9005001'
```

Resposta: `{ "evse", "compact", "station": { "id", "name", "operator", "photo" }, "point": { ... }, "photo", "updatedAt" }`.
`photo` é a da tomada e `station.photo` a do posto; cada uma pode ser `null`.
Os `candidates` de um `300` têm a mesma forma.

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
- `attribution` é o texto pronto a colar ao lado da foto (a licença pede o
  crédito); é o mesmo texto do XMP de cada ficheiro, que aponta para a
  página de crédito da foto (`/p/{photo_id}`).
- `page` é a página do posto (com `#t-<tomada>` numa tomada); `panoramax`
  pode ser `null`; `report` abre o formulário de remoção já preenchido.
- Os URLs de imagem são estáveis: quando a foto principal muda, o URL
  continua o mesmo.

## Fotos principais

### `GET /main-photos`

Lista de todas as fotos principais publicadas (licença CC BY-SA 4.0), para
sites que copiem as miniaturas com o crédito (o NAP dashboard lê uma vez por
dia).

```bash
curl 'https://olhaoposto.ocarroeletrico.com/api/v1/main-photos'
```

Resposta: `{ "license": "CC-BY-SA-4.0", "photos": [ { "target", "station": { "id", "code" }, "credit", "thumb", "main", "full", "page", "panoramax", "publishedAt" } ] }`.

Os URLs de imagem apontam para `pictures.ocarroeletrico.com`.

## Ranking

### `GET /ranking?period=month|all`

Top de contribuidores (pontos). `period` opcional, por defeito `month`.

```bash
curl 'https://olhaoposto.ocarroeletrico.com/api/v1/ranking?period=month'
```

Resposta: `{ "period", "month" (só no mês, `YYYY-MM` UTC), "contributors": [ { "rank", "name", "points", "photos", "medal" } ] }`. `name` é o crédito (pseudónimo ou nome OSM), `medal` é `bronze`, `silver`, `gold` ou `null` (pelo total de sempre). Só contam fotos publicadas; quem saiu do ranking não aparece.

## Escrita

### Tokens

Quem tem sessão cria *tokens* na conta (`/conta`, `/en/account`): um nome, os
âmbitos e a validade (30, 90 ou 365 dias), até 5 ativos. O *token* só aparece
uma vez. Âmbitos:

| Âmbito | Dá acesso a | Quem o pode ter |
| --- | --- | --- |
| `photos:write` | `POST /photos`, `POST /stations` | Todas as contas |
| `selections:write` | `PUT /selections/{target}` | `trusted`, `moderator`, `admin` |

O *token* age como a conta, com o papel e os limites dela, lidos em cada
pedido. Erros: `401 sign_in_required` (*token* desconhecido, expirado ou
revogado), `403 missing_scope`. Sem *token*, a sessão só vale a partir do
próprio site (`403 cross_site`).

### `POST /photos`

Envio de uma foto (multipart). Campos: `full`, `main`, `thumb` (JPEGs dos
três tamanhos: lado maior até 2048, 1024 e 400 px, a mesma imagem, já
desfocados e sem nenhum metadado), `meta` (JSON com `station`, `target`,
`taken_at`, `exif_lat`, `exif_lon`, `license: true`, `no_people: true`) e, só
com a sessão do site, `turnstile`.

```bash
curl -X POST 'https://olhaoposto.ocarroeletrico.com/api/v1/photos' \
  -H 'authorization: Bearer oop_...' \
  -F full=@2048.jpg -F main=@1024.jpg -F thumb=@400.jpg \
  -F 'meta={"station":"EZC-AMD-00051","target":"PTEZCEAMD000511","taken_at":"2026-11-20T10:15:00Z","exif_lat":38.7879,"exif_lon":-9.2268,"license":true,"no_people":true}'
```

Responde `201 { "id", "status": "pending"|"published" }`. Contas `trusted`
publicam direto quando a foto foi tirada a 300 m ou menos de um posto ativo.
O GPS é só para a moderação, nunca publicado. Erros: `400 bad_photo` (EXIF ou
outro metadado, tamanho, forma), `400 bad_target`, `400 consent_required`,
`429 daily_limit` (50 por dia para contribuidores), `429 too_fast`, `409
duplicate`.

### `POST /stations`

Propor um posto que não está no NAP. Corpo JSON:
`{ "name", "operator", "code"?, "lat", "lon", "note"? }`, com a posição em
Portugal. Se houver um posto a menos de 60 m: `409 { "error":
"station_nearby", "stations": [ { "id", "name", "distance_m" } ] }`; repetir
com `?force=1` se for outro. Responde `201 { "id": "OOP-…", "status":
"pending_review" }`. O posto não é público até um moderador o aprovar; quem o
propôs já pode enviar fotos dele (`station` e `target` = o id). Limite: 5 por
dia para contribuidores.

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

O formulário público de remoção (`/report`), não é uma API JSON: campos
`alvo`, `motivo` (`face`, `plate`, `property`, `copyright`, `other`),
`detalhes` e o `cf-turnstile-response` do widget, mesma origem. Responde
`303` de volta ao formulário. O pedido vira uma denúncia no Panoramax
(`/api/reports`). Ver [`cloudflare.md`](cloudflare.md),
*Pedidos de remoção*.

## Ainda por implementar

OpenAPI 3.1 (`/api/v1/openapi.json`), `GET /photos/{id}`, `GET /photos.json`,
`DELETE /photos/{id}`, os filtros `opc` e `has_photo` na pesquisa e o
servidor MCP ([`plan.md`](plan.md)).
