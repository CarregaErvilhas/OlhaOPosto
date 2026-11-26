# Postos em construção — proposta de design

Estado: decidido pelo Fernando (ver *Decisões*, no fim), à espera do Alexandre e do Telmo. Implementação no olh'o'posto: #77 (remoção das propostas) e #78. Depois de feito, o que ficar passa para [`arquitetura.md`](arquitetura.md).

## Porquê

Queremos fotos de postos que ainda estão a ser construídos: o local, o quadro, os carregadores antes de abrir. São as fotos mais difíceis de arranjar depois, e quem passa por uma obra é quem a vê.

Hoje isso não é possível:

- O olh'o'posto só conhece postos do NAP (o import diário lê o modelo da rede do NAP dashboard). Um posto em construção não está no NAP, por isso não há onde pendurar a foto. Até agora havia as propostas de postos novos (`source` `community`), que saem: um posto novo tem de vir do OSM, não de uma proposta no olh'o'posto.
- O NAP dashboard já mostra os postos que o OpenStreetMap diz estarem em construção ou planeados (`scripts/osm_planned.py`, hoje cerca de 265), mas com o id do elemento OSM (`OSM-w1551836005`). Quem procura pelo código MOBI.E (`?posto=ALM-00114`) não encontra nada, e o Procurar esconde-os por defeito.
- Quando o posto entra no NAP, chega com outro id (`<OPC>-ALM-00114`). Sem uma regra, ficariam dois postos para o mesmo sítio: um «em construção» com as fotos e outro do NAP sem nenhuma.

Este documento propõe como os postos em construção entram nos dois sites, como se encontram, que URLs têm e o que acontece às fotos quando o posto passa a ter id do NAP.

## Fonte: o OSM

Um posto «em construção» é o que o OSM diz que ainda não abriu. O `osm_planned.py` já reconhece três formas de o mapear:

1. o local inteiro com `construction:amenity`, `planned:amenity` ou `proposed:amenity` = `charging_station`;
2. um `amenity=charging_station` em que todos os pontos são `construction:man_made=charge_point` (é assim que se mapeiam os Superchargers em obra);
3. pontos `construction:man_made` / `planned:man_made` soltos, agrupados a 40 m num só local.

**Princípio em causa.** Hoje os dados oficiais (NAP/MOBI.E) são a base e o OSM só complementa. Aqui o OSM passa a ser a única fonte de um tipo de posto. A proposta limita isso aos postos que ainda não podem estar no NAP, mostra-os sempre marcados como «segundo o OpenStreetMap», e quando o NAP os publica é o NAP que manda.

Cada local tem um ciclo de vida: `construction` (em obra) ou `planned` (planeado ou proposto). **O olh'o'posto só importa os `construction`:** num `planned` não há obra para fotografar. O feed traz os dois, para o NAP dashboard os poder mostrar. Se o OSM estiver desatualizado (a obra já começou e ainda diz `planned`), quem lá passa pode corrigir o OSM, e o posto entra no import seguinte.

O código MOBI.E, quando existe, vem do `ref` do OSM ou do nome, em formatos variados: `ALM-00114/155`, `MLD-00036…39`, `SXL-00085/86`. Hoje cerca de 70 dos 265 trazem um.

### O que o feed dos postos tem de trazer

O feed dos postos que o NAP dashboard publica está a ser redesenhado. A proposta desse redesenho mantém o mesmo endereço (`nap.ocarroeletrico.com/ohmigo/chargers.json`) e põe os postos em construção num array novo, `planned`, ao lado de `sites`. A cadência passa a 4 vezes por dia. O que este design precisa do feed:

