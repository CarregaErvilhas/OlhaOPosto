# Infra — Panoramax do olh'o'posto no Zerops

**Em produção** em `https://panoramax.ocarroeletrico.com`,
atrás da Cloudflare, fora da federação. Este é o sítio onde fica documentada
a infraestrutura do servidor Panoramax. O resto do olh'o'posto (Worker, D1 e R2
`pictures`) é Cloudflare e está em [`cloudflare.md`](cloudflare.md). Porque é assim
está em [`arquitetura.md`](arquitetura.md), secção *Porque o Panoramax*.

```
olh'o'posto (Worker) ──HTTPS + token──► Cloudflare (proxy) ──► balanceador L7 do Zerops ──► `pano`
                                                                                         ├─ api (gunicorn :5000)
                                                                                         └─ worker (picture-worker)
                                                                                              │        │
                                                                          `db` (PostgreSQL + PostGIS)  R2 `panoramax`
GitHub (push para main) ──webhook──► Zerops faz build + deploy do `pano`
```

Ficheiros:

| Ficheiro | O que faz |
| --- | --- |
| `zerops-import.yaml` | Cria os serviços `db` e `pano` no projeto |
| `zerops.yml` | Build e runtime do `pano` (setup `pano`) |
| `panoramax/requirements.in` | Versão do Panoramax (`geovisio==2.17.0`, do PyPI) |
| `panoramax/requirements.txt` | Lock gerado do `.in`: todas as dependências, com hashes |
| `panoramax/bootstrap_db.py` | Extensões, permissões e fuso da BD, com o superuser |
| `panoramax/service_account.py` | Cria a conta de serviço `OlhaOPosto` (não admin) e roda o token |
| `panoramax/wsgi.py` | Ponto de entrada do gunicorn: a API com a confiança nos proxies que serve aqui (secção 7) |
| `panoramax/trial_upload.sh`, `trial_batch.sh` | Envios de teste pela API, usados no ensaio (secção 9) |

---

## 1. Estado

| O quê | Onde |
| --- | --- |
| Projeto Zerops | `Panoramax`, org Cocofree, core *Lightweight*, região `prg1` |
| Serviços | `pano` (Panoramax 2.17.0) e `db` (PostgreSQL 18, PostGIS 3.6.4) |
| Imagens | Bucket R2 `panoramax`, privado |
| Domínio | `panoramax.ocarroeletrico.com`: `AAAA` com proxy da Cloudflare, certificado do Zerops, *Access Policy* só para a Cloudflare |
| Deploy | Webhook do GitHub: cada push para `main` faz build e deploy |
| Contas | Conta `OlhaOPosto` criada, com token; sem OAuth |

Próximos passos:

- [ ] Ponto 6 do ensaio: ler o consumo na GUI do Zerops e fazer a conta mensal (secção 9).
- [ ] Quando o Worker passar a enviar fotos: emitir um token novo da
  `OlhaOPosto` e guardá-lo com `npm run remote -- secret put PANORAMAX_TOKEN`
  (secção 4). O Worker já existe, mas ainda não fala com o Panoramax.

---

## 2. Serviços

| Serviço | Tipo | Função |
| --- | --- | --- |
| `pano` | `python@3.14`, Ubuntu | API do Panoramax (gunicorn, porta 5000) e o *worker* que processa as fotos, no mesmo container |
| `db` | `postgresql:single@18`, gerido pelo Zerops | Metadados, utilizadores, fila de processamento. PostGIS, `pg_trgm`, `uuid-ossp` |

### Versões

- **Panoramax 2.17.0**: a mais recente no PyPI (2026-11-23). O Panoramax
  não tem versões LTS; publica versões *minor* com migrações da BD. Os
  nomes das variáveis e comandos deste ficheiro foram confirmados no código
  da 2.17.0 (`geovisio/config_app.py`, `admin_cli/`), não só na
  documentação, que acompanha o `develop`.
- **Python 3.14**: a mais recente no Zerops, que só a oferece em Ubuntu. O
  changelog do Panoramax anuncia suporte ao 3.14, e as dependências
  binárias da 2.17.0 (pyexiv2, rtree, opendal, Pillow, psycopg, pydantic,
  timezonefinder) têm wheels `cp314` para glibc no PyPI.
- **Ubuntu, não Alpine**: o `pyexiv2` (o leitor de metadados EXIF/XMP de
  que o Panoramax depende) não tem wheels para musl, a libc do Alpine; no
  Alpine teria de ser compilado com o exiv2 de sistema. E o Python 3.14 do
  Zerops só existe em Ubuntu.
