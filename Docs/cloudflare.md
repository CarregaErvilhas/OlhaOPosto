# Cloudflare — recursos do VoltFrame

Zona `ocarroeletrico.com`, na conta Cloudflare existente. O
servidor Panoramax (Zerops, bucket `panoramax`, DNS do `panoramax.*`) está em
[`infra.md`](infra.md). O porquê está em [`arquitetura.md`](arquitetura.md), secções *Nomes
e domínios* e *Links estáticos*; a publicação das fotos, que falta, em
[`plan.md`](plan.md).

## 1. Estado

| O quê | Estado |
| --- | --- |
| R2 `pictures` | Criado (WEUR), público em `pictures.ocarroeletrico.com`, vazio |
| R2 `pictures-staging` | Criado (WEUR), privado, vazio; ligado ao Worker como `STAGING` |
| Cache Rule do `pictures.*` | Aplicada e testada |
| D1 `pictures` | Criada, jurisdição EU, com o import diário. Migrações `0001` a `0004` aplicadas; a `0005` (proximidade) aplica-se antes do próximo deploy |
| Worker `pictures` em `voltframe.ocarroeletrico.com` | Publicado: páginas dos postos e pesquisa em pt-PT e inglês, API só de leitura, `sitemap.xml`, política de privacidade, seletor de tema. A pesquisa por proximidade e a página de envio estão no `main` mas ainda não foram publicadas |
| Início de sessão com o OSM | Feito e desligado: faltam a aplicação no OSM e os segredos (secção 4) |
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
| `GET /api/v1/stations/{id}` | Posto e pontos (cada um com o `evse` e o `compact`, o código sem `*` que dá o nome ao link estático), com CORS e `max-age=300`. `404` para ids que não existem e para propostas ou postos rejeitados |
| `GET /api/v1/evses/{evse}` | Tomada pelo código EVSE, com ou sem os `*` (`PT*EZC*E*AMD*00051*1` ou `PTEZCEAMD000511`), e o posto a que pertence. `300` com a lista `candidates` se o código estiver em mais de um posto |
| `GET /postos/{id}` | Página do posto: tomadas com o código EVSE, links estáticos de cada tamanho para copiar, ligação ao OSM. `404` em HTML como na API |
| `GET /tomadas/{evse}` | `302` para `/postos/{id}#t-{evse}`, com a tomada marcada; uma página com a lista se o código estiver em mais de um posto. `302` e não `301`, porque um código pode mudar de posto |
| `GET /api/v1/stations?q=&limit=` | Pesquisa por texto em `stations_fts` (FTS5): cada palavra tem de aparecer, como prefixo, no código, nome, morada, localidade ou operador; sem acentos (`acores` encontra `Açores`). Postos públicos, os melhores primeiro, `limit` até 50 (20 por omissão). `400` sem uma palavra de pelo menos dois caracteres |
| `GET /api/v1/stations?lat=&lon=&radius=&limit=` | Postos públicos a menos de `radius` metros (500 por omissão, até 5000), do mais perto para o mais longe, cada um com `distance_m`. Usa o índice `stations_lat_lon` (migração `0005`) para uma caixa à volta do ponto e corta o círculo no Worker. `400` com coordenadas em branco ou fora do intervalo, ou com `q` e coordenadas ao mesmo tempo |
| `GET /pesquisa?q=` | A mesma pesquisa em HTML, 20 resultados, `noindex` e fora do *sitemap*. Um código de posto ou de tomada escrito por inteiro faz `302` para a página dele |
| `GET /` | Página inicial com a caixa de pesquisa |
| `GET /en/`, `/en/stations/{id}`, `/en/sockets/{evse}`, `/en/search` | As mesmas páginas em inglês. `/en/sockets/{evse}` faz `302` para `/en/stations/{id}#t-{evse}` |
| `GET /sitemap.xml` | Página inicial e todos os postos públicos, nas duas línguas, com `lastmod` (a última alteração do posto ou de uma tomada). Fica um dia na Cache API: cada geração lê os postos e as tomadas (cerca de 28 mil linhas), uma vez por dia e por centro de dados |
| `GET /robots.txt`, `/llms.txt` | Ficheiros estáticos em `worker/public/`. O `robots.txt` deixa entrar todos os robôs, incluindo os de IA, e aponta para o *sitemap*. O `llms.txt` descreve as páginas, a API, os links estáticos e as licenças |
| `GET /privacidade`, `/en/privacy` | Política de privacidade (`src/privacy.ts`), com ligação no rodapé de todas as páginas e no *sitemap*. Muda no mesmo PR que mudar o que o Worker guarda |
| `GET /conta`, `/en/account` | A conta de quem tem sessão (nome, papel, ligação para o envio, botão para terminar) ou o botão para iniciar sessão. Lê a sessão: `no-store` e `noindex` |
| `GET /enviar`, `/en/upload` | Página de envio (`src/upload.ts` e `public/upload.js`), só com sessão; sem ela, o botão para iniciar sessão. Prepara a foto no browser e ainda não envia nada. Lê a sessão: `no-store`, `noindex`, fora do *sitemap*. A CSP desta página acrescenta `connect-src 'self'` (pede postos à API) e `blob:` em `img-src` (mostra a foto preparada) |
| `GET /auth/osm/login?next=` | `302` para o OpenStreetMap, com `state` e PKCE num *cookie* de 10 minutos. `503` enquanto não houver os segredos do OSM |
| `GET /auth/osm/callback` | Volta do OpenStreetMap: troca o código, lê o utilizador, cria a sessão e faz `302` para o `next`. Qualquer falha volta à conta com `?erro=` |
| `POST /auth/logout?next=` | Apaga a sessão e faz `303` para o `next`. `403` se o pedido vier de outro site |
| `POST /api/v1/photos` | Envio de uma foto, só com sessão e do próprio site (ver *Envio*). `503` `uploads_closed` até o envio abrir. Com este, são os dois `POST`; tudo o resto responde `405` |

