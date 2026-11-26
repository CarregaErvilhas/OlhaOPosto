# Postos em construção — proposta de design

Estado: proposta, para discussão. Nada disto está construído. Quando houver decisões, o que ficar passa para [`plan.md`](plan.md) e, depois de feito, para [`arquitetura.md`](arquitetura.md).

## Porquê

Queremos fotos de postos que ainda estão a ser construídos: o local, o quadro, os carregadores antes de abrir. São as fotos mais difíceis de arranjar depois, e quem passa por uma obra é quem a vê.

Hoje isso não é possível:

- O olh'o'posto só conhece postos do NAP (o import diário lê o modelo da rede do NAP dashboard). Um posto em construção não está no NAP, por isso não há onde pendurar a foto, a não ser propô-lo à mão (`source` `community`).
- O NAP dashboard já mostra os postos que o OpenStreetMap diz estarem em construção ou planeados (`scripts/osm_planned.py`, hoje cerca de 265), mas com o id do elemento OSM (`OSM-w1551836005`). Quem procura pelo código MOBI.E (`?posto=ALM-00114`) não encontra nada, e o Procurar esconde-os por defeito.
- Quando o posto entra no NAP, chega com outro id (`<OPC>-ALM-00114`). Sem uma regra, ficariam dois postos para o mesmo sítio: um «em construção» com as fotos e outro do NAP sem nenhuma.

Este documento propõe como os postos em construção entram nos dois sites, como se encontram, que URLs têm e o que acontece às fotos quando o posto passa a ter id do NAP.

## Fonte: o OSM

Um posto «em construção» é o que o OSM diz que ainda não abriu. O `osm_planned.py` já reconhece três formas de o mapear:

1. o local inteiro com `construction:amenity`, `planned:amenity` ou `proposed:amenity` = `charging_station`;
2. um `amenity=charging_station` em que todos os pontos são `construction:man_made=charge_point` (é assim que se mapeiam os Superchargers em obra);
3. pontos `construction:man_made` / `planned:man_made` soltos, agrupados a 40 m num só local.

**Princípio em causa.** Hoje os dados oficiais (NAP/MOBI.E) são a base e o OSM só complementa. Aqui o OSM passa a ser a única fonte de um tipo de posto. A proposta limita isso aos postos que ainda não podem estar no NAP, mostra-os sempre marcados como «segundo o OpenStreetMap», e quando o NAP os publica é o NAP que manda.

Cada local tem um ciclo de vida: `construction` (em obra) ou `planned` (planeado ou proposto). Neste documento, «em construção» cobre os dois, e a interface mostra a diferença.

O código MOBI.E, quando existe, vem do `ref` do OSM ou do nome, em formatos variados: `ALM-00114/155`, `MLD-00036…39`, `SXL-00085/86`. Hoje cerca de 70 dos 265 trazem um.

### O que o feed dos postos tem de trazer

O feed dos postos que o NAP dashboard publica está a ser redesenhado. A proposta desse redesenho mantém o mesmo endereço (`nap.ocarroeletrico.com/ohmigo/chargers.json`) e põe os postos em construção num array novo, `planned`, ao lado de `sites`. A cadência (várias vezes por dia) ainda está por decidir. O que este design precisa do feed:

- **Os postos em construção separados dos do NAP** (o array `planned`). O ohmigo nunca lhes pode dar preço nem os sugerir para carregar.
- Para cada um: o id (`OSM-<n|w><número>`), o elemento OSM (`way/1551836005`), o ciclo de vida, os **códigos MOBI.E já expandidos** (`["ALM-00114", "ALM-00155"]`), o nome, o operador, a posição, o número de pontos, a potência e as fichas, quando o OSM os tem.
- Para cada posto do NAP: o elemento OSM ligado (`osm.element`), como hoje. É a chave da fusão (abaixo).
- A mesma cadência dos postos do NAP. Hoje os planeados só saem no refresh semanal.

## Ids e URLs

**O id de um posto em construção é o do elemento OSM: `OSM-w1551836005`** (`n` para um nó, `w` para uma *way*), o mesmo que o NAP dashboard já usa.

Porque não o código MOBI.E: muitos não o têm; os que têm trazem intervalos (`…39`) ou vários códigos; o código não é único sem o prefixo do operador, e esse prefixo só se sabe quando o posto entra no NAP. O elemento OSM é único e já existe.

