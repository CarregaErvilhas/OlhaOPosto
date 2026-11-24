# Cloudflare — recursos do VoltFrame

Zona `ocarroeletrico.com`, na conta Cloudflare existente. O
servidor Panoramax (Zerops, bucket `panoramax`, DNS do `panoramax.*`) está em
[`infra.md`](infra.md). O design está em [`plan.md`](plan.md), secções *Nomes
e domínios* e *Links estáticos*.

## 1. Estado

| O quê | Estado |
| --- | --- |
| R2 `pictures` | Criado (WEUR), público em `pictures.ocarroeletrico.com`, vazio |
| R2 `pictures-staging` | Criado (WEUR), privado, vazio |
| Cache Rule do `pictures.*` | Aplicada e testada |
| D1 `pictures` | Criada, jurisdição EU; migração aplicada e primeiro import feito (8 876 postos, 19 737 pontos) |
| Worker `pictures` em `voltframe.ocarroeletrico.com` | Publicado (API de postos só de leitura) |
| Import diário dos postos | Workflow `import-stations.yml`, ativo; segredos do repositório postos |

## 2. R2

| Bucket | Acesso | Para quê |
| --- | --- | --- |
| `pictures` | Público só pelo custom domain `pictures.ocarroeletrico.com`; `r2.dev` desligado | Links estáticos: as três chaves de cada foto principal |
| `pictures-staging` | Privado: sem domínio, `r2.dev` desligado | Versões de 1024 e 400 px até à aprovação |
| `panoramax` | Privado ([`infra.md`](infra.md), secção 5) | Armazenamento do Panoramax |

O `pictures-staging` tem de ser um bucket à parte, não um prefixo em
`pictures`: tudo o que está em `pictures` fica público pelo domínio.

## 3. `pictures.ocarroeletrico.com`

**Custom domain.** TLS mínimo **1.3**. Fica de fora quem só fala TLS 1.2:
Android 9 e mais antigos, iOS anterior ao 12.2, apps nativas do Windows 10 (Schannel, .NET Framework, PowerShell 5) e Java
ou Python com OpenSSL antigo. Se alguma app ou mapa se queixar, baixar para
1.2 com `cf r2 buckets domains custom update pictures.ocarroeletrico.com
--bucket-name pictures --min-tls 1.2`.

**Cache Rule** (fase `http_request_cache_settings` da zona, a regra
«pictures: static R2 links…», `http.host eq "pictures.ocarroeletrico.com"`):

- **Edge TTL de 30 dias**, ignorando o `Cache-Control` do objeto. A frescura
  vem da purga que o Worker faz ao mudar a foto principal, não do TTL.
- **4xx: 1 h; 5xx: não fica em cache.** Um posto sem foto dá `404` e esse
  `404` fica 1 h na cache. Ao publicar a primeira foto, o Worker tem de
  purgar o URL também, senão o link só aparece 1 h depois.
- **Browser TTL: o do objeto.** O Worker grava cada objeto com
  `Cache-Control: public, max-age=86400` (`httpMetadata.cacheControl` no
  `put`). Sem isso o browser não recebe `Cache-Control` nenhum.
- **Query strings fora da chave de cache.** `?x=1` serve a mesma cópia, por
  isso ninguém fura a cache para gerar leituras Classe B no R2.

**CORS no bucket** (`public-read`): `GET` e `HEAD` de qualquer origem,
`maxAgeSeconds` 86400. Um `<img>` não precisa disto, mas os mapas web
(MapLibre) carregam imagens por `fetch` e falham sem
`Access-Control-Allow-Origin`. Testado: com `Origin` a resposta leva `*`,
também quando vem da cache (HIT).

Verificar:

```bash
# sem foto: 404; à segunda vez, cf-cache-status: HIT
curl -sI https://pictures.ocarroeletrico.com/NAO-EXISTE.jpg | grep -iE '^(HTTP|cf-cache-status)'
# TLS 1.2 tem de ser recusado (000); o pedido normal, em 1.3, dá 404
curl -s -o /dev/null -w '%{http_code}\n' --tls-max 1.2 https://pictures.ocarroeletrico.com/NAO-EXISTE.jpg
```

Purga à mão (o Worker faz o mesmo pela API ao mudar a principal):

```bash
cf cache purge -z ocarroeletrico.com -f --body '{"files":["https://pictures.ocarroeletrico.com/<id>.jpg"]}'
```