As páginas são HTML feito no Worker (`src/pages.ts`), sem *framework*. Os
ficheiros de `worker/public/` (CSS, *scripts*, fontes, ícones) são *static
assets* do Worker: a Cloudflare serve-os antes de o código correr e não contam
para o limite de pedidos. O `public/_headers` dá às fontes um ano de cache
(`immutable`): uma fonte nova leva um nome de ficheiro novo. O CSS e os
*scripts* (`site.js`, `theme.js`, `upload.js`, `jpeg.js`) mantêm o nome, por
isso vão com `no-cache`: o browser confirma-os (ETag) em cada página e um
deploy nunca junta HTML novo com CSS antigo.

**Seletor de tema** (`public/theme.js`). Automático (segue o sistema), claro
ou escuro, no cabeçalho. Carrega no `<head>` sem `defer`, para o tema estar
posto antes de a página aparecer. "Automático" não guarda nada; claro ou
escuro ficam em `localStorage` (`vf-theme`), só no browser. Sem JavaScript o
seletor fica escondido e vale o tema do sistema.

**Links externos** (OSM, o código no GitHub) e o JSON da API abrem num
separador novo, com `rel="noopener"`.

**Duas línguas, URLs fixos.** As páginas em pt-PT ficam onde estavam; o
inglês vive em `/en/`. Não há redirecionamento pelo `Accept-Language` (os
robôs de pesquisa só veriam uma língua): cada página tem um link para a
outra língua, o seu próprio `canonical` e os `hreflang` das duas (`pt-PT`,
`en`, `x-default` para o pt-PT). Os textos do NAP (nomes, moradas,
operadores) não se traduzem; nas páginas em inglês vão marcados com
`lang="pt-PT"` para os leitores de ecrã. Todas as frases estão num único
dicionário em `src/pages.ts`.