- **PostgreSQL 18, gerido pelo Zerops** (`postgresql:single@18`): backups,
  autoscaling e atualizações *minor* são do Zerops. É a versão mais recente
  que o Zerops oferece. A 19 saiu a 2026-11-19 e ainda não está disponível.
  Passar para a 19 mais tarde obriga a recriar o serviço `db` e restaurar
  um dump. O PostGIS vem com o serviço.

As imagens não estão no Zerops: vão para o bucket R2 `panoramax`
(originais em `permanent/`, tamanhos em `derivatives/`, envios a meio em
`tmp/`).

### Recursos

| Serviço | mínimo | máximo | containers |
| --- | --- | --- | --- |
| `pano` | 1 CPU / 0,5 GB / 1 GB disco | 2 CPU / 2 GB / 5 GB | 1 a 2 |
| `db` | 1 CPU / 0,5 GB / 1 GB disco | 2 CPU / 0,5 GB / 5 GB | 1 (`single`) |

Tudo em CPU `SHARED`. O segundo container do `pano` só existe durante um
deploy (rolling).

**A RAM do `db` é fixa (mínimo = máximo).** O Zerops deriva o
`shared_buffers` da RAM, e mudar o `shared_buffers` obriga a reiniciar o
PostgreSQL. Com RAM entre 0,25 e 1 GB, o autoscaling oscilava entre 0,25 e
0,5 GB a cada poucos minutos, e cada passo reiniciava a BD. O pool de ligações
do Panoramax fica com as ligações mortas, o `/api/configuration` dá 500 até as
descartar todas (1 a 2 minutos), o `pano` falha o health check e o site dá
502. Para mudar a RAM, mudar o mínimo e o máximo juntos, na GUI (o `zcli` não
mexe no scaling), e contar com um reinício.

O *Lightweight* inclui 100 GB/mês de tráfego de saída. Como as imagens do
Panoramax passam pela API (secção 5), cada visualização conta. Os links
estáticos `pictures.*` não passam por aqui, por isso não deve chegar ao
limite.

---

## 3. Como corre o `pano`

**Build.** Não há nada a compilar. O build só entrega a pasta `panoramax/`
(fica em `/var/www/panoramax`) e passa o `requirements.txt` para o
*prepare* do runtime.

**Prepare (fica em cache).** Cria um venv em `/opt/venv`, instala o
`geovisio` do PyPI e cria o utilizador `pano`, sem sudo, sem shell e sem
casa. Só volta a correr quando o `requirements.txt` ou os
`prepareCommands` mudam.

- **venv:** o pip do sistema no Ubuntu 24.04 recusa instalar fora de um
  venv (PEP 668). Fica em `/opt/venv` e não na casa do `zerops`: o Ubuntu
  cria as casas com `0750`, e o `pano` não conseguiria chegar ao venv.
- **Lock:** o `requirements.txt` é gerado do `requirements.in` com o `uv`
  (`uv pip compile`, comando no topo do ficheiro), para Linux x86_64 e
  Python 3.14, com hashes de todas as dependências. O pip instala com
  `--require-hashes`: um pacote trocado no PyPI faz falhar o prepare.
  Gerar no Mac sem `--python-platform` dá markers e pacotes errados.

**Init (cada vez que um container arranca, antes dos processos):**

1. `bootstrap_db.py`, com o superuser do `db`:
   - cria `postgis`, `pg_trgm` e `uuid-ossp` (o PostGIS não é uma extensão
     *trusted*, por isso o dono da BD não o pode criar);
   - falha se o PostGIS for anterior a 3.4;
   - dá à role da app `SET ON PARAMETER session_replication_role` (algumas
     migrações usam-no para acelerar; sem isto funcionam, mas mais devagar);
   - põe a BD em UTC (o Panoramax recusa arrancar noutro fuso).
2. `panoramax_backend db upgrade`, com a role da app: aplica as migrações
   que faltarem.

Se o `bootstrap_db.py` ou o `db upgrade` falhar antes de fazer commit, o
*readiness check* chumba e a versão anterior continua a servir. **Mas uma
migração que já fez commit não se desfaz:** se a API nova falhar depois
(variável errada, wheel em falta, timeout de 240 s), o Zerops mantém a
versão anterior a servir sobre um schema que ela não conhece. E mesmo num
deploy que corre bem, as migrações correm enquanto o container antigo ainda
serve, por isso uma migração que mude ou apague colunas parte a versão
antiga durante esse minuto. Em subidas do Panoramax com migrações, ver a
secção 8.

**Processos (`startCommands`, como `pano`, sem a variável do superuser):**