No `cf`, os comandos que apagam ou substituem (`r2 objects delete`,
`r2 buckets cors update`) pedem `--force` quando não há terminal interativo.

## 4. Worker e D1

O código está em `worker/`. O Worker chama-se `pictures` e responde em
`voltframe.ocarroeletrico.com` (custom domain; `workers.dev` e *preview URLs*
desligados). Por agora tem:

| Pedido | Devolve |
| --- | --- |
| `GET /api/v1/stations/{id}` | Posto e pontos, com CORS e `max-age=300`. `404` para ids que não existem e para propostas ou postos rejeitados |
| `GET /api/v1/evses/{evse}` | Tomada pelo código EVSE, com ou sem os `*` (`PT*EZC*E*AMD*00051*1` ou `PTEZCEAMD000511`), e o posto a que pertence. `300` com a lista `candidates` se o código estiver em mais de um posto |
| `GET /postos/{id}` | Página do posto: tomadas com o código EVSE, links estáticos de cada tamanho para copiar, ligação ao OSM. `404` em HTML como na API |
| `GET /tomadas/{evse}` | `302` para `/postos/{id}#t-{evse}`, com a tomada marcada; uma página com a lista se o código estiver em mais de um posto. `302` e não `301`, porque um código pode mudar de posto |
| `GET /` | Página inicial provisória |
| `GET /en/`, `/en/stations/{id}`, `/en/sockets/{evse}` | As mesmas páginas em inglês. `/en/sockets/{evse}` faz `302` para `/en/stations/{id}#t-{evse}` |
| `GET /sitemap.xml` | Página inicial e todos os postos públicos, nas duas línguas, com `lastmod` (a última alteração do posto ou de uma tomada). Fica um dia na Cache API: cerca de 9 mil linhas lidas por dia e por centro de dados |
| `GET /robots.txt`, `/llms.txt` | Ficheiros estáticos em `worker/public/`. O `robots.txt` deixa entrar todos os robôs, incluindo os de IA, e aponta para o *sitemap*. O `llms.txt` descreve as páginas, a API, os links estáticos e as licenças |

As páginas são HTML feito no Worker (`src/pages.ts`), sem *framework*. Os
ficheiros de `worker/public/` (CSS, `site.js`, fontes, ícones) são *static
assets* do Worker: a Cloudflare serve-os antes de o código correr e não contam
para o limite de pedidos. O `public/_headers` dá às fontes um ano de cache
(`immutable`): uma fonte nova leva um nome de ficheiro novo. O CSS e o
`site.js` mantêm o nome, por isso vão com `no-cache`: o browser confirma-os
(ETag) em cada página e um deploy nunca junta HTML novo com CSS antigo.

**Duas línguas, URLs fixos.** As páginas em pt-PT ficam onde estavam; o
inglês vive em `/en/`. Não há redirecionamento pelo `Accept-Language` (os
robôs de pesquisa só veriam uma língua): cada página tem um link para a
outra língua, o seu próprio `canonical` e os `hreflang` das duas (`pt-PT`,
`en`, `x-default` para o pt-PT). Os textos do NAP (nomes, moradas,
operadores) não se traduzem; nas páginas em inglês vão marcados com
`lang="pt-PT"` para os leitores de ecrã. Todas as frases estão num único
dicionário em `src/pages.ts`.

**Acessibilidade.** Contraste de pelo menos 4,5:1 no texto e 3:1 nos
contornos dos botões, nos temas claro e escuro (seguem o sistema). Tamanhos
de letra em `rem` e sem tamanho no `html`, para respeitar o tamanho de letra
do browser e do sistema; a página passa a 320 px de largura com texto a
200 % sem *scroll* horizontal. Há regras para `prefers-contrast: more` e para
o modo de cores forçadas do Windows. O botão de copiar anuncia o resultado
numa região `role="status"` e troca o ícone, em vez de mudar só a cor.

**Nada de terceiros nas páginas.** As fontes (Inter, Space Grotesk, JetBrains
Mono) estão alojadas em `public/fonts/`, não no Google Fonts. A CSP só deixa
carregar ficheiros do próprio site e imagens de `pictures.*`, e não permite
*scripts* nem estilos *inline*: tudo vai em `site.css` e `site.js`. As
páginas levam também HSTS, `nosniff`, `referrer-policy` e COOP; a API leva
`x-robots-tag: noindex`, porque é para apps e agentes, não para resultados de
pesquisa.

**A D1 `pictures` está na jurisdição EU**: vai guardar dados de
utilizadores (RGPD), e a jurisdição só se escolhe ao criar a base.