**Acessibilidade.** Contraste de pelo menos 4,5:1 no texto e 3:1 nos
contornos dos botões, nos temas claro e escuro. Tamanhos
de letra em `rem` e sem tamanho no `html`, para respeitar o tamanho de letra
do browser e do sistema; a página passa a 320 px de largura com texto a
200 % sem *scroll* horizontal. Há regras para `prefers-contrast: more` e para
o modo de cores forçadas do Windows. O botão de copiar anuncia o resultado
numa região `role="status"` e troca o ícone, em vez de mudar só a cor.

**Nada de terceiros nas páginas.** As fontes (Inter, Space Grotesk, JetBrains
Mono) estão alojadas em `public/fonts/`, não no Google Fonts. A CSP só deixa
carregar ficheiros do próprio site e imagens de `pictures.*`, e não permite
*scripts* nem estilos *inline*: tudo vai em `site.css` e nos *scripts* de
`public/`. A página de envio é a única com uma CSP mais larga (ver a tabela
acima). As
páginas levam também HSTS, `nosniff`, `referrer-policy` e COOP; a API leva
`x-robots-tag: noindex`, porque é para apps e agentes, não para resultados de
pesquisa.

**Registos do Worker** (`observability` no `wrangler.json`). Cada pedido
fica nos Workers Logs com o URL (incluindo o texto das pesquisas), o IP, a
localização que a Cloudflare tira dele e o navegador; os cabeçalhos `cookie`
e `authorization` aparecem como `REDACTED`. Retenção: 3 dias no plano Free,
até 7 com os preços novos da Cloudflare. É isto que a política de
privacidade descreve; se a retenção ou os campos mudarem, ela muda também.

**Início de sessão com o OpenStreetMap** (`src/auth.ts`, migração `0004`).
OAuth2 com PKCE (S256), só o âmbito `read_prefs`: chega para ler o número e
o nome da conta, não dá o email nem deixa editar o mapa. O *token* do OSM
serve uma vez, para ler `user/details`, e é revogado logo a seguir. A sessão
é do VoltFrame: um *cookie* `__Host-vf_session` (`HttpOnly`, `Secure`,
`SameSite=Lax`, 30 dias) com um valor aleatório, e na tabela `sessions` só o
SHA-256 dele. As sessões expiradas saem no login seguinte. A tabela `users`
guarda o número e o nome no OSM (o nome atualiza-se em cada login), o papel
(`contributor` por omissão) e, para depois, pseudónimo, promoção e licença.
As páginas dos postos e da pesquisa não leem a sessão, por isso continuam em
cache e sem ida à D1; só a conta e o envio (`/conta`, `/enviar` e as versões
em inglês) a leem.

Fica **desligado** até existirem os segredos do Worker `OSM_CLIENT_ID` e
`OSM_CLIENT_SECRET`: até lá, `/conta` e `/enviar` dizem que ainda não está disponível e
`/auth/osm/*` responde `503`. Para ligar (só o Fernando):

1. Confirmar que a política de privacidade (`/privacidade`) está publicada
   e certa, incluindo o parágrafo sobre a página de envio.
2. Registar a aplicação em `openstreetmap.org/oauth2/applications`: nome
   "pIcŧU/Re", confidencial, só "Ler as preferências do utilizador"
   (`read_prefs`), *redirect* `https://voltframe.ocarroeletrico.com/auth/osm/callback`.
3. `npm run remote -- secret put OSM_CLIENT_ID` e o mesmo para
   `OSM_CLIENT_SECRET` (pedem o valor; nunca num ficheiro do repositório).

O `secret put` publica logo uma versão nova do Worker: não é preciso outro
deploy. Ligar o login também abre `/enviar` a quem iniciar sessão: a página
só prepara a foto, mas pede à API os postos à volta do GPS arredondado, e
esse URL fica nos registos (a política já o diz). Para desligar outra vez, `npm run remote -- secret delete OSM_CLIENT_ID`.

Em local, o `worker/.dev.vars` (ignorado pelo git) pode apontar `OSM_URL`
para o servidor de testes do OSM (`https://master.apis.dev.openstreetmap.org`,
com conta e aplicação próprias, *redirect* `http://127.0.0.1:8787/auth/osm/callback`)
ou para um servidor falso. O `wrangler dev` mostra ao Worker o domínio de
produção como *host*; com `--local-upstream 127.0.0.1:8787` o
`redirect_uri` fica local.