- `api`: `gunicorn wsgi:app` (`panoramax/wsgi.py`, que embrulha o
  `geovisio:create_api()`) com 2 workers × 4 threads.
- `worker`: `panoramax_backend picture-worker`. Gera os tamanhos, lê os
  metadados e corre o cron diário de estatísticas. Por isso a API tem
  `PICTURE_PROCESS_THREADS_LIMIT=0`: não processa fotos dentro do pedido.

**Cron (`crontab`, de hora a hora, num só container):** `panoramax_backend
db refresh` atualiza a grelha agregada (`pictures_grid`), que é o que o mapa
mostra nos zooms 0 a 6. O Panoramax não a atualiza sozinho. Do zoom 7 para
cima as fotos aparecem como pontos, por uma alteração nossa (secção
seguinte).

### Mapa: fotos de uma só foto

**O problema.** O Panoramax foi feito para sequências de rua: do zoom 7 ao
14 desenha cada sequência como uma linha, e as fotos como pontos só a partir
do 15 (o visualizador deixa-as com raio 0 até ~16,5). Cada envio do
olh'o'posto é uma sequência de uma foto, que não tem linha. Sem alteração, o
mapa não mostrava nada entre o zoom 7 e o ~16,5.

**O que mudámos** (`panoramax/map_override.py`, chamado pelo `wsgi.py`):

- **Tiles:** o `ZOOM_PICTURES` do geovisio passa de 15 para 7, e os tiles
  levam a camada `pictures` a partir do zoom 7. Os filtros de visibilidade
  são os do geovisio: as fotos à espera de moderação continuam de fora.
- **`style.json`:** o mesmo `ZOOM_PICTURES` dá o `maxzoom` da fonte dos
  tiles, que volta a ser 15. Com 7, o MapLibre esticava os tiles do zoom 7
  até à rua e os pontos ficavam até ~76 m ao lado.
- **`/viewer`:** é o nosso `panoramax/templates/viewer.html`, uma cópia do
  do geovisio (`viewer.upstream.html`) com as nossas mudanças. O visualizador
  fica fixo na versão do `panoramax/viewer/package.json`, em vez do `@~4`
  que mudava sozinho no CDN, e é carregado do bundle da v5 (`build/cjs/index.js`;
  o `build/index.js` da v4 é agora a página de demonstração e o
  `build/index.css` já não existe). O metacatalogo vem desligado, para o mapa
  mostrar só a nossa API. Um *script* põe a opacidade e o raio da camada das
  fotos visíveis a partir do zoom 7. Outro faz o botão «Report» abrir o
  formulário de remoção do olh'o'posto, porque a regra WAF bloqueia o
  `POST /api/reports` do visualizador (`Docs/cloudflare.md`, *Pedidos de
  remoção*). O `/viewer` vai com `max-age=0`, para um deploy chegar logo aos browsers.

O `apply()` confirma primeiro tudo aquilo de que depende e só depois muda o
que for preciso, tudo de uma vez. Se alguma coisa não bater em produção, o
`pano` arranca na mesma, com o Panoramax sem alterações, e o registo da
`api` diz `map_override not applied` e o porquê.

**O teste de drift.** O job `panoramax` do `checks.yml` corre em todos os
PRs (`panoramax/tests/`), com o geovisio do `requirements.txt` e o
visualizador do `package.json`. É assim que um PR do Dependabot que parta
isto falha antes do merge. Sem base de dados, verifica:

- que o geovisio ainda tem o que o `map_override.py` usa (o
  `ZOOM_PICTURES`, o `get_style_json`, o `_get_query`, a rota `/viewer`);
- que os tiles dos zooms 7 a 15 levam as fotos e que os anónimos só veem
  as públicas;
- o `maxzoom` 15 do `style.json`, e que o `/viewer` é o nosso, com a versão
  fixada;
- que o `viewer.html` do geovisio não mudou desde a nossa cópia;
- num Chromium, com o visualizador do CDN: uma foto de teste
  (`tests/fixtures/picture.mvt`) aparece como ponto visível ao zoom 10
  (laranja na v4, roxo na v5).

**Quando falha:** a mensagem diz o que deixou de bater e o que fazer.

- Se for o **`viewer.html` do geovisio**: passar a mudança para a nossa
  cópia e copiar o novo para o `viewer.upstream.html`.
- Se for o **visualizador**: confirmar primeiro se o bundle ainda carrega do
  CDN (o caminho muda entre versões); depois, os nomes de que o *script*
  depende são `viewer.map` e as camadas `geovisio…_pictures`. Ajustar o
  `templates/viewer.html`.
- Se for o **geovisio**: ver no `web/map.py` novo como se escolhem as
  camadas por zoom e ajustar o `map_override.py`.