- **Os postos em construção separados dos do NAP** (o array `planned`). O ohmigo nunca lhes pode dar preço nem os sugerir para carregar.
- Para cada um: o id (`OSM-<n|w><número>`), o elemento OSM (`way/1551836005`), o ciclo de vida, os **códigos MOBI.E já expandidos** (`codes`: `["ALM-00114", "ALM-00155"]`, lista vazia quando não há), tirados do `ref` **e do nome** (o `ALM-00114/155` está no nome, não no `ref`), o nome, o operador, a posição, o número de pontos, a potência e as fichas, quando o OSM os tem.
- Para cada posto do NAP: o elemento OSM ligado (`osm.element`), como hoje. É a chave da fusão (abaixo).
- A mesma cadência dos postos do NAP. Hoje os planeados só saem no refresh semanal. O import do olh'o'posto pode correr de hora a hora: não faz nada quando o `generatedAt` não mudou.
- O travão do import (recusa quando desaparece mais de 5 % dos postos, `MAX_MISSING_SHARE`) conta só os postos do NAP. Os em construção saem do feed sempre que abrem, e isso não é um feed partido.

## Ids e URLs

**O id de um posto em construção é o do elemento OSM: `OSM-w1551836005`** (`n` para um nó, `w` para uma *way*), o mesmo que o NAP dashboard já usa.

Porque não o código MOBI.E: muitos não o têm; os que têm trazem intervalos (`…39`) ou vários códigos; o código não é único sem o prefixo do operador, e esse prefixo só se sabe quando o posto entra no NAP. O elemento OSM é único e já existe.

| | Posto em construção | Depois de entrar no NAP |
| --- | --- | --- |
| Página do posto | `olhaoposto.ocarroeletrico.com/postos/OSM-w1551836005` | `301` → `/postos/<OPC>-ALM-00114` |
| API | `/api/v1/stations/OSM-w1551836005` | `301` → `/api/v1/stations/<OPC>-ALM-00114` |
| Link estático | não há | `pictures.ocarroeletrico.com/<OPC>-ALM-00114.jpg`, com a primeira foto aprovada do posto em construção, se o posto do NAP não tinha principal |
| Procurar (NAP dashboard) | `nap.ocarroeletrico.com/?posto=OSM-w1551836005` ou `?posto=ALM-00114` | `?posto=<OPC>-ALM-00114`, `?posto=ALM-00114`; o `OSM-w…` continua a abrir o posto do NAP |
| Tomadas | não há (sem EVSE) | as do NAP |

**Risco: o id OSM também pode mudar.** Se alguém apaga o elemento e desenha outro, transforma o nó numa *way* ou divide o local, o `OSM-w…` desaparece do feed. Tratamos isso como uma fusão sem chave (abaixo): o posto antigo fica, com as fotos, e um moderador liga-o ao novo.

## Como aparece

### No olh'o'posto

- **Página do posto:** uma faixa no topo, «Em construção segundo o OpenStreetMap: ainda não está no NAP» com o link para o elemento no OSM. Sem tomadas, sem link para o NAP dashboard enquanto não tiver id do NAP (o `?posto=OSM-w…` também funciona, mas mostra pouco). Sem link estático: a página diz que aparece quando o posto entrar no NAP. O botão «Enviar foto» funciona como noutro posto qualquer (`/enviar?posto=OSM-w1551836005`).
- **Pesquisa** (`/pesquisa`, API `?q=`, `?lat=&lon=`): os postos em construção entram, com a mesma marca. A pesquisa por texto procura também os códigos MOBI.E (`ALM-00114`, `ALM-00155`), por isso entram no índice FTS.
- **Página de envio:** aparecem nos postos sugeridos a 500 m do GPS, marcados «em construção», depois dos do NAP.
- **Fila de moderação:** as fotos de um posto em construção trazem um aviso para rever caras e letreiros com mais atenção.
- **`/postos/sem-foto`:** ficam de fora (e do `has_photo=false` da API). A lista é dos links estáticos por preencher, e estes ainda não têm.
- **`sitemap.xml`:** ficam de fora. São páginas que vão mudar de URL.
- **MCP e API** (`get_station`, `search_stations`, `/api/v1/stations`): cada posto em construção traz `lifecycle: "construction"` (ausente nos do NAP). A descrição das ferramentas diz que um posto em construção não carrega, para nenhum agente o apresentar como disponível.

### No NAP dashboard (Procurar)