**Página de envio** (`/enviar`, `src/upload.ts`, `public/upload.js` e
`public/jpeg.js`). Tudo o que mexe na foto corre no browser. Com o envio
fechado, a página para no passo 5 e oferece o download para testar; aberto,
o botão passa a "Enviar a foto" e manda os três tamanhos ao Worker:

1. Abre um JPEG (até 40 MB) com `createImageBitmap`, que aplica a rotação
   do EXIF, e reduz o lado maior a 2048 px.
2. Lê o GPS, a `DateTimeOriginal` e a `Orientation` com o leitor próprio de
   `jpeg.js` (só esses campos; nunca lança erro com um ficheiro mau).
3. Com GPS, arredonda a 3 casas decimais (cerca de 100 m) e pede os postos
   a 500 m; mostra a distância calculada com o GPS exato, que não sai do
   dispositivo. Sem GPS, pesquisa por texto. Depois pede o posto para listar
   as tomadas com código EVSE.
4. A pessoa desenha zonas por cima de caras e matrículas (rato, toque ou
   teclado). Cada zona leva um mosaico de cerca de 8 blocos no lado maior.
   A pré-visualização é a própria imagem que vai ser enviada.
5. Gera 2048, 1024 e 400 px em JPEG 0,85 a partir dessa imagem, tira com o
   `stripMetadata` todos os segmentos de metadados (fica o JFIF, o perfil de
   cor e o Adobe) e tudo o que vem depois do fim da imagem, e confirma com o
   `isCleanJpeg`, que percorre o ficheiro todo, incluindo entre as passagens
   de um JPEG progressivo. O Chrome só escreve JFIF e o perfil de cor; os
   outros browsers não foram testados.

As duas confirmações (sem caras nem matrículas, licença) são campos
obrigatórios do formulário. O `jpeg.js` é JavaScript simples para o browser
o carregar sem *build* e o Worker o importar para validar os envios.

**Envio** (`POST /api/v1/photos`, `src/photos.ts`, migração `0006`). O
pedido é `multipart`: `full`, `main` e `thumb` (os três JPEG) e `meta` (JSON
com o posto, o alvo, a data e o GPS da foto e as duas confirmações). O GPS
vai no corpo, nunca no URL, que fica nos registos. O Worker não confia no
browser:

1. Sessão, origem do próprio site e o limite diário (50 fotos por dia para
   `contributor`, 500 para os outros papéis, por dia UTC).
2. Cada ficheiro: tamanho máximo (6 MB, 2 MB e 500 kB), JPEG limpo
   (`isCleanJpeg`), lado maior até 2048, 1024 e 400 px, e os três com a
   mesma forma.
3. O posto tem de ser público e a tomada tem de ser desse posto. A
   distância ao posto calcula-se no Worker.
4. Escreve a linha em `photos` como `uploading` antes de tudo o resto, guarda
   as versões de 1024 e 400 px em `pictures-staging` (`{id}/main.jpg`,
   `{id}/thumb.jpg`) e manda a de 2048 ao Panoramax: um *upload set*
   `owner-only` só com esta foto, com as coordenadas do posto, a data da foto
   e as etiquetas `osm|ref:EU:EVSE`, `pictures|site` e `pictures|author`.
   No fim, a linha passa a `pending` com os IDs do Panoramax, e a conta fica
   com `license_accepted_at`.
5. Se alguma coisa falhar, apaga o que já tinha guardado (R2 e *upload set*)
   e a linha fica `failed`. Um `409` do Panoramax (a mesma foto já enviada)
   dá `409` `duplicate`.

Medido no Node, verificar 1,5 MB de JPEG leva 0,6 ms e ler o formulário com
as três fotos cerca de 4,5 ms. O plano Free dá 10 ms de CPU por pedido. Falta
confirmar o tempo real no primeiro envio em produção; se passar, a saída é o
Workers Paid (5 $/mês, já no orçamento do `plan.md`).

