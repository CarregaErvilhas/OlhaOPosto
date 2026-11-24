# Plano — o que falta construir

Diagrama e ecrãs: `Design/Fluxo-panoramax.html` e `Design/Ecras-panoramax.html`.

Este documento só tem o que ainda não existe. O que já está a funcionar
(objetivos, princípios, domínios, servidor Panoramax, import dos postos,
páginas, pesquisa e API só de leitura, login OSM, política de privacidade e
a parte do envio que corre no browser) está em [`arquitetura.md`](arquitetura.md). Quando
uma parte daqui fica feita, sai deste documento e a descrição do que ficou
passa para lá, para o [`cloudflare.md`](cloudflare.md) ou para o
[`infra.md`](infra.md).

## Fases

1. **Panoramax.** Falta:
   - medir o custo mensal no Zerops (ponto 6 do ensaio, [`infra.md`](infra.md), secção 9);
   - começar a conversa com a OSM Portugal e a equipa do Panoramax (proposta no fórum da comunidade OSM, categoria Portugal, e no fórum do Panoramax).
2. **O site para pessoas.** Falta:
   - ligar o login OSM, que já está feito mas desligado ([`cloudflare.md`](cloudflare.md), secção 4): falta registar a aplicação no OSM e pôr os segredos; depois, uma ligação para `/enviar` no cabeçalho (hoje chega-se lá pela conta);
   - envio de fotos: a página `/enviar` já prepara a foto no browser com a desfocagem à mão; o que falta está no *Fluxo de upload*;
   - fila de moderação com promoção manual;
   - foto principal e publicação em `pictures.*`;
   - aliases de postos;
   - ranking e medalhas;
   - fotos na API;
   - link manual "acrescentar ao OSM";
   - o `charger_photos.py` do NAP dashboard a perguntar também ao nosso Panoramax;
   - entrada na federação, depois da conversa com a comunidade.
3. **Bot e agentes.** Bot do OSM (depois da aprovação da comunidade), servidor MCP, escrita pela API com tokens, exportação `photos.json` lida pelo NAP dashboard e pelo ohmigo, listas de postos sem foto.
4. **Desfocagem no servidor**, quando houver uma GPU a um custo razoável.

## Panoramax: etiquetas e federação