**O ID da D1 não está no repositório.** O `wrangler.json` tem
`database_id: "local-only"`, que só serve para o D1 local. Os comandos
remotos passam pelo `npm run remote`, que procura o ID pelo nome com as
credenciais de quem corre, escreve uma cópia temporária da configuração
(`.wrangler.remote.json`, ignorada pelo git) e apaga-a no fim.

**Nunca correr `wrangler deploy` diretamente.** Com o *placeholder* falha.
Sem `database_id` nenhum, o wrangler criaria uma D1 nova e vazia e
escreveria o ID dela no `wrangler.json`.

Em local (sem login na Cloudflare):

```bash
cd worker
npm ci
npm test                  # testes do import
npm run db:local          # migrações na D1 local
npm run import:local      # importa o feed real para a D1 local
npm run dev               # http://localhost:8787/api/v1/stations/EZC-AMD-00051
```

Em produção, depois de `npx wrangler login`:

```bash
cd worker
npm run remote -- d1 migrations apply DB --remote
node scripts/import-stations.ts --remote      # primeiro import
npm run remote -- deploy
```

Uma migração nova aplica-se **antes** do deploy que a usa, a partir do
`main`: `npm run remote -- d1 migrations apply DB --remote` e depois
`npm run remote -- deploy`. Criar um índice escreve uma linha por linha da
tabela (cerca de 20 mil em `evses`), e isso conta para o limite diário da
D1 Free (100 mil linhas escritas): não juntar no mesmo dia com um import que
reescreva tudo.

## 5. Importação dos postos

`worker/scripts/import-stations.ts` lê o modelo da rede do NAP dashboard
(`https://nap.ocarroeletrico.com/ohmigo/chargers.json`, ~12 MB) e atualiza
`stations` e `evses`. Corre no GitHub Actions
(`.github/workflows/import-stations.yml`, todos os dias às 05:23 UTC e à mão
com *Run workflow*), não no Worker: no plano Free, um Cron Trigger tem
10 ms de CPU e só ler o JSON passa disso.

- **Só escreve o que mudou.** Lê o estado da D1, compara e grava só as
  linhas novas ou alteradas: a D1 Free conta as linhas escritas por dia. Se
  o `generatedAt` do feed é o mesmo do último import, não faz nada
  (`--force` para repetir).
- **Nunca apaga.** Postos e pontos que saem do feed passam a
  `missing_from_nap` e voltam a `active` se regressarem.
- **Só mexe nas linhas do NAP.** Um posto `community` com o mesmo id fica
  como está e aparece em *conflicts*, para um moderador decidir.
- **Trava se o feed vier partido.** Recusa quando mais de 5 % dos postos
  ativos passariam a `missing_from_nap` (`--allow-mass-missing` para
  confirmar).
- **A D1 fica indisponível uns segundos** enquanto o `--file` remoto importa
  (API de importação da D1): um pequeno soluço na API por volta das 05:23 UTC.
- **Código EVSE de cada tomada.** O feed traz em cada ponto o `evse`, o
  código EVSE do NAP tal como publicado (`PT*EDP*E*LSB*90050*01`). Fica em
  `evse_id` e, sem os `*`, em `evse_compact` (`PTEDPELSB9005001`), a forma dos
  links de tomada. A chave de `evses` continua a ser (`station_id`,
  `point_id`): o NAP não garante que o código seja único (já houve um
  operador a publicar o mesmo em dois postos, `PT*KLS*E281*1`), por isso o
  índice em `evse_compact` não é `UNIQUE`.
  O primeiro import depois de o campo aparecer reescreve todos os pontos
  (cerca de 20 mil linhas, dentro do limite diário da D1 Free).

**Segredos do repositório** (*Settings → Secrets and variables → Actions*):

| Segredo | O quê |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Token da conta só com **D1 → Edit** |
| `CLOUDFLARE_ACCOUNT_ID` | ID da conta Cloudflare |

## 6. Questões em aberto

- [x] Código EVSE do NAP no `ohmigo_chargers.json` (campo `evse` em cada ponto), para os links de tomada.
- [ ] Publicar o Worker pelo CI em vez de à mão (precisa de um token com permissões de Workers).
- [ ] Regra de ciclo de vida no `pictures-staging` como rede de segurança
  para fotos rejeitadas ou abandonadas (por exemplo 90 dias). O risco é
  apagar as versões de uma foto que ainda está na fila.
