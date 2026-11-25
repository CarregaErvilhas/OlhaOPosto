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
  "takedown": "https://olhaoposto.ocarroeletrico.com/takedown?alvo=EZC-AMD-00051"
}
```

- `maxPx` é o lado maior, não a largura: a foto mantém a proporção.
- `attribution` é o texto pronto a colar ao lado da foto (a licença pede o
  crédito); é o mesmo que vai no XMP de cada ficheiro.
- `page` é a página do posto (com `#t-<tomada>` numa tomada); `panoramax`
  pode ser `null`; `takedown` abre o formulário de remoção já preenchido.
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

### `POST /takedown`

O formulário público de remoção (`/takedown`), não é uma API JSON: campos
`alvo`, `motivo` (`face`, `plate`, `property`, `other`), `detalhes`,
`contacto` e o `cf-turnstile-response` do widget, mesma origem. Responde
`303` de volta ao formulário. Ver [`cloudflare.md`](cloudflare.md),
*Pedidos de remoção*.

## Ainda por implementar

OpenAPI 3.1 (`/api/v1/openapi.json`), `GET /photos/{id}`, `GET /photos.json`,
`POST /stations`, `DELETE /photos/{id}`, tokens Bearer e
servidor MCP (`/mcp`). Ver [`plan.md`](plan.md).