Cada foto enviada leva etiquetas `chave=valor` ([sintaxe](https://docs.panoramax.fr/tags/syntax/)):

```
osm|ref:EU:EVSE=PT*TRK*E*VNT*00005*01
pictures|site=TRK-VNT-00005
pictures|author=joao_osm
```

**Federação.** Abre-se um pedido no repositório do catálogo federado e os operadores acrescentam o servidor ao *harvester* ([como](https://docs.panoramax.fr/how-to-contribute/hosting-instance/)). Só depois da conversa com a OSM Portugal e com a equipa do Panoramax; até lá o servidor fica privado.

## Modelo de dados (D1)

As imagens vivem no Panoramax (originais e tamanhos) e, para as fotos principais, no bucket `pictures`. A D1 guarda metadados, a ligação a postos e tomadas e as escolhas. As tabelas `stations`, `evses`, `users` e `sessions` já existem ([`arquitetura.md`](arquitetura.md), *Postos e tomadas*). Faltam:

| Tabela | Colunas principais | Notas |
| --- | --- | --- |
| `station_aliases` | `old_id` (PK), `new_id` (FK), `created_by`, `created_at` | Re-keys do NAP, só à mão; o link antigo responde `301` |
| `photos` | `id` (UUID), `panoramax_id`, `origin` (`pictures`, `osm_panoramax`, `commons`, `mapillary`), `station_id`, `evse_id` (nulo = foto geral), `uploader_id`, `taken_at`, `exif_lat`, `exif_lon`, `distance_m`, `license`, `credit`, `status` (`pending`, `published`, `hidden`, `removed`), `approved_by`, `created_at` | GPS do EXIF guardado só para moderação, nunca publicado. Fotos externas: só referência |
| `selections` | `target` (PK: `id` do posto ou EVSE compacto), `photo_id`, `chosen_by`, `chosen_at`, `published_at` | Qual foto o link estático serve; ver *Publicação dos links estáticos* |
| `review_queue` | `id`, `kind` (`new_station`, `photo`, `takedown`), `payload` (JSON), `submitted_by`, `status`, `decided_by`, `decided_at`, `note` | Fila única para tudo o que precisa de um humano |
| `points` | `user_id`, `photo_id`, `points`, `reason` (`approved`, `first_photo`, `refresh`), `month` | Ver *Gamificação* |
| `osm_edits` | `osm_element`, `key`, `value`, `photo_id`, `changeset`, `written_at` | O que o bot escreveu no OSM, para só alterar valores dele |

Os *tokens* de API vão para uma tabela própria, só com o hash, como as sessões.

Regras:

- Um `photo_id` em `selections` tem de pertencer ao mesmo posto ou EVSE (verificado no Worker).
- Quando não há seleção explícita, a primeira foto aprovada de um alvo passa a principal.
- Apagar uma foto = `status=removed`, apagar no Panoramax e, se for principal, apagar as cópias em `pictures`; o registo fica para auditoria.

## Fluxo de upload

Tudo o que envolve a foto original acontece no browser: lê-se o EXIF, desfoca-se e re-codifica-se antes do envio. O servidor nunca recebe o original nem os metadados.

A página `/enviar` já faz a parte do browser: abre um JPEG, lê o EXIF, sugere o posto, deixa marcar zonas à mão, desfoca-as e gera os três tamanhos sem metadados ([`cloudflare.md`](cloudflare.md), secção 4, *Página de envio*). Falta, por ordem do fluxo:

1. **Termos e licença.** Na primeira vez, aceitar e guardar `license_accepted_at`. Hoje a página pede as duas confirmações em cada foto, mas não guarda nada.
2. **HEIC e várias fotos.** A página aceita um JPEG de cada vez. No iPhone, o seletor converte HEIC para JPEG (falta confirmar num iPhone que o GPS sobrevive à conversão). Nos outros browsers, `heic2any` (libheif em WebAssembly, ver a licença) e um leitor do EXIF dentro do HEIC.
3. **Mapa** para escolher o posto quando a foto não tem GPS; hoje só há a pesquisa por texto.
4. **Posto não existe?** Formulário "novo posto": nome, operador, coordenadas (pré-preenchidas pelo GPS) e código se for conhecido. Cria `stations.status=pending_review` e uma entrada em `review_queue`.
5. **Deteção automática** de caras e matrículas, que pré-desenha as zonas (ver *Desfocagem*).
6. **Enviar.** `POST /api/v1/photos` com as três imagens e um JSON: alvo, `taken_at`, `exif_lat`/`exif_lon`.
7. **Validar no Worker.** Sessão, limite de envios (50 fotos/dia para `contributor`), Turnstile, alvo existente, nenhum segmento de metadados nos bytes (o `isCleanJpeg` de `worker/public/jpeg.js`, que a página já usa), `distance_m` ao posto.
8. **Enviar para o Panoramax** com a conta de serviço: `POST /api/upload_sets`, depois `.../files` com a mestre de 2048 px, as coordenadas do posto, a data do EXIF, `isBlurred=true` e as etiquetas (`osm|ref:EU:EVSE=…`, `pictures|site=…`, `pictures|author=…`), e `.../complete`. Visibilidade `owner-only` até ser aprovada. As versões de 1024 e 400 px ficam num bucket R2 privado (`pictures-staging`) até à aprovação.
9. **Publicar ou rever.**
    - Conta `trusted` (promovida à mão), posto `active` e dentro de 300 m → aprovada logo.
    - Conta `contributor` → sempre `pending`, à espera de um moderador. Todas as contas novas começam aqui.
    - Sem GPS, a mais de 300 m ou com posto novo → `pending` mesmo para `trusted`. Estes sinais também ordenam a fila e aparecem como avisos.
10. **Ao aprovar.** O Worker passa o upload set a `anyone` no Panoramax (`PATCH /api/upload_sets/<id>` com `{"visibility": "anyone"}`; a visibilidade da foto sozinha não chega, porque vale a mais restritiva entre foto e coleção), marca-a `published`, atribui os pontos e, se o alvo não tinha principal, publica-a em `pictures` (ver *Publicação dos links estáticos*).

**O que se faz com a localização do EXIF**

- Sugere o posto e evita fotos no posto errado.
- Sinaliza discrepâncias: uma foto a 2 km do posto vai para revisão.
- Ajuda a corrigir coordenadas: se várias fotos de pessoas diferentes concordam entre si e divergem do NAP, gera-se uma pista para reportar ao OPC ou corrigir no OSM.
- Fica só na D1, visível para moderadores; a API pública mostra a data, nunca as coordenadas de quem tirou a foto.
- O Panoramax é um mapa de fotos e pede coordenadas: recebe as **coordenadas do posto**, nunca as do EXIF, para manter a regra de nunca publicar o GPS de quem tirou a foto.

## Publicação dos links estáticos

O formato dos URLs, o bucket e a cache já existem ([`arquitetura.md`](arquitetura.md), *Links estáticos*). Falta a publicação: a resolução código → foto acontece **na escrita, não no pedido**. Quando a foto principal muda, o Worker copia-a para a chave pública no bucket `pictures` e faz *purge* desse URL na cache.

- **Cache:** cada objeto gravado com `Cache-Control: public, max-age=86400`; *purge* ao mudar a principal (também na primeira foto, por causa do `404` em cache). No pior caso, um browser mostra a foto antiga durante 24 h.
- **Atribuição:** o R2 não devolve cabeçalhos próprios, por isso o autor e a licença vão no **XMP/IPTC** da cópia pública (sem GPS), escritos pelo Worker ao publicar. O Panoramax mostra sempre `pictures` como produtor (ponto 5 do ensaio), por isso o crédito do autor é este. O crédito completo fica em `voltframe.ocarroeletrico.com/p/{photo_id}`, que a CC BY-SA exige.
- **Re-keys:** o `301` do código antigo é uma regra de redirect da Cloudflare gerada a partir de `station_aliases`.
- **Fotos externas** (MapComplete, Commons): só na galeria, nunca a principal. Ver abaixo.

**Mudanças de código (re-key).** O NAP às vezes muda o código de um local. Quando isso acontece, o posto antigo fica `missing_from_nap` com as fotos. O admin tem uma lista "postos com fotos que saíram do NAP"; um moderador escreve o código novo e o link antigo passa a responder `301` para o novo. Sem sugestões automáticas.

### Fotos externas e links estáticos

**Caso de uso.** Um posto tem uma foto que alguém pôs no OSM (pelo MapComplete, guardada no Panoramax deles) ou no Commons, mas ninguém a enviou pelo VoltFrame. O NAP dashboard já a mostra. O link estático `pictures.ocarroeletrico.com/<id>.jpg`, porém, só serve ficheiros que estejam no bucket: o `pictures.*` não tem Worker e não faz redirects.

**Em comum às duas opções.** O cron diário lê as fotos que o `charger_photos.py` do NAP dashboard já recolhe do OSM (`panoramax=`, `wikimedia_commons=`, `mapillary=`, `image=`, com autor, licença e miniatura) e guarda-as em `photos` com `origin=osm_panoramax` ou `commons`, só como referência, com o autor e a licença de origem. A API e a página do posto mostram-nas com o link para a origem. As do Mapillary ficam de fora (a API deles pede uma chave).

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

Já existem `GET /stations?q=` (pesquisa por texto), `GET /stations?lat=&lon=&radius=` (proximidade), `GET /stations/{id}` e `GET /evses/{evse}`, sem fotos ([`cloudflare.md`](cloudflare.md), secção 4). Falta descrevê-la em OpenAPI 3.1 em `/api/v1/openapi.json`, juntar as fotos e os links estáticos a essas duas respostas, e o resto. Os `GET` são públicos e têm CORS aberto; as escritas pedem sessão ou token.

| Método e rota | Faz | Auth |
| --- | --- | --- |
| `GET /stations?opc=&has_photo=` | Juntar às pesquisas por texto e por proximidade: operador ou falta de foto | — |
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

O `/llms.txt` já existe (`worker/public/llms.txt`), com as páginas, a API, os links estáticos e as licenças. Falta acrescentar o MCP, o envio de fotos e os tokens quando existirem, com uma página `.md` para cada um (o que a [proposta](https://llmstxt.org/) pede para os links), e o cabeçalho `Link: </llms.txt>; rel="describedby"; type="text/markdown"` nas páginas HTML.

## Autenticação

**Só login com conta OpenStreetMap (OAuth2)**, no `voltframe.*`. Ler as fotos e a API é público; só o envio e a moderação pedem login. GitHub fica para depois, se alguém o pedir: a maior parte da comunidade EV não tem conta lá.

O início de sessão já está feito e desligado: como funciona e como se liga está no [`cloudflare.md`](cloudflare.md), secção 4. Nunca se pede `write_api` aos contribuidores: as edições no OSM são do bot ou manuais.

**O que falta**

1. Ligá-lo: aplicação registada no OSM e segredos `OSM_CLIENT_ID`/`OSM_CLIENT_SECRET` no Worker.
2. O token da conta de serviço do Panoramax como segredo do Worker, com o envio.
3. Proteção do envio: Cloudflare Turnstile no formulário, limite de envios por utilizador (50 fotos/dia para `contributor`) e verificação de origem em cada `POST`, como já faz o `/auth/logout`.
4. Painéis `/admin` (fila de revisão, remoções, postos fora do NAP) atrás de Cloudflare Access, além do papel `moderator` na D1: duas camadas para a parte sensível.

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

**No browser, para já.** O editor de zonas já existe em `/enviar`: a pessoa desenha um retângulo por cima de cada cara ou matrícula e a página cobre-o com um mosaico grosso. Falta o detetor: ONNX Runtime Web ou MediaPipe no telemóvel, que pré-desenha as zonas para a pessoa confirmar, acrescentar ou remover (o WebAssembly vai pedir `'wasm-unsafe-eval'` na CSP dessa página). O original nunca sai do telemóvel, e o envio para o Panoramax vai com `isBlurred=true`.

- **Caras:** MediaPipe Face Detector (Apache 2.0).
- **Matrículas:** modelo por escolher, com pesos de licença permissiva. Os YOLO da Ultralytics são AGPL-3.0, por isso não servem para distribuir no browser. Matrículas de carros a carregar são o caso comum; vale a pena dar prioridade a este detetor.
- **Abuso:** um cliente alterado pode enviar fotos sem desfocar. A mitigação: só publicam direto os `trusted`, promovidos à mão; o resto passa pela fila.

**No servidor, mais tarde (fase 4).** O Panoramax liga-se a um serviço de desfocagem por `API_BLUR_URL` (hoje vazio); o de produção é o [sgblur](https://gitlab.com/panoramax/server/sgblur) (código MIT, modelo YOLOv11 para caras e matrículas). A deteção pede uma GPU NVIDIA (a CPU não é recomendada em produção) e a imagem Docker tem cerca de 7 GB. O Zerops não tem GPU. Falta encontrar uma forma barata de o correr em escala (GPU à hora, Cloudflare, ou outro fornecedor) antes de o ligar.

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

## RGPD e moderação

A licença das fotos (CC BY-SA 4.0 com autorização ODbL) está em [`licenca.md`](licenca.md). O uploader aceita-a uma vez (`license_accepted_at`) e declara que tirou a foto. Fotos referenciadas do OSM ou do Commons mantêm a licença e o autor de origem.

**RGPD**

- **Dados de quem envia:** ID e nome do OSM, pseudónimo opcional, papel e GPS das fotos. Sem email.
- **Pessoas e matrículas nas fotos:** desfocagem obrigatória e caixa a confirmar no envio.
- **Pedidos de remoção:** formulário público `/takedown` (sem login, com Turnstile). A foto fica `hidden` de imediato (no VoltFrame, no Panoramax e em `pictures`) e um moderador decide em **72 h**.
- **Política de privacidade:** publicada em `/privacidade`, com o responsável, os registos, o login, os *cookies* e o que a página de envio já pede à API. Falta o envio em si (desfocagem, GPS guardado para a moderação, licença, remoção) antes de o abrir.
- **Conservação:** o GPS fica na D1 só para moderação; as versões em `pictures-staging` apagam-se ao aprovar ou rejeitar; logs com retenção curta.

**Moderação**

- Fila única (`review_queue`) com três tipos: posto novo, foto pendente e remoção.
- Todos os envios de contas `contributor` passam pela fila; só `trusted` (promovidos à mão) publicam direto.
- Critérios de rejeição: posto errado, privacidade, qualidade (desfocada, escura), duplicado, publicidade.
- Histórico de decisões visível para moderadores; o autor recebe o motivo na sua página.
- Moderadores: só o Fernando no lançamento; a lista de moderadores da comunidade vem depois. Com um só moderador, o prazo de 72 h depende de ele estar disponível; como a foto fica oculta logo, o risco é atraso, não exposição.

## Custos

Orçamento: **10 €/mês** no total.

- **Panoramax no Zerops** (API, *workers*, PostgreSQL): o custo fixo maior, ainda por medir (ponto 6 do ensaio). Em repouso usa os mínimos (0,5 GB de RAM e 0,06 de 1 CPU no `pano`) e o pico de 20 fotos ficou abaixo de 1 GB. Se passar o orçamento, VPS pequena com o Docker Compose do Panoramax.
- **R2:** com 100k fotos, ~100 GB no bucket `panoramax` (mestre e tamanhos) e ~25 GB em `pictures` (só as principais, três tamanhos), ~1,7 $/mês: 10 GB-mês grátis e depois 0,015 $/GB-mês, sem custos de tráfego ([preços R2](https://developers.cloudflare.com/r2/pricing)). As leituras de `pictures.*` são Classe B (10 milhões grátis por mês).
- **Workers e D1:** plano grátis. Como as fotos não passam pelo Worker, o limite de 100 000 pedidos/dia só conta para o site e a API em `voltframe.*`. Workers Paid (5 $/mês) só se o site ou a API o pedirem.

## Questões em aberto

- [ ] Lista de moderadores da comunidade.
- [ ] Como correr a desfocagem no servidor com GPU de forma barata, em escala.
- [ ] Modelo de deteção de matrículas para o browser, com pesos de licença permissiva.
- [ ] Resposta da OSM Portugal e da equipa do Panoramax (federação, nome, bot).
- [ ] Convenção do MapComplete para várias fotos no mesmo elemento (`panoramax:1=`?).
- [ ] Fotos externas e links estáticos: rever a opção B (em uso) contra a A ou outras alternativas.
