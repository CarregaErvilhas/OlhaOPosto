# Cloudflare — recursos do VoltFrame

2026-11-24 · zona `ocarroeletrico.com`, na conta Cloudflare existente. O
servidor Panoramax (Zerops, bucket `panoramax`, DNS do `panoramax.*`) está em
[`infra.md`](infra.md). O design está em [`plan.md`](plan.md), secções *Nomes
e domínios* e *Links estáticos*.

## 1. Estado

| O quê | Estado |
| --- | --- |
| R2 `pictures` | Criado (WEUR), público em `pictures.ocarroeletrico.com`, vazio |
| R2 `pictures-staging` | Criado (WEUR), privado, vazio |
| Cache Rule do `pictures.*` | Aplicada e testada |
| Worker `pictures` + D1 `pictures` em `voltframe.ocarroeletrico.com` | Por fazer (fase 2) |

## 2. R2

| Bucket | Acesso | Para quê |
| --- | --- | --- |
| `pictures` | Público só pelo custom domain `pictures.ocarroeletrico.com`; `r2.dev` desligado | Links estáticos: as três chaves de cada foto principal |
| `pictures-staging` | Privado: sem domínio, `r2.dev` desligado | Versões de 1024 e 400 px até à aprovação |
| `panoramax` | Privado ([`infra.md`](infra.md), secção 5) | Armazenamento do Panoramax |

O `pictures-staging` tem de ser um bucket à parte, não um prefixo em
`pictures`: tudo o que está em `pictures` fica público pelo domínio.

## 3. `pictures.ocarroeletrico.com`

**Custom domain.** TLS mínimo **1.3**, por escolha (2026-11-24). Fica de
fora quem só fala TLS 1.2: Android 9 e mais antigos, iOS anterior ao 12.2,
apps nativas do Windows 10 (Schannel, .NET Framework, PowerShell 5) e Java
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

## 4. Questões em aberto

- [ ] Regra de ciclo de vida no `pictures-staging` como rede de segurança
  para fotos rejeitadas ou abandonadas (por exemplo 90 dias). O risco é
  apagar as versões de uma foto que ainda está na fila.
