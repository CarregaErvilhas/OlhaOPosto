# Fotos dos postos de carregamento — design técnico

2026-11-22 · Fernando · versão viva: https://claude.ai/artifact/MUBnnd1mgtC66Sje56oFqN

## Resumo e objetivos

Proposta: um serviço comunitário em Cloudflare (R2 + Workers + D1) que guarda fotos de postos e tomadas e serve links estáticos pelo ID oficial, por exemplo `https://fotos.exemplo.pt/OPC-XXXXXXXXXX.jpg`. Custo estimado de ~1 $/mês para 100k fotos (mais o Workers Paid, se o tráfego o pedir).

Requisitos (proposta de Alexandre Moleiro):

- Servidor que aloja as fotos e gera links estáticos.
- Upload obrigatoriamente associado a um posto (`OPC-XXXXXXXXXX`) ou a uma tomada (`PT-OPC-E-YYYYYYYYY`).
- O posto tem de existir; pesquisa por referência, morada ou coordenadas. Postos novos entram numa fila de revisão humana.
- Quando há várias fotos, escolher qual alimenta cada link estático.
- Links por posto (`/OPC-XXXXXXXXXX.jpg`) e por tomada (`/PTOPCEYYYYYYYYY.jpg`), usáveis por qualquer app ou mapa (OSM, NAP dashboard).

Princípios de design:

- **URL estável, conteúdo trocável**: o link nunca muda; muda apenas a foto que ele aponta.
- **Dados oficiais como base**: postos e EVSE vêm do NAP/Mobi.E; o OSM serve de complemento.
- **Privacidade por defeito**: desfocagem de caras e matrículas e remoção do EXIF antes de publicar.
- **Licença aberta obrigatória** (CC BY-SA 4.0 ou CC0), para poder ser usada no OSM.
- **Saída fácil**: dados exportáveis e código aberto, para a comunidade não depender de uma pessoa ou conta.

## Arquitetura

```
 Pessoas (web)   Apps/mapas (REST)   Agentes (MCP / A2A)
        \               |                  /
         +------ Cloudflare Worker -------+
          |            |            |      :
          R2          D1         Queues  [B: sgblur — fase 3]
        (fotos)   (metadados)
                       ^
         ETL diário (GitHub Actions): NAP · MOBI.Data · OSM
```

Pessoas, apps e agentes entram pelo mesmo Worker; os dados do NAP e do OSM chegam por um ETL diário fora da Cloudflare. A parte da desfocagem no servidor só entra na fase 3. Tudo cabe nos planos grátis do R2 e da D1; o Workers passa a pago quando o tráfego o pedir.

## Fontes de postos existentes