| | Posto em construção | Depois de entrar no NAP |
| --- | --- | --- |
| Página do posto | `olhaoposto.ocarroeletrico.com/postos/OSM-w1551836005` | `301` → `/postos/<OPC>-ALM-00114` |
| API | `/api/v1/stations/OSM-w1551836005` | `301` → `/api/v1/stations/<OPC>-ALM-00114` |
| Link estático | `pictures.ocarroeletrico.com/OSM-w1551836005.jpg` (e `.thumb`, `.full`) | ver *Links estáticos depois da fusão* |
| Procurar (NAP dashboard) | `nap.ocarroeletrico.com/?posto=OSM-w1551836005` ou `?posto=ALM-00114` | `?posto=<OPC>-ALM-00114`, `?posto=ALM-00114`; o `OSM-w…` continua a abrir o posto do NAP |
| Tomadas | não há (sem EVSE) | as do NAP |

**Risco: o id OSM também pode mudar.** Se alguém apaga o elemento e desenha outro, transforma o nó numa *way* ou divide o local, o `OSM-w…` desaparece do feed. Tratamos isso como uma fusão sem chave (abaixo): o posto antigo fica, com as fotos, e um moderador liga-o ao novo.

## Como aparece

### No olh'o'posto

- **Página do posto:** uma faixa no topo, «Em construção segundo o OpenStreetMap: ainda não está no NAP» (ou «Planeado»), com o link para o elemento no OSM. Sem tomadas, sem link para o NAP dashboard enquanto não tiver id do NAP (o `?posto=OSM-w…` também funciona, mas mostra pouco). O botão «Enviar foto» funciona como noutro posto qualquer.
- **Pesquisa** (`/pesquisa`, API `?q=`, `?lat=&lon=`): os postos em construção entram, com a mesma marca. A pesquisa por texto procura também os códigos MOBI.E (`ALM-00114`, `ALM-00155`), por isso entram no índice FTS.
- **Página de envio:** aparecem nos postos sugeridos a 500 m do GPS, marcados «em construção», depois dos do NAP.
- **`/postos/sem-foto`:** ficam de fora por defeito, com um filtro «incluir em construção». A lista é sobretudo para postos que se podem visitar e usar.
- **`sitemap.xml`:** ficam de fora. São páginas que vão mudar de URL.
- **MCP e API** (`get_station`, `search_stations`, `/api/v1/stations`): cada posto traz `lifecycle` (`construction` | `planned`, ausente nos do NAP). A descrição das ferramentas diz que um posto em construção não carrega, para nenhum agente o apresentar como disponível.

### No NAP dashboard (Procurar)

- Continuam escondidos por defeito, atrás do filtro de ciclo de vida que já existe.
- **`?posto=` encontra-os:** pelo id (`OSM-w1551836005`) e por qualquer um dos códigos expandidos (`ALM-00114`). Quando o `?posto=` acerta num posto em construção, o Procurar liga sozinho o filtro e abre-o.
- O detalhe mostra «Em construção (OSM)», sem preços, sem estado ao vivo, sem histórico, com o link para o elemento no OSM e «Enviar foto no olh'o'posto» para `/postos/OSM-w…`.
- Para isto, o `osm_planned.py` passa a exportar os códigos que hoje só usa para comparar com o NAP, já expandidos.

## Fotos

Funcionam como as de um posto do NAP, com estas diferenças:

- **Só fotos do local.** Ainda não há tomadas com código EVSE. Depois da fusão, um moderador pode passar uma foto para uma tomada, como hoje.
- **Publicação direta das contas `trusted`:** hoje exige um posto `active`. Proposta: vale também para os postos em construção, com a mesma regra dos 300 m. O sítio vem do OSM, que é o mais próximo de uma fonte que temos.
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
3. **Foto principal:** a linha de `selections` do posto passa para o id novo, e as três cópias são gravadas nas chaves novas (`<OPC>-ALM-00114.jpg`, `.thumb`, `.full`). O XMP de cada cópia aponta para a página de crédito (`/p/{photo_id}`), que não muda. Se o posto do NAP já tinha principal (alguém enviou entretanto), fica a dele, e a do posto em construção fica na galeria.
4. **Etiquetas no Panoramax:** `OlhaOPosto|site=OSM-w…` passa a `OlhaOPosto|site=<OPC>-ALM-00114`. Faz-se com uma coluna pendente, como o `author_tag_old` para o crédito, para uma falha do Panoramax não bloquear a fusão.
5. **OSM:** o `panoramax=<uuid>` aponta para a foto, não para o posto, por isso não muda.
6. **Pontos:** estão ligados à foto, não ao posto, por isso ficam.
7. **Estado:** o posto em construção passa a `merged` (ou fica com o alias e um estado que o esconde da pesquisa). Nunca é apagado.

