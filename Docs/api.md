# API — `olhaoposto.ocarroeletrico.com/api/v1`

Documentação de uso da API do olh'o'posto. Atualizar sempre que uma rota
mudar ou surgir. Os `GET` são públicos, com CORS aberto (`*`) e cache de
5 minutos (salvo indicação). As escritas pedem sessão (cookie) ou, mais
tarde, um token Bearer.

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

Resposta: `{ "id", "code", "name", "operator": { "id", "name" }, "address", "municipality", "region", "lat", "lon", "status", "osm", "points": [ { "id", "evse", "compact", "connector", "kw", "dc", "status" } ], "updatedAt" }`.

### `GET /evses/{evse}`

Tomada pelo código EVSE (com ou sem `*`). Se o código repetir, responde
`300` com `{ "error": "ambiguous", "candidates": [...] }`.

```bash
curl 'https://olhaoposto.ocarroeletrico.com/api/v1/evses/PTEDPELSB9005001'
```

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

Resposta: lista de contribuidores com pontos, nome (pseudónimo ou nome OSM) e mês.

## Escrita

### `POST /photos`

Envio de uma foto (multipart). Campos: `full`, `main`, `thumb` (JPEGs dos
três tamanhos), `meta` (JSON com `station`, `target`, `taken_at`, `exif_lat`,
`exif_lon`, `license: true`, `no_people: true`), `turnstile` (token).

Requer sessão (cookie `__Host-oop_session`) e Turnstile. Responde `201 { "id", "status": "pending"|"published" }`. Contas `trusted` publicam direto.

### `PUT /selections/{target}`

Escolher a foto principal de um posto ou tomada. Corpo JSON: `{ "photo": "<id>" }`. A conta tem de ser `trusted`, `moderator` ou `admin`, e a foto tem de estar `published` e pertencer ao mesmo alvo.

```bash
curl -X PUT 'https://olhaoposto.ocarroeletrico.com/api/v1/selections/EZC-AMD-00051' \
  -H 'content-type: application/json' \
  -b '__Host-oop_session=...' \
  -d '{ "photo": "uuid-da-foto" }'
```

Resposta: `{ "targets": ["EZC-AMD-00051"] }`.

## Ainda por implementar

OpenAPI 3.1 (`/api/v1/openapi.json`), `GET /photos/{id}`, `GET /photos.json`,
`POST /stations`, `DELETE /photos/{id}`, `POST /takedown`, tokens Bearer e
servidor MCP (`/mcp`). Ver [`plan.md`](plan.md).