**Abrir o envio** (só o Fernando). Fica fechado enquanto faltar o login, o
segredo `PANORAMAX_TOKEN` ou a ligação `STAGING`. Antes de pôr o token:

1. Haver moderação: sem ela, as fotos ficam escondidas e ninguém as aprova.
2. Turnstile no formulário (`plan.md`, *Autenticação*), que obriga a abrir a
   CSP da página a `challenges.cloudflare.com`.
3. Confirmar a secção *Envio de fotos* da política de privacidade.
4. Emitir o token da conta `pictures` ([`infra.md`](infra.md), secção 4) e
   `npm run remote -- secret put PANORAMAX_TOKEN`.
5. Enviar uma foto real e confirmar no Panoramax, no `pictures-staging` e na
   D1, e o tempo de CPU nos registos do Worker.

Em local, `--var PANORAMAX_TOKEN:x --var PANORAMAX_URL:http://127.0.0.1:...`
aponta para um Panoramax falso; o R2 local guarda as versões.

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
npm test                  # testes do import, das páginas, do login e do JPEG
npm run db:local          # migrações na D1 local
npm run import:local      # importa o feed real para a D1 local
npm run dev               # http://localhost:8787/api/v1/stations/EZC-AMD-00051
```

Cada PR para `main` corre o workflow `checks.yml` (`npm run check`, `npm test`
e um `wrangler deploy --dry-run`, sem credenciais). O job `worker` é um check
obrigatório no ruleset `main`: sem ele verde, a PR não entra.

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

**A D1 tem uma tabela virtual** (`stations_fts`, FTS5, migração `0003`).
Um `wrangler d1 export` normal falha por causa dela; com
`--compatibility sqlite3_cli_only` funciona, mas esse ficheiro só serve para
o SQLite e não volta a entrar na D1. Para uma cópia que volte a entrar:
apagar a `stations_fts` e os *triggers*, exportar, e correr a `0003` outra
vez. Se a tabela alguma vez se estragar, `INSERT INTO stations_fts
(stations_fts) VALUES ('rebuild')` refaz o índice a partir de `stations`.
Para confirmar que o índice bate com a tabela: `INSERT INTO stations_fts
(stations_fts, rank) VALUES ('integrity-check', 1)` dá erro se não bater.

**Custo da pesquisa, medido na D1 de produção:** uma palavra comum
(`edp`, com mais de 1600 postos) lê cerca de 40 linhas para os 20
primeiros resultados; um código de posto completo lê 2. Um `LIKE` leria os
cerca de 9 mil postos em cada pesquisa. Do lado das escritas, os *triggers*
somam ao import duas linhas por posto alterado (a entrada antiga do índice
sai, a nova entra) e uma por posto novo; um import que reescreva todos os
postos escreve perto de 27 mil linhas só nos postos (mais as cerca de 20
mil das tomadas), ainda dentro do limite diário.

**Custo da pesquisa por proximidade.** O índice `(lat, lon)` percorre a faixa
de latitude do pedido e só vai à tabela pelos postos dentro da caixa. Com os
dados reais, no centro de Lisboa (o caso mais denso), a faixa tem cerca de
280 entradas a 500 m e cerca de 1500 a 5 km: é essa a ordem das linhas lidas
(por medir na D1 de produção depois da `0005`). Criar o índice escreve uma
linha por posto; não juntar com um import que reescreva tudo.

Quem chamar com a localização de uma pessoa deve arredondar as coordenadas
a 3 casas decimais (cerca de 100 m) antes do pedido: os registos do Worker
guardam o URL completo. A página de envio vai fazer isso.

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

- [ ] Publicar o Worker pelo CI em vez de à mão (precisa de um token com permissões de Workers).
- [ ] Regra de ciclo de vida no `pictures-staging` como rede de segurança
  para fotos rejeitadas ou abandonadas (por exemplo 90 dias). O risco é
  apagar as versões de uma foto que ainda está na fila.