A lista de postos válidos vem do NAP (fonte oficial). O OSM entra como complemento: postos planeados e fotos que já lá existem. No snapshot de 2026-11-21 do NAP dashboard havia **8 862 locais e 19 693 pontos** ([network-census.json](https://github.com/CarregaErvilhas/nap-dashboard/blob/main/network-census.json)). Os "20k" são portanto pontos/tomadas; os locais rondam os 9k.

| Fonte | O que traz | Formato | Uso aqui |
| --- | --- | --- | --- |
| [NAP — inventário estático](https://ocarroeletrico.com/afir-nap/) `pgm.mobie.pt/integration/nap/evChargingInfra` | Todos os OPC, local → EVSE → conector, coordenadas, morada | XML DATEX II 3.3, ~190 MB | Fonte principal de `stations` e `evses` |
| MOBI.Data `data.mobie.pt/data/stations.json` | Nome, morada, município, `partyId`, tomadas (`evse`, `connector`) | JSON | Atalho leve; só rede MOBI.E e sem licença explícita |
| [NAP dashboard](https://nap.ocarroeletrico.com/) ([código](https://github.com/CarregaErvilhas/nap-dashboard)) | Já faz o parse do NAP, a junção com o MOBI.E e o cruzamento com o OSM | Python + GitHub Actions | Reutilizar o ETL em vez de o reescrever |
| OSM (Overpass) | `amenity=charging_station` e `man_made=charge_point`, com `ref`, `ref:EU:EVSE` e fotos | JSON | Postos planeados, fotos existentes, sugestões de edição |

**Sincronização proposta**

1. Um job diário (GitHub Actions, no repo do NAP dashboard ou num repo irmão) corre o ETL existente e gera um `sites.json` compacto: código do local, nome, lat/lon, morada, operador e lista de EVSE.
2. O job envia esse ficheiro para um endpoint de importação do Worker (com token) ou aplica-o à D1 com `wrangler d1 execute`.
3. A importação faz *upsert*: postos novos entram como `active`, postos que desaparecem passam a `missing_from_nap` (nunca são apagados, para os links e as fotos continuarem a funcionar).

Não se processa o XML de 190 MB dentro do Worker: cada isolate tem um limite de 128 MB de memória ([limites Workers](https://developers.cloudflare.com/workers/platform/limits)).

**OSM — consulta Overpass** (PT continental e ilhas):

```
[out:json][timeout:180];
area["ISO3166-1"="PT"][admin_level=2]->.pt;
nwr(area.pt)[~"^(amenity|man_made)$"~"^(charging_station|charge_point)$"];
out center tags;
```

O que se aproveita do OSM:

- **Junção pelo `ref`**, que leva o código do local (às vezes com prefixo `MOBI-`, a tirar só quando o código sem prefixo existe no NAP). Sem `ref` válido, junta-se pelo `ref:EU:EVSE`. O `osm_tags.py` do NAP dashboard já faz as duas coisas.
- **Postos planeados ou em obra** (`construction:*`) que ainda não estão no NAP: entram como candidatos na fila de revisão.
- **Fotos já publicadas** (`panoramax=`, `mapillary=`, `wikimedia_commons=`, `image=`): importadas como referências externas, com autor e licença, para os postos não começarem vazios.
- **Lista de elementos OSM sem foto**, para sugerir edições quando o posto já tem foto aqui.

**Armadilhas de IDs** (do [gotchas.md](https://github.com/CarregaErvilhas/nap-dashboard/blob/main/references/gotchas.md) do NAP dashboard):

- Juntar pelo `site_external_id` do NAP. O `point_external_id` (`PT*op*[E]*reg*num*tom`) não é fiável: às vezes traz `ELSB` em vez de `LSB` e tem entre 3 e 7 segmentos.
- Os EVSE do MOBI.Data aparecem em vários formatos (`ABF-00011-01`, `PT-EDP-EABF-00008-1`) e centenas são só números (`97`).
- O `ref:EU:EVSE` do OSM está rigorosamente igual ao código EVSE do NAP (ex. `PT*EDP*E*LSB*90050*01`), por isso a junção faz-se pelo código tal como vem, sem normalizar nem tirar zeros à esquerda. O link estático é esse mesmo código sem os `*`: `PTEDPELSB9005001`, que é o formato do Alexandre.

## Modelo de dados (D1)

Seis tabelas chegam. As fotos guardam-se no R2 com uma chave interna (`p/<uuid>/<tamanho>.jpg`); a D1 só guarda metadados e a escolha de qual foto alimenta cada link.

| Tabela | Colunas principais | Notas |
| --- | --- | --- |
| `stations` | `code` (PK, ex. `TRK-VNT-00005`), `opc`, `name`, `address`, `municipality`, `lat`, `lon`, `source` (`nap`, `osm`, `community`), `status` (`active`, `missing_from_nap`, `pending_review`, `rejected`), `osm_ref`, `updated_at` | Importada do NAP; `community` = proposto por utilizador |
| `evses` | `evse_id` (PK, forma original com `*`), `evse_compact` (único, sem `*`), `station_code` (FK), `connector_types`, `max_kw`, `status` | Uma linha por ponto/tomada |
| `photos` | `id` (UUID), `station_code`, `evse_id` (nulo = foto geral), `uploader_id`, `taken_at`, `exif_lat`, `exif_lon`, `distance_m`, `width`, `height`, `license`, `author_name`, `status` (`pending`, `published`, `hidden`, `removed`), `blur_method`, `created_at` | GPS do EXIF guardado só para moderação, nunca publicado |
| `selections` | `target` (PK: código do posto ou EVSE), `photo_id`, `chosen_by`, `chosen_at` | Qual foto o link estático serve |
| `users` | `id`, `provider` (`osm`, `github`), `provider_uid`, `display_name`, `role` (`contributor`, `trusted`, `moderator`, `admin`), `promoted_by`, `promoted_at`, `license_accepted_at`, `created_at` | Sem email, salvo se o fornecedor o der e for preciso |
| `review_queue` | `id`, `kind` (`new_station`, `photo`, `takedown`), `payload` (JSON), `submitted_by`, `status`, `decided_by`, `decided_at`, `note` | Fila única para tudo o que precisa de um humano |

Regras:

- Um `photo_id` em `selections` tem de pertencer ao mesmo posto ou EVSE (verificado no Worker).
- Quando não há seleção explícita, o link serve a foto publicada mais recente desse alvo.
- Apagar uma foto = `status=removed` e remover o objeto do R2; o registo fica para auditoria.

## Fluxo de upload

Tudo o que envolve a foto original acontece no browser: lê-se o EXIF, desfoca-se e re-codifica-se antes do envio. O servidor nunca recebe o original nem os metadados.

1. **Escolher fotos.** Aceita JPEG e HEIC. O Safari descodifica HEIC nativamente; nos outros browsers usa-se `heic2any` (libheif em WebAssembly).
2. **Ler o EXIF antes de mexer na imagem** com a biblioteca [`exifr`](https://github.com/MikeKovarik/exifr): `GPSLatitude`/`GPSLongitude`, `DateTimeOriginal` e `Orientation`.
3. **Sugerir o posto.** Com GPS, a página pede ao Worker os postos num raio de 500 m, ordenados pela distância, e pré-seleciona o mais próximo. Sem GPS, pesquisa por código, morada ou mapa.
4. **Associar a posto ou tomada.** O utilizador escolhe "foto geral do posto" ou uma tomada concreta da lista de EVSE desse posto.
5. **Posto não existe?** Formulário "novo posto": nome, operador, coordenadas (pré-preenchidas pelo GPS) e código se for conhecido. Cria `stations.status=pending_review` e uma entrada em `review_queue`. As fotos ficam `pending` até um moderador aprovar.
6. **Desfocar caras e matrículas** (ver alternativas abaixo), com revisão manual das caixas antes de enviar.
7. **Rodar, redimensionar e limpar.** Aplica-se a `Orientation` e re-codifica-se num `<canvas>` para 2048 px (mestre), 1024 px e 400 px, JPEG qualidade ~0,85. A re-codificação descarta todo o EXIF, incluindo GPS, modelo e número de série da câmara.
8. **Enviar.** `POST /api/photos` com as três imagens e um JSON separado: alvo, `taken_at`, `exif_lat`/`exif_lon`, licença aceite. Os pedidos ficam abaixo do limite de 100 MB por pedido do plano grátis.
9. **Validar no Worker.** Confirma sessão e limite de envios (rate limit), confirma que o alvo existe, procura um segmento APP1/EXIF nos bytes e rejeita se houver, calcula `distance_m` ao posto e grava no R2 e na D1.
10. **Publicar ou rever.**
    - Conta `trusted` (promovida à mão), posto `active` e dentro de 300 m → `published`.
    - Conta `contributor` → sempre `pending`, à espera de um moderador. Todas as contas novas começam aqui.
    - Sem GPS, a mais de 300 m ou com posto novo → `pending` mesmo para `trusted`. Estes sinais também ordenam a fila e aparecem como avisos.

**O que se faz com a localização do EXIF**

- Sugere o posto (passo 3) e evita fotos no posto errado.
- Sinaliza discrepâncias: uma foto a 2 km do posto vai para revisão.
- Ajuda a corrigir coordenadas: se várias fotos de pessoas diferentes concordam entre si e divergem do NAP, gera-se uma pista para reportar ao OPC ou corrigir no OSM.
- Fica só na D1, visível para moderadores; a API pública mostra a data, nunca as coordenadas de quem tirou a foto.

## Links estáticos e API

O URL é o ID e nunca muda. O Worker converte o URL no código do posto ou do EVSE, vê em `selections` qual é a foto e serve-a do R2, com cache na CDN.

| URL | Devolve |
| --- | --- |
| `/TRK-VNT-00005.jpg` | Foto geral do posto (1024 px) |
| `/PTTRKEVNT0000501.jpg` | Foto da tomada |
| `/TRK-VNT-00005.jpg?s=thumb` ou `?s=full` | 400 px ou 2048 px |
| `/TRK-VNT-00005/2.jpg` | 2.ª foto publicada do posto, para galerias |
| `/api/stations/TRK-VNT-00005` | JSON: posto, EVSE, fotos com autor, licença, data e URLs |
| `/api/photos.json` | Exportação completa diária (para apps, mapas e backup) |

**Conversão.** Sem tabela de aliases: a conversão é determinística nos dois sentidos. Um EVSE `PT*EDP*E*LSB*90050*01` vira `/PTEDPELSB9005001.jpg` só por tirar os `*`, e na D1 guarda-se também essa forma compacta (índice único) para resolver o URL. Os códigos de posto mantêm os hífenes (`/TRK-VNT-00005.jpg`); o UUID da Tesla (`TSL-eddf8de0-…`) passa a maiúsculas sem perder nada. O URL aceita também o código com `*` codificado (`%2A`).

**Cache.**

- Resposta com `Cache-Control: public, max-age=86400` e um `ETag` igual ao `photo_id`.
- Ao mudar a foto escolhida, o Worker apaga essa URL da cache. No pior caso, um browser mostra a foto antiga durante 24 h.
- Imagens dentro de `/p/<uuid>/…` (endereço interno) são imutáveis: `max-age=31536000, immutable`.

**Sem foto.** Responde `404` sem imagem de substituição, para cada app decidir o que mostrar. O `/api/stations/…` responde com `photos: []`.

**Atribuição.** Cada imagem leva os cabeçalhos `X-Photo-Author`, `X-Photo-License` e `Link: </api/v1/photos/<id>>; rel="alternate"; type="application/json"`. A página `/p/<id>` mostra o crédito completo, que a CC BY-SA exige.

**Uso no OSM.** O caminho natural é `image=https://fotos.exemplo.pt/TRK-VNT-00005.jpg` no elemento do posto. Parte da comunidade OSM prefere `panoramax=` ou `wikimedia_commons=` a URLs arbitrários; convém falar com a comunidade OSM Portugal antes de fazer edições em massa (ver *Questões em aberto*).

## API, MCP, A2A e llms.txt

Há uma única camada de serviço no Worker (`searchStations`, `getStation`, `submitPhoto`…) e quatro portas para ela: a página web, a API REST, o servidor MCP e o cartão A2A. Assim as regras (validação, licença, desfocagem, moderação) são as mesmas para pessoas e para agentes.

### API REST (`/api/v1`)

Descrita em OpenAPI 3.1 em `/api/v1/openapi.json`. Os `GET` são públicos e têm CORS aberto; as escritas pedem sessão ou token.

| Método e rota | Faz | Auth |
| --- | --- | --- |
| `GET /stations?q=&lat=&lon=&radius=&opc=&has_photo=` | Pesquisa por texto, proximidade, operador ou falta de foto | — |
| `GET /stations/{code}` | Posto, EVSE, fotos e links estáticos | — |
| `GET /evses/{evse_id}` | Tomada e as suas fotos (com ou sem os `*`) | — |
| `GET /photos/{id}` | Metadados: autor, licença, data, tamanhos, URLs | — |
| `GET /photos.json` | Exportação diária completa | — |
| `POST /photos` | Envio (multipart: imagens + JSON de metadados) | `photos:write` |
| `PUT /selections/{target}` | Escolher a foto principal de um posto ou tomada | `trusted` |
| `POST /stations` | Propor posto novo (vai para a fila) | `photos:write` |
| `DELETE /photos/{id}` | Retirar uma foto (autor ou moderador) | sessão/token |
| `POST /takedown` | Pedido de remoção por privacidade, sem login | Turnstile |

**Tokens para scripts e agentes.** Cada utilizador gera *personal access tokens* na sua página, com âmbitos (`photos:read`, `photos:write`, `selections:write`) e validade. Envio com `Authorization: Bearer <token>`. Na D1 guarda-se só o hash. Os limites de envio são os da conta, não do token.

**Envio pela API tem duas formas**, porque a desfocagem no browser (alternativa A) não existe aqui:

1. `mode=clean`: o cliente já desfocou e tirou o EXIF, e manda as coordenadas e a data no JSON. O Worker confirma que não há EXIF nos bytes. A foto fica `pending` salvo se a conta for `trusted`.
2. `mode=raw`: o cliente manda o original. O Worker lê o EXIF (o `exifr` corre em Workers), guarda o original num bucket privado e põe um job na fila da alternativa B. O original apaga-se depois de desfocado. **Só existe se a B estiver ligada.**

### Servidor MCP (`/mcp`)

Servidor MCP remoto no mesmo Worker, com o transporte *Streamable HTTP*. A Cloudflare dá o `McpAgent` (Agents SDK) e o `workers-oauth-provider` para o OAuth que os clientes MCP esperam ([guia](https://developers.cloudflare.com/agents/guides/build-mcp-server)). O OAuth do MCP reutiliza o login OSM/GitHub: o utilizador autoriza o agente uma vez e o token herda o papel da conta.

| Ferramenta | Faz | Auth |
| --- | --- | --- |
| `search_stations` | Por texto, coordenadas e raio, operador ou `has_photo=false` | — |
| `get_station` | Posto, EVSE, fotos e links | — |
| `get_photo_link` | Link estático de um posto ou tomada (com tamanho) e a atribuição pronta a colar | — |
| `list_missing_photos` | Postos ou tomadas sem foto num concelho ou operador, para campanhas | — |
| `submit_photo` | Envio a partir de URL ou base64, no `mode=clean` ou `mode=raw` | `photos:write` |
| `propose_station` | Posto novo para revisão | `photos:write` |
| `set_primary_photo` | Escolher a foto principal | `trusted` |

Também há *resources* `station://{code}` e `photo://{id}` para clientes que os suportem. As ferramentas de leitura funcionam sem login, para qualquer assistente poder mostrar fotos de um posto.

**Ligação ao ohmigo.** O ohmigo (MCP de preços do mesmo ecossistema, ligado a partir do [ocarroeletrico.com](https://ocarroeletrico.com/)) pode incluir o `photo_url` de cada posto nas respostas, chamando a API REST. Não é preciso juntar os dois servidores.

### A2A

O A2A (Agent2Agent) serve para um agente delegar tarefas noutro agente. Este serviço é sobretudo dados e ferramentas, por isso **o MCP é a porta principal** e o A2A fica como uma camada fina para a fase 3:

- Cartão do agente em `/.well-known/agent-card.json` (formato A2A 1.0, com `supportedInterfaces` e o *binding* `JSONRPC` em `/a2a`).
- *Skills* iguais às ferramentas MCP: `find-station`, `get-photos`, `submit-photo`.
- As tarefas são resolvidas por código, sem LLM do nosso lado: custo zero e respostas previsíveis. Um `submit-photo` devolve o estado `input-required` quando falta escolher o posto entre vários candidatos.
- `securitySchemes`: o mesmo OAuth2 do MCP.

### llms.txt

Um `/llms.txt` em Markdown, segundo a [proposta v2](https://llmstxt.org/), e o cabeçalho `Link: </llms.txt>; rel="describedby"; type="text/markdown"` nas páginas HTML para os agentes o encontrarem. Conteúdo proposto:

```markdown
# Fotos dos postos de carregamento (Portugal)

> Fotos comunitárias de postos e tomadas de carregamento em Portugal, com links estáticos pelo código do posto (ex. TRK-VNT-00005) ou pelo EVSE (ex. PTTRKEVNT0000501). Fotos sob CC BY-SA 4.0; atribuição obrigatória.

## Usar

- [Links estáticos](https://fotos.exemplo.pt/docs/links.md): formato dos URLs, tamanhos, código EVSE
- [API REST](https://fotos.exemplo.pt/api/v1/openapi.json): OpenAPI 3.1
- [Servidor MCP](https://fotos.exemplo.pt/docs/mcp.md): https://fotos.exemplo.pt/mcp, ferramentas e autenticação
- [Licença e atribuição](https://fotos.exemplo.pt/docs/licenca.md)

## Contribuir

- [Enviar fotos](https://fotos.exemplo.pt/docs/enviar.md): regras de privacidade, desfocagem, moderação
- [Tokens de API](https://fotos.exemplo.pt/docs/tokens.md)

## Optional

- [Exportação completa](https://fotos.exemplo.pt/api/v1/photos.json)
- [Agent card A2A](https://fotos.exemplo.pt/.well-known/agent-card.json)
```

Cada página de `docs/` existe também em `.md`, que é o que a proposta pede para os links do `llms.txt`.

## Autenticação

Recomendação: **login com conta OpenStreetMap (OAuth2)** como método principal e GitHub como alternativa. Ler as fotos e a API é público; só o envio e a moderação pedem login.

| Opção | Como funciona | A favor | Contra |
| --- | --- | --- | --- |
| **OSM OAuth2** | Authorization Code + PKCE em `openstreetmap.org/oauth2/authorize`; só o âmbito `read_prefs`; depois `GET /api/0.6/user/details.json` dá o ID e o nome | Quem mapeia já tem conta; o autor da foto é o mesmo nome do OSM; os tokens não expiram ([wiki OSM](https://wiki.openstreetmap.org/wiki/OAuth)) | Não dá email (o `read_email` é privilegiado); quem não usa OSM tem de criar conta |
| **GitHub OAuth** | OAuth App normal, âmbito vazio ou `read:user` | Simples; boa para quem desenvolve | Muita gente da comunidade EV não tem conta |
| **Cloudflare Access** | Proteção à frente das rotas `/admin` e `/upload`, com GitHub, Google ou código por email | Zero código de login; grátis até 50 utilizadores ([planos](https://www.cloudflare.com/plans/sase-zero-trust.md)) | O limite de 50 não serve para uploads abertos; bom só para moderadores |
| **Link mágico por email** | O Worker envia um link assinado e de uso único | Toda a gente tem email | Precisa de um serviço de envio (ex. Resend) e guarda emails (dado pessoal, RGPD) |

**O que é preciso implementar**

1. Registar a aplicação em `openstreetmap.org/oauth2/applications`, com o redirect `https://fotos.exemplo.pt/auth/osm/callback`. Fazer o mesmo no GitHub.
2. Guardar `CLIENT_ID`/`CLIENT_SECRET` como *secrets* do Worker (`wrangler secret put`).
3. Rotas no Worker: `/auth/osm/login` (gera `state` e `code_verifier` e guarda-os num cookie curto), `/auth/osm/callback` (troca o código, lê `user/details`, cria ou atualiza `users`), `/auth/logout`.
4. Sessão: cookie `HttpOnly; Secure; SameSite=Lax` com um ID aleatório; a sessão fica na D1 ou no KV, com validade de 30 dias. O token do OSM não se guarda, porque só é preciso no login.
5. Na primeira entrada, aceitar os termos e a licença das fotos (`license_accepted_at`).
6. Proteção: Cloudflare Turnstile no formulário de upload, limite de envios por utilizador (ex. 50 fotos/dia para `contributor`) e verificação de CSRF nos `POST`.
7. Painéis `/admin` (fila de revisão, remoções) atrás de Cloudflare Access, além do papel `moderator` na D1: duas camadas para a parte sensível.

**Papéis**

| Papel | Pode |
| --- | --- |
| `contributor` | Papel de todas as contas novas. Enviar fotos e propor postos; tudo fica `pending` até um moderador aprovar |
| `trusted` | Publicar direto, escolher a foto principal de um posto ou tomada |
| `moderator` | Aprovar ou rejeitar a fila, ocultar fotos, tratar pedidos de remoção, promover a `trusted` |
| `admin` | Gerir moderadores, importações e configuração |

**Sem promoção automática.** Todos os contribuidores ficam moderados até um moderador ou admin os promover manualmente a `trusted` (botão na página do utilizador e na fila). A promoção fica registada com quem a fez (`promoted_by`, `promoted_at`) e pode ser revertida.

## Desfocagem de caras e matrículas

Recomendação: começar pela **A (deteção no browser + revisão manual)** e acrescentar a **B (sgblur no servidor)** como segunda passagem se a qualidade não chegar. Em todas as opções há um editor de retângulos: o utilizador confirma, acrescenta ou remove zonas antes de enviar.

|  | A — No browser | B — Servidor próprio (sgblur) | C — Serviço externo |
| --- | --- | --- | --- |
| Como | ONNX Runtime Web ou MediaPipe corre um detetor de caras e matrículas no telemóvel; desfoca no `<canvas>` | O Worker põe um job numa Cloudflare Queue; um contentor com o [sgblur](https://github.com/cquest/sgblur) do Panoramax lê do R2, desfoca e grava | C1: Panoramax (instância que desfoca ao receber). C2: API comercial (Plate Recognizer, Watermarkly) |
| Modelo | MediaPipe Face Detector (caras) + um YOLO pequeno em ONNX para matrículas | YOLOv8 treinado para caras e matrículas, usado pela comunidade OSM | Do fornecedor |
| Onde fica o original | Nunca sai do telemóvel | Vai para o servidor; apaga-se depois de desfocado | Vai para terceiros |
| Custo | 0 € | Um servidor ou contentor sempre ligado (Zerops, VPS ou Cloudflare Containers); a imagem Docker tem 8,6 GB | C1: 0 €. C2: ~0,01 $/foto na [Watermarkly](https://watermarkly.com/docs/blur-api), ~1 000 $ para 100k fotos |
| Qualidade | Boa para caras; nas matrículas depende do modelo escolhido | A mesma que o Panoramax usa em produção | Alta (C2); a do Panoramax (C1) |
| Riscos | Telemóveis antigos lentos; modelo de alguns MB a descarregar; um cliente alterado pode saltar o passo | Manutenção; picos de envio fazem fila | C1: não há instância Panoramax portuguesa, a de OSM França é só para testes fora de França, e a do MapComplete só aceita envios pelo MapComplete ([wiki](https://wiki.openstreetmap.org/wiki/Panoramax)). C2: subcontratante RGPD e custo |

**Notas**

- **Licença dos modelos.** Os YOLOv8 da Ultralytics são AGPL-3.0; o código do sgblur é MIT. Para distribuir um modelo no browser (A), é preciso confirmar a licença dos pesos ou escolher modelos Apache/MIT (o MediaPipe é Apache 2.0).
- **Abuso.** Na A, um cliente alterado pode enviar fotos sem desfocar. A mitigação: só publicam direto os `trusted`, promovidos à mão; o resto passa pela fila. Com a B ligada, todas as fotos levam uma segunda passagem no servidor.
- **C1 a prazo.** Se a OSM Portugal vier a ter uma instância Panoramax, os originais podem ir para lá (desfocagem, licença e federação resolvidas) e este serviço fica só com o mapeamento ID → foto e a cache.
- **Postos raramente têm caras**; matrículas de carros a carregar são o caso comum. Vale a pena dar prioridade à qualidade do detetor de matrículas.

## Licença, RGPD e moderação

**Licença das fotos.** A proposta é seguir o modelo do Panoramax da OSM França: **CC BY-SA 4.0** para as fotos e derivados fotográficos, com autorização adicional para criar dados não fotográficos sob CC BY 4.0 ou ODbL ([wiki](https://wiki.openstreetmap.org/wiki/FR:Panoramax)). Sem essa autorização, a CC BY-SA sozinha não permite usar as fotos para melhorar o OSM. O uploader aceita isto uma vez (`license_accepted_at`) e declara que tirou a foto. Fotos importadas do OSM ou do Commons mantêm a licença e o autor de origem.

**Código.** Licença aberta no repositório (ex. MIT ou AGPL), para qualquer pessoa poder montar uma cópia.

**RGPD**

- **Dados de quem envia:** ID e nome do fornecedor de login, papel e GPS das fotos. Sem email, salvo no link mágico.
- **Pessoas e matrículas nas fotos:** desfocagem obrigatória e caixa a confirmar no envio ("Não há caras nem matrículas legíveis").
- **Pedidos de remoção:** formulário público `/takedown` (sem login, com Turnstile). A foto fica `hidden` de imediato e um moderador decide em 72 h (prazo a definir).
- **Política de privacidade** e responsável identificado: uma associação ou pessoa da comunidade.
- **Conservação:** GPS e originais (só na alternativa B) apagados depois do processamento; logs com retenção curta.

**Moderação**

- Fila única (`review_queue`) com três tipos: posto novo, foto pendente e remoção.
- Todos os envios de contas `contributor` passam pela fila; só `trusted` (promovidos à mão) publicam direto.
- Critérios de rejeição: posto errado, privacidade, qualidade (desfocada, escura), duplicado, publicidade.
- Histórico de decisões visível para moderadores; o autor recebe o motivo na sua página.
- Para começar chegam 3 a 5 moderadores da comunidade.

## Custos, fases e questões em aberto

**Custos.** Com 100k fotos em três tamanhos (~0,85 MB por foto), o armazenamento fica em ~85 GB, ou seja, ~1,1 $/mês no R2: 10 GB-mês grátis e depois 0,015 $/GB-mês, sem custos de tráfego ([preços R2](https://developers.cloudflare.com/r2/pricing)). As 300k escritas cabem no milhão grátis de operações Classe A. A D1 e o KV cabem no plano grátis.

O limite que se atinge primeiro é o dos Workers: 100 000 pedidos/dia e 10 ms de CPU por pedido no plano grátis. Se apps ou mapas carregarem muitas fotos, passa-se ao Workers Paid. Uma otimização possível: ao mudar a foto principal, o Worker copia-a para a chave pública (`OPC-XXXX.jpg` ou o EVSE compacto) num bucket R2 com domínio próprio. Os links estáticos passam a ser servidos pelo R2 e pela CDN sem invocar o Worker.

**Fases**

1. **MVP.** Importação diária do NAP, links estáticos, página de upload com login OSM, extração de EXIF e desfocagem no browser (A), fila de moderação com promoção manual, API `GET`, `llms.txt`.
2. **Abrir a agentes e apps.** Escrita pela API com tokens, servidor MCP, importação das fotos que já estão no OSM, exportação `photos.json`, listas de postos sem foto, `photo_url` no NAP dashboard e no ohmigo.
3. **Escala e integração.** Desfocagem no servidor (B) e `mode=raw`, A2A, sugestões de edição no OSM, eventual instância Panoramax portuguesa.

**Questões em aberto**

- [ ] Quem é o responsável (associação ou pessoa), qual a conta Cloudflare e qual o domínio?
- [ ] Repo novo ou dentro do NAP dashboard (que já tem o ETL e o `charger_photos.py`)?
- [ ] Licença: CC BY-SA 4.0 com autorização ODbL (proposta) ou CC0?
- [ ] A comunidade OSM Portugal aceita `image=` com o nosso domínio, ou prefere `panoramax=`?
- [ ] Fotos do OSM, Panoramax e Commons: guardar uma cópia ou só referenciar?
- [ ] Licença dos modelos de deteção para a alternativa A.
- [ ] Prazo de resposta aos pedidos de remoção e quem os trata.