- Se o Panoramax passar a desenhar as fotos soltas sozinho: retirar a
  parte que já não for precisa.

Correr os testes à mão: `pip install -r requirements.txt -r
requirements-test.txt`, `python -m playwright install chromium` e
`python -m pytest tests` dentro de `panoramax/`. No macOS, o `pyexiv2` do
PyPI não carrega; os testes não o usam, por isso basta um módulo `pyexiv2`
vazio no `PYTHONPATH`. O `tests/make_fixture.py` refaz o tile de teste.

Os `startCommands` correm em bash (visto no primeiro deploy):
o `geovisio:create_api()` sem aspas dava `syntax error near unexpected
token '('`. Caracteres especiais do shell vão entre aspas simples.

**Verificações:** `readinessCheck` e `healthCheck` em
`/api/configuration`, sem autenticação.

---

## 4. Configuração

Variáveis no `zerops.yml` (não secretas) e no Zerops (secretas). As do Panoramax estão em [settings](https://docs.panoramax.fr/backend/install/settings/); confirmei os nomes no código da 2.17.0 (`geovisio/config_app.py`).

| Variável | Valor | Porquê |
| --- | --- | --- |
| `DB_URL` | `${db_connectionString}` (porta 5432) | Não o pgBouncer (6432): o Panoramax manda `-c statement_timeout` na ligação, que o pgBouncer recusa |
| `PANO_DB_SUPERUSER_URL` | superuser do `db` | Só para o `bootstrap_db.py`; tirado dos processos com `env -u` |
| `DB_MAX_CNX` | `5` | Por processo gunicorn; a BD tem 0,5 GB |
| `FS_URL` | **secreta**, ver secção 6 | Bucket R2 `panoramax` |
| `FLASK_SECRET_KEY` | **secreta**, gerada no import | Sessões e tokens JWT. Trocá-la invalida o token da conta de serviço |
| `API_SUMMARY` | nome, descrição, cobertura, cor, email | O que aparece no `/api/configuration` e na federação |
| `API_WEBSITE_URL` | `false` | Não há site Panoramax à parte; a API serve o seu visualizador em `/` |
| `API_PICTURES_LICENSE_SPDX_ID` / `_URL` | `CC-BY-SA-4.0` | Licença do servidor ([`licenca.md`](licenca.md)) |
| `API_REGISTRATION_IS_OPEN` | `false` | Ninguém cria conta |
| `API_FORCE_AUTH_ON_UPLOAD` | `true` | Só com token se envia |
| `API_DEFAULT_PICTURE_VISIBILITY` | `owner-only` | A foto só fica pública quando o olh'o'posto a aprova |
| `PICTURE_PROCESS_THREADS_LIMIT` | `0` | O processamento é do `worker` |
| `PICTURE_PROCESS_DERIVATES_STRATEGY` | `PREPROCESS` | Gera os tamanhos logo ao receber (são poucas fotos e evita latência na primeira visualização) |
| `INFRA_NB_PROXIES` | Não definida | A confiança nos proxies é do `panoramax/wsgi.py` (secção 7, «Proxies») |

### Configuração gravada na BD

No primeiro arranque, o Panoramax grava `API_DEFAULT_PICTURE_VISIBILITY`
(e a edição colaborativa de metadados) na tabela `configurations`. Depois
disso, **mudar a variável não tem efeito**: só um aviso no log. Para mudar,
é um `UPDATE configurations SET default_visibility = …` na BD.

### Contas: sem OAuth, e a conta de serviço não é admin

**Sem OAuth nenhum.** O `/api/configuration` mostra `auth.enabled: false`,
e as rotas `/api/auth/*` respondem 501: ninguém entra pela web, nem por
engano. Não há app OAuth no OSM para manter. Por isso também não há
interface de admin web do Panoramax: a moderação é a do olh'o'posto, e a
manutenção faz-se pela API e pela CLI (ver *Acesso de admin*, abaixo).

Há duas contas:

| Conta | Papel | Para quê |
| --- | --- | --- |
| Conta por omissão (criada pela migração inicial) | `admin` | Manutenção à mão. O token não sai do container |
| `OlhaOPosto` | `user` | Envios do olh'o'posto. O token vai para o Worker |

A `OlhaOPosto` não é admin de propósito. Pode enviar fotos e mudar a
visibilidade das suas, que é tudo o que o olh'o'posto faz. Se o token vazar,
quem o tiver não consegue mudar papéis nem tratar denúncias como admin.
**Mas isso não protege as fotos:** são todas da `OlhaOPosto`, por isso quem
tiver o token pode apagá-las, escondê-las ou torná-las públicas sem
moderação. Uma fuga do token apanha as fotos todas.

O Panoramax não tem comando para criar uma conta sem login, por isso o
`panoramax/service_account.py` faz o mesmo que a rota de tokens: cria a
conta com papel `user` (se não existir), apaga **todos** os tokens da conta,
acrescenta uma linha nova a `tokens` e assina o JWT com a função do próprio
Panoramax. Recusa correr sobre a conta por omissão ou sobre um admin.

Porquê apagar todos: qualquer token de uma conta lista os outros
(`GET /api/users/me/tokens`) e tira-lhes o JWT
(`GET /api/users/me/tokens/<id>`). Quem tiver um token tem todos. Além
disso, o trigger `generate_default_token_trg` do Panoramax cria um
`default token` em cada conta nova, que nunca é mostrado. Cada execução do
script é por isso uma rotação: o token antigo do Worker deixa de funcionar
assim que a transação termina.

```bash
# no container (secção 9, «Acesso ao container»)
cd /var/www && /opt/venv/bin/python panoramax/service_account.py
```

O JWT sai na última linha. Vai direto para o `npm run remote -- secret put
PANORAMAX_TOKEN` do Worker (o container não tem `wrangler`; ver
[`cloudflare.md`](cloudflare.md), secção 4), ou, enquanto o Worker não
enviar fotos, para o gestor de passwords. Nunca para um chat, um ficheiro ou um
log: quem o tiver controla todas as fotos.

O JWT não expira. Para o **revogar** sem criar outro, apagam-se todos os
tokens da conta, nunca só uma linha:

```sql
DELETE FROM tokens WHERE account_id = (SELECT id FROM accounts WHERE name = 'OlhaOPosto');
```

Para revogar e emitir um novo, basta voltar a correr o script. Trocar o
`FLASK_SECRET_KEY` invalida todos os tokens do servidor de uma vez.

**Crédito por foto (ponto 5 do ensaio):** o STAC mostra sempre
`providers: OlhaOPosto` e `geovisio:producer: OlhaOPosto` (o nome da conta). O autor só fica na
etiqueta `OlhaOPosto|author=`. Por isso o crédito é dado pelo olh'o'posto e pelo
XMP das cópias em `pictures.*` (`arquitetura.md`, *Links estáticos*).

### Acesso de admin

A conta por omissão é `admin`. O token dela tira-se no container e usa-se
**só pela VPN**, para não andar pela internet:

```bash
/opt/venv/bin/panoramax_backend default-account-token get
```

Com ele, o Swagger em `http://pano.zerops:5000/api/docs/swagger`
(*Authorize*, Bearer) dá a API toda: denúncias (`/api/reports`), áreas
excluídas, visibilidade, apagar fotos e coleções. Na CLI há ainda `user`,
`cleanup`, `db refresh` e `sequences reorder`. O token de admin não expira;
se vazar, o único corte é trocar o `FLASK_SECRET_KEY`, que invalida todos
os tokens do servidor, incluindo o da `OlhaOPosto`.

---

## 5. Armazenamento no R2

O Panoramax 2.17 acede ao armazenamento pelo OpenDAL. Um `FS_URL` `s3://`
dá-lhe um bucket com três pastas (`tmp/`, `permanent/`, `derivatives/`):

```
s3://<access-key-id>:<secret-access-key>@panoramax/data?endpoint_url=https://<account-id>.r2.cloudflarestorage.com&region=auto
```

- Sem `acl=` no URL, o OpenDAL não manda ACL. Isso resolve o ponto do
  ensaio "o R2 não suporta ACL": com este URL, nem são pedidas.
- As chaves do R2 são hexadecimais, por isso podem ir no URL sem
  codificação.
- O prefixo `/data` evita a raiz do bucket (com `/` o Panoramax gera
  caminhos `//tmp/`).

**O que se cria na Cloudflare:**

1. Bucket R2 `panoramax`, **privado** (sem domínio público nem `r2.dev`).
2. Token R2 com **Object Read & Write só nesse bucket**. Dá o
   *Access Key ID* e o *Secret Access Key*.

**Porque as imagens passam pela API, e não por um domínio público do
bucket.** O Panoramax aceita `API_PERMANENT_PICTURES_PUBLIC_URL` e
`API_DERIVATES_PICTURES_PUBLIC_URL` para servir as imagens diretamente de um
bucket público. Mas as fotos `owner-only` (por aprovar) ficariam acessíveis
a quem adivinhasse o caminho. Enquanto a moderação depender da visibilidade
do Panoramax, as imagens passam pela API. Os links estáticos de uso geral
são os do `pictures.*`, que não passam por aqui.

**Sem disco local:** o `tmp/` também fica no R2. Durante um rolling deploy
há dois containers, e um envio recebido num pode ser processado pelo
*worker* do outro. Num disco local, o ficheiro não estaria lá.

**O que se viu no ensaio:**

- O original fica em `data/permanent/<xx>/<xx>/<xx>/<xx>/<resto do uuid>.jpg`
  **tal como foi enviado, com o EXIF todo**. Os tamanhos ficam em
  `data/derivatives/…/<uuid>/` e são só `sd.jpg` e `thumb.jpg`: o `hd.jpg`
  da API é o próprio original. Por isso o Worker tem de tirar o EXIF e
  reduzir para 2048 px **antes** de enviar (`plan.md`, *Fluxo de upload*).
- Uma foto de 4,4 MB deu `sd` de 400 kB e `thumb` de 29 kB.
- Apagar um upload set pela API apaga também os ficheiros no R2, em
  segundo plano, pelo *worker* (o bucket ficou vazio em menos de um minuto).

---

## 6. Segredos

**Nenhum segredo no repositório nem no GitHub.** No serviço `pano`
(Zerops → serviço → *Environment variables*, como *secret*):

| Variável | Origem |
| --- | --- |
| `FLASK_SECRET_KEY` | Gerada no import (`<@generateRandomString(<64>)>`) |
| `FS_URL` | À mão, com o token R2 da secção 5 |

As credenciais do `db` não são copiadas: o `zerops.yml` refere-as
(`${db_connectionString}`, `${db_superUser}`, …), e o Zerops resolve-as
quando o container arranca. Uma variável alterada só entra em vigor depois
de reiniciar o serviço.

---

## 7. Domínio e Cloudflare

Como no CEME: **só um registo `AAAA`** com proxy ativo, para o IPv6 do
projeto. O IPv4 partilhado do Zerops escolhe o projeto pelo `AAAA` do
domínio, e com o proxy da Cloudflare esse `AAAA` é da Cloudflare, por isso
um `A` partilhado com proxy não funciona. A Cloudflare traduz os clientes
IPv4.

Como está:

| Onde | O quê |
| --- | --- |
| Zerops, *Public access* do `pano` | `panoramax.ocarroeletrico.com` → `pano:5000`, SSL (Let's Encrypt emitido pelo Zerops) |
| Cloudflare, zona `ocarroeletrico.com` | `panoramax  AAAA  <IPv6 dedicado do projeto>`, proxy ON (o IPv6 está no Zerops, *Public access* do `pano`). A zona já estava em SSL *Full (strict)* |
| Zerops, roda dentada do domínio → *Access Policy* | *Default Policy* `deny`; *CIDR Blocks* = as gamas da Cloudflare, uma por linha |
| Zerops, subdomínio `zerops.app` | Desligado: ficava fora da Cloudflare |
| Cloudflare, Cache Rule «panoramax pictures: origin TTLs, 4xx never stored» | Só as imagens (`/api/pictures/….jpg` em `panoramax.ocarroeletrico.com`): ficam em cache com os TTLs do Panoramax, mas um 4xx nunca. O Panoramax manda `Cache-Control: public` até nos `404` das imagens, e uma foto escondida responde `404`: sem esta regra, esse `404` ficava na cache depois de a foto ser aprovada |
| Cloudflare, Cache Rule «panoramax: API, map tiles and pages never cached» | Tudo o resto do `panoramax.*` passa sem cache. O Panoramax manda `Cache-Control: public` sem prazo também na API, nas tiles do mapa e nas páginas, e a Cloudflare guardava-as: uma foto aprovada não aparecia no mapa e a página do visualizador podia ficar presa a uma versão antiga |

O `A` partilhado do Zerops não se usa, e o CNAME que o Zerops
também propõe não traz nada: com o IPv4 partilhado excluído, aponta para o
mesmo IPv6, e esse interruptor vale para o projeto todo.

**Access Policy.** O Zerops só a configura na GUI (sem chave no
`zerops.yml`, sem zcli). A verificação usa o IP de quem liga, por isso
funciona atrás da Cloudflare. As gamas vêm de
`https://www.cloudflare.com/ips-v4` e `ips-v6`; quando a
Cloudflare as mudar, atualizam-se à mão. Para confirmar:

```bash
# direto à origem, sem Cloudflare: tem de dar 403
curl -s -o /dev/null -w '%{http_code}\n' --resolve "panoramax.ocarroeletrico.com:443:[$PANO_IPV6]" https://panoramax.ocarroeletrico.com/api/configuration
# pela Cloudflare: tem de dar 200
curl -s -o /dev/null -w '%{http_code}\n' https://panoramax.ocarroeletrico.com/api/configuration
```

**Limite de envio.** O domínio próprio corta os pedidos acima de 512 MB.
As fotos chegam com 2048 px (menos de 2 MB), por isso o limite não conta.

**Proxies.** O Panoramax monta os URLs absolutos das respostas STAC a
partir dos `X-Forwarded-*`. O `INFRA_NB_PROXIES` dele aplica a mesma
contagem aos cinco cabeçalhos, e isso não serve aqui (visto no subdomínio,
com `INFRA_NB_PROXIES=1`):

- O balanceador do Zerops define `Host`, `Proto` e `Port`, mas deixa passar
  o `X-Forwarded-Prefix` do cliente. Um pedido com `X-Forwarded-Prefix: /zz`
  devolvia links `…/zz/api/`: qualquer cliente reescrevia os links.
- O balanceador manda `X-Forwarded-Port: 80` mesmo em HTTPS. Os links saíam
  `https://…zerops.app:80/api/`.
- A Cloudflare não acrescenta `X-Forwarded-Host`. Com `2`, o Panoramax lia
  o penúltimo valor, que só existe se o cliente o mandar.

Por isso o `INFRA_NB_PROXIES` fica por definir e o gunicorn arranca o
`panoramax/wsgi.py`, que confia só no último proxy (o balanceador) para
`For`, `Proto` e `Host`, e ignora `Port` e `Prefix`. Serve igual no
subdomínio e atrás da Cloudflare. Atrás da Cloudflare o `For` é o IP da
Cloudflare e não o do cliente; o Panoramax não precisa dele.

Verificado no subdomínio e depois no domínio: com e sem `X-Forwarded-Host`,
`-Proto`, `-Port` e `-Prefix` forjados, os links saem sempre
`https://panoramax.ocarroeletrico.com/api/`.

---

## 8. Deploy

**Webhook do Zerops, como no CEME.** O GitHub Actions não faz deploy e não
guarda credenciais do Zerops.

> Serviço `pano` → **Build, Deploy, Run Pipeline Settings** → **Connect
> with a GitHub repository** → `CarregaErvilhas/OlhaOPosto`, trigger
> **Push to branch: `main`**, setup `pano`.

À mão, em último recurso, na raiz do repo (faz commit antes):

```bash
# IDs fora do repo: zcli project list / zcli service list -P <project-id>
zcli push -P <project-id> --service-id <id-do-pano> --setup pano
```

- **Num `git worktree` falha** com `exit status 128` (o `.git` é um
  ficheiro): acrescentar `--no-git`, que envia a pasta tal como está.
- **Um deploy à mão fica por cima de `main`.** O próximo push para `main`
  repõe o que lá estiver, por isso a mudança tem de entrar em `main` logo
  a seguir.
- **Não lançar dois deploys seguidos:** no ensaio, um segundo push enviado
  com o primeiro ainda a correr falhou no mesmo segundo que o primeiro.

### Atualizar o Panoramax

1. Ler o [changelog](https://gitlab.com/panoramax/server/api/-/blob/develop/CHANGELOG.md)
   entre as versões, à procura de migrações e variáveis novas ou retiradas
   (o `config_app.py` recusa arrancar com algumas antigas).
2. Mudar `geovisio==` no `requirements.in`. O Dependabot abre o PR
   (ecossistema `pip`, pasta `/panoramax`). O job `panoramax` do PR testa
   as nossas alterações ao mapa (secção 3, «Mapa: fotos de uma só foto»).
   Depois de mudar o `requirements.in`, regenerar o lock
   (`requirements.txt`, secção 3) e fazer commit dos dois.
3. Se a versão nova trouxer migrações: fazer um backup da `db` antes, e
   fazer o deploy com `deploy.temporaryShutdown: true` (alguns segundos sem
   serviço em vez de um container antigo a falar com um schema novo). O
   rolling deploy não reverte uma migração com commit (secção 3); voltar
   atrás é restaurar o backup.

---

## 9. Ensaio

Os seis pontos do ensaio da fase 1, mais os que saíram ao preparar a
configuração. Feito no subdomínio `zerops.app` e pela VPN, e depois no
domínio.

| # | Verificar | Resultado |
| --- | --- | --- |
| 1 | PostGIS 3.4+ no PostgreSQL gerido | **Passa.** `bootstrap_db`: PostgreSQL 18, PostGIS 3.6.4 |
| 2 | R2 como `FS_URL` | **Passa.** Original em `data/permanent/`, tamanhos em `data/derivatives/`; apagar limpa o bucket (secção 5) |
| 3 | Foto isolada com etiquetas, pela API | **Passa.** Um upload set com `no_split` dá uma coleção com uma foto; as três etiquetas ficam na foto |
| 4 | `owner-only` e passar a `anyone` ao aprovar | **Passa.** Sem token, 404 na coleção, no item e nas imagens, e o `/api/search` vem vazio. Um `PATCH /api/upload_sets/<id>` com `{"visibility": "anyone"}` passa tudo a 200. A foto em si fica `anyone`: quem esconde é a coleção (vale a mais restritiva) |
| 5 | Crédito por foto (autor ≠ conta de serviço) | **Não passa.** O STAC mostra sempre a conta de serviço (`OlhaOPosto`) como produtor; o autor só na etiqueta. Fica a alternativa do `plan.md` (*Publicação dos links estáticos*) |
| 6 | Consumo de recursos dentro do orçamento | **Por medir.** Ler o consumo na GUI e fazer a conta mensal |
| 7 | O pip instala o `geovisio` no `ubuntu/python@3.14` | **Passa.** Todas as dependências com hashes, sem compilar nada |
| 8 | `run.base: ubuntu/python@3.14` é aceite | **Passa.** Python 3.14.6, Ubuntu 24.04 |
| 9 | `X-Forwarded-*` (era `INFRA_NB_PROXIES`) | **Passa, com o `wsgi.py`** (secção 7, «Proxies»). Com o `INFRA_NB_PROXIES=1` os links saíam com `:80` e aceitavam um prefixo forjado |
| 10 | RAM do processamento | **Passa.** 20 fotos de telemóvel (~4 MB) num só upload set: média de 0,40 GB usados, pico abaixo de 1 GB. Em repouso, 0,41 de 0,5 GB e 0,06 de 1 CPU |

Também se viu:

- **Duplicados:** um ficheiro cujo MD5 já está na tabela `pictures` é
  recusado com 409 («The same picture has already been sent in a past
  upload»), mesmo noutro upload set. Uma foto re-codificada pelo Worker tem
  outro MD5, por isso só conta para reenvios do mesmo ficheiro.
- **Erros `yoyo_*` no log do PostgreSQL** a cada arranque
  (`yoyo_tmp_… does not exist`, `yoyo_lock already exists`): são testes da
  biblioteca de migrações e são normais.

Os scripts do ensaio usam o token da `OlhaOPosto` em `PANORAMAX_TOKEN` e
falam com o `pano` pela VPN. O `DELETE /api/upload_sets/<id>` apaga um envio
de teste.

```bash
panoramax/trial_upload.sh foto.jpg [lat lon]   # pontos 2 a 4
panoramax/trial_batch.sh fotos/*.jpg           # ponto 10 (ficheiros diferentes)
```

### Acesso ao container

```bash
zcli vpn up -P <project-id>   # com -P: sem ele, o zcli pode escolher outro projeto
ssh pano.zerops               # o nome curto `pano` não resolve no `dig`
```

A API responde pela VPN em `http://pano.zerops:5000`. No container:

```bash
cd /var/www
/opt/venv/bin/python panoramax/service_account.py   # conta `OlhaOPosto` + rotação do token (secção 4)
/opt/venv/bin/panoramax_backend db upgrade          # migrações à mão
```

---

## 10. Backups

- **`db`:** backups automáticos do Zerops (5 GB incluídos no
  *Lightweight*). Sem a BD, as imagens no R2 ficam sem metadados e sem
  ligação aos postos.
- **R2 `panoramax`:** a Cloudflare não faz backups do R2. Não conto com a
  federação como cópia das imagens (não confirmei o que o *harvester*
  guarda). Fica por resolver: ver *Questões em aberto*.
- O D1 do olh'o'posto guarda o `panoramax_id` de cada foto. Com isso e o
  bucket, dá para reconstruir a ligação foto → posto.

---

## 11. Questões em aberto

- [ ] `API_PICTURES_LICENSE_URL`: hoje aponta para a CC BY-SA 4.0. Quando houver uma página do olh'o'posto com a autorização ODbL, passa para lá (como faz o Panoramax da OSM França).
- [ ] Cópia de segurança das fotos do R2 (outro bucket, outra conta, ou o Commons para as principais).
- [ ] Ponto 6 do ensaio: custo mensal (secção 9).
- [ ] Um MD5 de uma foto apagada continua a bloquear reenvios? O 409 do
  ensaio foi com um ficheiro que talvez fosse o da primeira foto de teste,
  já apagada; não ficou confirmado.