- Continuam escondidos por defeito, atrás do filtro de ciclo de vida que já existe.
- **`?posto=` encontra-os:** pelo id (`OSM-w1551836005`) e por qualquer um dos códigos expandidos (`ALM-00114`). Quando o `?posto=` acerta num posto em construção, o Procurar liga sozinho o filtro e abre-o.
- O detalhe mostra «Em construção (OSM)», sem preços, sem estado ao vivo, sem histórico, com o link para o elemento no OSM e «Enviar foto no olh'o'posto» para `/postos/OSM-w…`.
- Para isto, o `osm_planned.py` passa a exportar os códigos que hoje só usa para comparar com o NAP, já expandidos.

## Fotos

Funcionam como as de um posto do NAP, com estas diferenças:

- **Sem foto principal nem link estático.** Uma foto aprovada fica pública no Panoramax e na galeria do posto, mas não é copiada para o `pictures.*` (o `publishMain` e o `chooseMain` recusam um posto em construção). Assim um link estático nunca muda de chave na fusão.

- **Só fotos do local.** Ainda não há tomadas com código EVSE. Depois da fusão, um moderador pode passar uma foto para uma tomada, como hoje.
- **Publicação direta das contas `trusted`:** como hoje, com a mesma regra dos 300 m. O sítio vem do OSM, que é o mais próximo de uma fonte que temos.
- **Desfocagem:** numa obra há trabalhadores, e muitas vezes carrinhas com o nome da empresa. A deteção de caras é a mesma, mas a fila de moderação deve marcar estas fotos para uma revisão mais atenta.
- **Pontos:** contam como as outras. A primeira foto de um posto em construção dá o bónus de primeira foto. Quando o posto entra no NAP, esse bónus não volta a ser dado a outra pessoa.

## A fusão: quando o posto entra no NAP

É a parte difícil. Um posto em construção `OSM-w1551836005` com fotos; o NAP publica `<OPC>-ALM-00114` no mesmo sítio.

### Quando se funde

O import diário procura, para cada posto do NAP novo, um posto em construção que seja o mesmo:

- **Fusão automática** quando o `osm.element` do posto do NAP é o elemento do posto em construção **e** os códigos batem certo (o código do NAP está nos códigos do posto em construção, ou o posto em construção não tem nenhum).
- **Fila do moderador** em todos os outros casos: só um dos dois critérios, um posto do NAP a menos de 30 m sem elemento OSM ligado, ou um posto em construção que saiu do feed sem ninguém o reclamar. A página `/admin/postos-fora-do-nap`, que hoje só lista postos `missing_from_nap` com fotos, passa a listar também estes, com a sugestão. O moderador confirma ou escolhe outro.

**Ordem dos acontecimentos.** O `osm_planned.py` deixa de publicar um posto em construção assim que o NAP tem um posto com o mesmo `ref` ou a menos de 30 m. Isso pode acontecer na mesma corrida em que o posto do NAP aparece, ou não: o OSM e o NAP mudam a ritmos diferentes. A fusão não pode depender de ver os dois no mesmo import. Por isso olha para todos os postos em construção da D1, mesmo os que já saíram do feed.

**Aviso sobre a regra dos 30 m:** um posto rápido novo construído ao lado de um posto AC que já existe é escondido pelo `osm_planned.py`, que o toma pelo posto do NAP. Vale a pena rever a regra: por exemplo, só o esconder quando também o tipo (AC/DC) ou o operador batem certo.

### O que muda na fusão

1. **Alias:** uma linha em `station_aliases` (`OSM-w…` → `<OPC>-ALM-00114`). A página e a API antigas passam a responder `301`, como num re-key do NAP.
2. **Fotos:** `photos.station_id` passa para o id do NAP. Hoje um alias não move as fotos (fica só o redirect). Aqui tem de as mover, senão o posto do NAP fica sem nenhuma.
3. **Foto principal:** o posto em construção não tinha. Se o posto do NAP também não tem, o *cron* do Worker publica a primeira foto aprovada que veio do posto em construção como principal dele (o import corre no GitHub Actions e só escreve na D1, não chega ao R2 nem ao Panoramax). Se o posto do NAP já tinha principal, as fotos entram na galeria.
4. **Etiquetas no Panoramax:** `OlhaOPosto|site=OSM-w…` passa a `OlhaOPosto|site=<OPC>-ALM-00114`. Faz-se no *cron* com uma coluna pendente (`photos.site_tag_old`), como o `author_tag_old` para o crédito, para uma falha do Panoramax não bloquear a fusão.
5. **OSM:** o `panoramax=<uuid>` aponta para a foto, não para o posto, por isso não muda.
6. **Pontos:** estão ligados à foto, não ao posto, por isso ficam.
7. **Estado:** o posto em construção passa a `merged`, sai da pesquisa e fica com o alias. Nunca é apagado.

