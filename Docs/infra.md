# Infra — Panoramax do VoltFrame no Zerops

2026-11-23 · em preparação: os ficheiros estão escritos, o projeto Zerops
ainda não existe. Este é o sítio onde fica documentada a infraestrutura do
servidor Panoramax (`panoramax.ocarroeletrico.com`). O resto do VoltFrame
(Worker, D1, R2 `pictures`) é Cloudflare e fica para quando houver código.
O design está em [`plan.md`](plan.md), secção *Servidor Panoramax*.

```
VoltFrame (Worker) ──HTTPS + token──► Cloudflare (proxy) ──► balanceador L7 do Zerops ──► `pano`
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
| `panoramax/service_account.py` | Cria a conta de serviço `pictures` (não admin) e roda o token |

---

## 1. Próximos passos

- [ ] Criar o projeto no Zerops (core *Lightweight*) e passar o ID.
- [ ] Importar os serviços: `zcli project service-import zerops-import.yaml -P <project-id>`.
- [ ] Criar o bucket R2 `panoramax` e um token R2 só para ele
  (secção 5).
- [ ] Pôr o `FS_URL` como variável secreta do `pano` (secção 6).
- [ ] Ligar o webhook do GitHub ao `pano` (secção 8) ou fazer o primeiro
  deploy à mão: `zcli push pano --setup pano`.
- [ ] Ensaio de um dia (secção 9), no subdomínio `zerops.app`.
- [ ] Domínio `panoramax.ocarroeletrico.com` na Cloudflare (secção 7).
- [ ] Atualizar o `plan.md` com o resultado do ensaio.

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
| `db` | 1 CPU / 0,25 GB / 1 GB disco | 2 CPU / 1 GB / 5 GB | 1 (`single`) |

Tudo em CPU `SHARED`. O segundo container do `pano` só existe durante um
deploy (rolling).

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

- `api`: `gunicorn geovisio:create_api()` com 2 workers × 4 threads.
- `worker`: `panoramax_backend picture-worker`. Gera os tamanhos, lê os
  metadados e corre o cron diário de estatísticas. Por isso a API tem
  `PICTURE_PROCESS_THREADS_LIMIT=0`: não processa fotos dentro do pedido.

Os `startCommands` correm em bash (visto no primeiro deploy, 2026-11-24):
o `geovisio:create_api()` sem aspas dava `syntax error near unexpected
token '('`. Caracteres especiais do shell vão entre aspas simples.

**Verificações:** `readinessCheck` e `healthCheck` em
`/api/configuration`, sem autenticação.

---

## 4. Configuração

Variáveis no `zerops.yml` (não secretas) e no Zerops (secretas). As do
Panoramax estão em
[settings](https://docs.panoramax.fr/backend/install/settings/); confirmei os
nomes no código da 2.17.0 (`geovisio/config_app.py`).

| Variável | Valor | Porquê |
| --- | --- | --- |
| `DB_URL` | `${db_connectionString}` (porta 5432) | Não o pgBouncer (6432): o Panoramax manda `-c statement_timeout` na ligação, que o pgBouncer recusa |
| `PANO_DB_SUPERUSER_URL` | superuser do `db` | Só para o `bootstrap_db.py`; tirado dos processos com `env -u` |
| `DB_MAX_CNX` | `5` | Por processo gunicorn; a BD tem 0,25 GB |
| `FS_URL` | **secreta**, ver secção 6 | Bucket R2 `panoramax` |
| `FLASK_SECRET_KEY` | **secreta**, gerada no import | Sessões e tokens JWT. Trocá-la invalida o token da conta de serviço |
| `API_SUMMARY` | nome, descrição, cobertura, cor, email | O que aparece no `/api/configuration` e na federação |
| `API_WEBSITE_URL` | `false` | Não há site Panoramax à parte; a API serve o seu visualizador em `/` |
| `API_PICTURES_LICENSE_SPDX_ID` / `_URL` | `CC-BY-SA-4.0` | Licença do servidor (`plan.md`, *Licença*) |
| `API_REGISTRATION_IS_OPEN` | `false` | Ninguém cria conta |
| `API_FORCE_AUTH_ON_UPLOAD` | `true` | Só com token se envia |
| `API_DEFAULT_PICTURE_VISIBILITY` | `owner-only` | A foto só fica pública quando o VoltFrame a aprova |
| `PICTURE_PROCESS_THREADS_LIMIT` | `0` | O processamento é do `worker` |
| `PICTURE_PROCESS_DERIVATES_STRATEGY` | `PREPROCESS` | Gera os tamanhos logo ao receber (são poucas fotos e evita latência na primeira visualização) |
| `INFRA_NB_PROXIES` | `1` no subdomínio, `2` com a Cloudflare | Secção 7 |

### Configuração gravada na BD

No primeiro arranque, o Panoramax grava `API_DEFAULT_PICTURE_VISIBILITY`
(e a edição colaborativa de metadados) na tabela `configurations`. Depois
disso, **mudar a variável não tem efeito**: só um aviso no log. Para mudar,
é um `UPDATE configurations SET default_visibility = …` na BD.

### Contas: sem OAuth, e a conta de serviço não é admin

O `plan.md` previa `OAUTH_PROVIDER=osm` só para a conta de serviço e o
admin. **Proposta: não ligar OAuth nenhum** (por decidir, ver secção 11): as rotas `/api/auth/*` respondem 501 e
ninguém consegue entrar, nem por engano. Não há app OAuth no OSM para
manter.

Há duas contas:

| Conta | Papel | Para quê |
| --- | --- | --- |
| Conta por omissão (criada pela migração inicial) | `admin` | Manutenção à mão. O token não sai do container |
| `pictures` | `user` | Envios do VoltFrame. O token vai para o Worker |

A `pictures` não é admin de propósito. Pode enviar fotos e mudar a
visibilidade das suas, que é tudo o que o VoltFrame faz. Se o token vazar,
quem o tiver não consegue mudar papéis nem tratar denúncias como admin.
**Mas isso não protege as fotos:** são todas da `pictures`, por isso quem
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
assim que a transação termina, e o novo vai direto para o `wrangler secret put`.

```bash
# no container (zcli vpn up <project-id>; ssh pano)
cd /var/www
/opt/venv/bin/python panoramax/service_account.py | npx wrangler secret put PANORAMAX_TOKEN
```

O JWT não expira. Para o **revogar** sem criar outro, apagam-se todos os
tokens da conta, nunca só uma linha:

```sql
DELETE FROM tokens WHERE account_id = (SELECT id FROM accounts WHERE name = 'pictures');
```

Para revogar e emitir um novo, basta voltar a correr o script. Trocar o
`FLASK_SECRET_KEY` invalida todos os tokens do servidor de uma vez.

O crédito por foto continua a ser o ponto 5 do ensaio: as fotos ficam todas
em nome de `pictures`, e o autor vai na etiqueta `pictures|author=`.

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

---

## 6. Segredos

**Nenhum segredo no repositório nem no GitHub.** No serviço `pano`
(Zerops → serviço → *Environment variables*, como *secret*):

| Variável | Origem |
| --- | --- |
| `FLASK_SECRET_KEY` | Gerada no import (`<@generateRandomString(<64>)>`) |
| `FS_URL` | À mão, depois do import, com o token R2 da secção 5 |

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

Por ordem:

1. **Zerops:** registar `panoramax.ocarroeletrico.com` no balanceador
   (*public HTTP routing*), porta 5000 do `pano`, SSL ligado. Sem isto o
   balanceador responde 404.
2. **Cloudflare:** `panoramax  AAAA  <IPv6 do projeto>  proxy: ON`. SSL
   *Full (strict)*.
3. **Zerops:** validar o DNS. O certificado Let's Encrypt é emitido.
4. Mudar `INFRA_NB_PROXIES` para `2` e fazer deploy.
5. `accessPolicy` do balanceador: só aceitar as gamas da Cloudflare
   (`https://www.cloudflare.com/ips-v4` e `ips-v6`).
6. Desligar o subdomínio `zerops.app`, que fica fora da Cloudflare.

**Limite de envio.** O subdomínio `zerops.app` corta os pedidos acima de
50 MB e o domínio próprio acima de 512 MB. As fotos chegam com 2048 px
(menos de 2 MB), por isso nenhum dos limites conta.

**Proxies.** Com `INFRA_NB_PROXIES=N`, o Panoramax confia nas últimas N
entradas dos `X-Forwarded-*` para montar os URLs absolutos (`https://…`)
das respostas STAC. Se o valor estiver errado, os links saem `http://` ou
com o host interno. É um dos pontos do ensaio.

---

## 8. Deploy

**Webhook do Zerops, como no CEME.** O GitHub Actions não faz deploy e não
guarda credenciais do Zerops.

> Serviço `pano` → **Build, Deploy, Run Pipeline Settings** → **Connect
> with a GitHub repository** → `CarregaErvilhas/VoltFrame`, trigger
> **Push to branch: `main`**, setup `pano`.

À mão, em último recurso: `zcli push pano --setup pano` na raiz do repo
(usa `git archive`: faz commit antes).

### Atualizar o Panoramax

1. Ler o [changelog](https://gitlab.com/panoramax/server/api/-/blob/develop/CHANGELOG.md)
   entre as versões, à procura de migrações e variáveis novas ou retiradas
   (o `config_app.py` recusa arrancar com algumas antigas).
2. Mudar `geovisio==` no `requirements.in`. O Dependabot abre o PR
   (ecossistema `pip`, pasta `/panoramax`).
   Depois de mudar o `requirements.in`, regenerar o lock
   (`requirements.txt`, secção 3) e fazer commit dos dois.
3. Se a versão nova trouxer migrações: fazer um backup da `db` antes, e
   fazer o deploy com `deploy.temporaryShutdown: true` (alguns segundos sem
   serviço em vez de um container antigo a falar com um schema novo). O
   rolling deploy não reverte uma migração com commit (secção 3); voltar
   atrás é restaurar o backup.

---

## 9. Ensaio de um dia

Os seis pontos do `plan.md`, mais os que saíram ao preparar a
configuração. Em cada um, o que já sei e como se testa.

| # | Verificar | O que já sei | Como testar |
| --- | --- | --- | --- |
| 1 | PostGIS 3.4+ no PostgreSQL gerido | A documentação do Zerops dá `CREATE EXTENSION postgis` como exemplo, com o superuser | O log do `bootstrap_db.py` mostra a versão; falha se for < 3.4 |
| 2 | R2 como `FS_URL` | O OpenDAL só manda ACL com `acl=` no URL | Enviar uma foto; ver `permanent/` e `derivatives/` no bucket |
| 3 | Foto isolada com etiquetas, pela API | — | `POST /api/upload_sets` → `/files` → `/complete`, com as etiquetas do `plan.md` |
| 4 | `owner-only` e passar a `anyone` ao aprovar | Visibilidade por omissão configurável | Ver que a foto não aparece sem token; mudar a visibilidade; ver que aparece |
| 5 | Crédito por foto (autor ≠ conta de serviço) | — | Etiqueta `pictures\|author=` e o que o visualizador e o STAC mostram |
| 6 | Consumo de recursos dentro do orçamento | — | Consumo real na GUI ao fim do dia, com ~100 fotos enviadas |
| 7 | O pip instala o `geovisio` no `ubuntu/python@3.14` | As wheels `cp314` existem; a instalação não foi testada | Log do *prepare* |
| 8 | `run.base: ubuntu/python@3.14` é aceite | A documentação mostra a forma `ubuntu/nodejs@22`; o CEME usa `alpine/nodejs@24` | O primeiro deploy |
| 9 | `INFRA_NB_PROXIES` | — | `curl …/api/collections` e ver se os `href` saem `https://panoramax.ocarroeletrico.com/…`, primeiro no subdomínio e depois atrás da Cloudflare |
| 10 | RAM do processamento | — | Enviar 20 fotos seguidas e ver o pico de RAM do `pano` |

Comandos úteis no container (`zcli vpn up <project-id>`, depois
`ssh pano`):

```bash
cd /var/www
/opt/venv/bin/python panoramax/service_account.py   # conta `pictures` + rotação do token (secção 4)
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
- O D1 do VoltFrame guarda o `panoramax_id` de cada foto. Com isso e o
  bucket, dá para reconstruir a ligação foto → posto.

---

## 11. Questões em aberto

- [ ] ID do projeto Zerops.
- [ ] Sem OAuth (secção 4)? Se sim, atualizar o `plan.md`.
- [ ] `API_PICTURES_LICENSE_URL`: hoje aponta para a CC BY-SA 4.0. Quando houver uma página do VoltFrame com a autorização ODbL, passa para lá (como faz o Panoramax da OSM França).
- [ ] Cópia de segurança das fotos do R2 (outro bucket, outra conta, ou o Commons para as principais).
- [ ] Os dez pontos do ensaio (secção 9).