### Links estáticos depois da fusão

O `pictures.*` é um bucket R2 servido diretamente: não faz redirects. O `OSM-w1551836005.jpg` não pode responder `301` para a chave nova.

Opções:

- **A. Manter a cópia na chave antiga** (proposta). Quem usou o link continua a ver a foto. As duas chaves passam a ser da mesma foto: trocar a principal ou um pedido de remoção têm de atualizar ou apagar **as duas**. O `removePhoto` passa a procurar todas as chaves em que a foto está publicada (a privacidade vem primeiro: uma cópia esquecida é exatamente o que não pode acontecer).
- **B. Apagar a chave antiga.** Mais simples, mas o link antigo passa a `404`. Contradiz «o URL nunca muda».
- **C. Não dar link estático aos postos em construção.** Evita o problema, mas a foto não serve para o OSM nem para outras apps até o posto entrar no NAP, e isso pode levar meses.

### Postos que nunca chegam ao NAP

O OSM tira a etiqueta de obra (o posto abriu mas o operador ainda não o publicou, a obra parou, ou foi um engano) e o NAP não tem nada no sítio. O posto em construção sai do feed.

Proposta: passa a `missing_from_osm`, fica com as fotos e os links, sai da pesquisa e aparece na página do moderador, como os `missing_from_nap`. Se mais tarde o NAP o publicar, a fusão faz-se pela fila do moderador.

## Base de dados (D1)

Duas formas de guardar o ciclo de vida:

- **Uma coluna nova** (proposta): `ALTER TABLE stations ADD COLUMN lifecycle TEXT CHECK (lifecycle IN ('construction', 'planned'))`, nula para os postos do NAP. Juntam-se os estados `merged` e `missing_from_osm`. Como o `source` e o `status` são `CHECK` numa tabela `STRICT`, acrescentar valores obriga a **reconstruir a tabela `stations`**, que é apontada por `evses`, `photos`, `selections`, `station_aliases` e `review_queue`, e tem os *triggers* do FTS (cada linha escrita duas vezes). São cerca de 9 000 postos: cabe no limite diário de escritas do D1 Free, mas é uma migração para correr com cuidado e com cópia antes.
- **Reaproveitar `community`:** os postos em construção entravam como propostas já aprovadas (`source` `community`, `status` `active`) com uma marca. Evita reconstruir a tabela, mas mistura postos propostos por pessoas com postos importados, e o import não pode mexer em postos `community` (regra de hoje).

A primeira é mais clara. A reconstrução é uma vez só.

## Fases

1. **NAP dashboard:** o `osm_planned.py` exporta os códigos expandidos, e o `?posto=` encontra os postos em construção pelo id e pelos códigos. Independente do resto.
2. **Feed:** os postos em construção no feed novo, separados dos do NAP.
3. **olh'o'posto, fusão primeiro:** a migração, a fusão automática e a fila do moderador, a atualização das duas chaves no `removePhoto`. Tem de estar pronta antes da fase 4, senão as primeiras fotos ficam no posto errado.
4. **olh'o'posto, import e páginas:** importar os postos em construção, a faixa na página, a pesquisa, o MCP.

## Perguntas para o Alexandre e o Telmo

1. **Id:** usar o elemento OSM (`OSM-w…`) parece-vos bem? Há casos em que o código MOBI.E aparece no terreno (autocolante, placa da obra) antes de estar no OSM?
2. **Links estáticos:** A (manter a chave antiga), B (apagá-la) ou C (sem link até ao NAP)?
3. **Fusão automática:** elemento OSM + código chegam, ou querem um humano em todas?
4. **Base de dados:** coluna `lifecycle` nova, com a reconstrução da tabela, ou reaproveitar `community`?
5. **Publicação direta:** as contas `trusted` publicam logo fotos de obra, ou passam todas pela fila por causa das caras?
6. **Planeados:** mostramos também os `planned` (sem obra à vista), ou só os `construction`?