A fusão manual (o moderador, na página dos postos fora do NAP) faz os mesmos passos que a automática: as mesmas instruções SQL, partilhadas pelo import e pelo Worker.

### Links estáticos depois da fusão

Decidido: **sem link estático para os postos em construção** (era a opção C). O `pictures.*` é um bucket R2 servido diretamente e não faz redirects, por isso uma chave `OSM-w….jpg` não podia passar para a chave nova. Sem chave antiga, não há o que manter nem o que esquecer num pedido de remoção. O custo: a foto não serve para o OSM nem para outras apps pelo link estático até o posto entrar no NAP. O link da página de crédito (`/p/{photo_id}`) e o do Panoramax existem desde a aprovação.

### Postos que nunca chegam ao NAP

O OSM tira a etiqueta de obra (o posto abriu mas o operador ainda não o publicou, a obra parou, ou foi um engano) e o NAP não tem nada no sítio. O posto em construção sai do feed.

Passa a `missing_from_osm` e fica como um `missing_from_nap`: com a página, as fotos e na pesquisa, marcado. Se tiver fotos, aparece na página do moderador. Se mais tarde o NAP o publicar, a fusão faz-se pela fila do moderador.

## Base de dados (D1)

- **`source`** passa a `nap` ou `osm` (sai o `community`, sem postos em produção).
- **`status`** passa a `active`, `missing_from_nap`, `missing_from_osm` ou `merged` (saem o `pending_review` e o `rejected`, que eram das propostas e não têm postos).
- **`codes`**: os códigos MOBI.E de um posto em construção, separados por espaços, também no índice FTS da pesquisa. Nulo nos do NAP.
- **`photos.site_tag_old`**: a etiqueta `OlhaOPosto|site` que o Panoramax ainda tem, depois de uma fusão, até o *cron* a trocar.

Como o `source` e o `status` são `CHECK` numa tabela `STRICT`, mudar os valores obriga a **reconstruir a tabela `stations`**, que é apontada por `evses`, `photos`, `selections`, `station_aliases` e `review_queue` e tem os *triggers* do FTS. São cerca de 9 000 postos: cabe no limite diário de escritas do D1 Free. A migração aplica-se sozinha no deploy depois do merge, por isso o merge desse PR pede um *bookmark* do Time Travel da D1 antes.

## Fases

1. **NAP dashboard:** o `osm_planned.py` exporta os códigos expandidos, e o `?posto=` encontra os postos em construção pelo id e pelos códigos. Independente do resto.
2. **Feed:** os postos em construção no feed novo, separados dos do NAP.
3. **olh'o'posto, fusão primeiro:** a migração, a fusão automática e a fila do moderador, a atualização das duas chaves no `removePhoto`. Tem de estar pronta antes da fase 4, senão as primeiras fotos ficam no posto errado.
4. **olh'o'posto, import e páginas:** importar os postos em construção, a faixa na página, a pesquisa, o MCP.

## Decisões

Respostas do Fernando. O Alexandre e o Telmo ainda podem mudar qualquer uma.

1. **Id:** o elemento OSM (`OSM-w…`).
2. **Links estáticos:** nenhum até o posto entrar no NAP (opção C).
3. **Fusão automática:** elemento OSM + código chegam. O resto vai para o moderador.
4. **Base de dados:** a coluna e os estados novos, com a reconstrução da tabela. As propostas de postos pela comunidade saem do olh'o'posto: um posto novo tem de estar no OSM.
5. **Publicação direta:** como hoje. Uma conta `trusted` publica logo.
6. **Planeados:** só os `construction`.
