# Licenças

O olh'o'posto tem duas licenças: uma para o código e outra para as fotos. O nome e a mascote ficam fora das duas.

## Código: MIT

O código deste repositório está sob a [licença MIT](../LICENSE), exceto a marca (ver abaixo). Qualquer pessoa pode usá-lo, alterá-lo e montar uma cópia do serviço, desde que mantenha o aviso de copyright e a licença.

Porquê a MIT: é a mesma licença do Panoramax (GeoVisio), o servidor onde ficam as fotos, por isso não há conflito entre as duas peças, e é a licença com menos atrito para quem quiser reutilizar o código (outras comunidades, operadores, o NAP dashboard).

## Fotos: CC BY-SA 4.0, com autorização para dados

As fotos enviadas pelo olh'o'posto ficam sob a [Creative Commons Atribuição-CompartilhaIgual 4.0 Internacional (CC BY-SA 4.0)](https://creativecommons.org/licenses/by-sa/4.0/deed.pt), no mesmo modelo do Panoramax da OSM França ([wiki](https://wiki.openstreetmap.org/wiki/FR:Panoramax)):

- **Fotos e derivados fotográficos** (recortes, tamanhos, versões desfocadas): CC BY-SA 4.0. É obrigatório dar crédito ao autor e partilhar os derivados sob a mesma licença.
- **Dados não fotográficos** tirados das fotos (por exemplo, o tipo de tomada, o operador ou a posição de um posto, para pôr no OpenStreetMap): o autor autoriza também a sua publicação sob **CC BY 4.0** ou **ODbL**. Sem esta autorização, a CC BY-SA sozinha não é compatível com a ODbL e as fotos não poderiam ser usadas para melhorar o OSM.

Quem envia uma foto aceita estas condições uma vez, ao entrar, e declara que é o autor da foto.

**Atribuição.** O autor e a licença vão nos metadados (XMP) das cópias públicas, que apontam para a página do posto, onde está o crédito. Uma página de crédito por foto (`/p/{photo_id}`) está no [`plan.md`](plan.md).

Quem envia aceita também os [termos de utilização](https://olhaoposto.ocarroeletrico.com/termos) (`worker/src/terms.ts`), que repetem estas condições.

**Fotos de outras origens.** As fotos referenciadas a partir do OSM, do Wikimedia Commons ou de outro servidor Panoramax mantêm a licença e o autor de origem.

## Fontes: SIL Open Font License 1.1

O site usa a Inter, a Space Grotesk e a JetBrains Mono, alojadas no próprio Worker (`worker/public/fonts/`). Estão sob a [SIL Open Font License 1.1](https://openfontlicense.org/), e o texto da licença de cada uma vai ao lado dos ficheiros (`OFL-*.txt`), como a licença pede.

## Bibliotecas e modelo da página de envio

A página de envio carrega três bibliotecas de terceiros, que não estão no repositório: são `devDependencies` do `worker/` copiadas de `node_modules` para `worker/public/vendor/` no deploy (`worker/scripts/vendor.ts`), cada uma com a sua licença ao lado.

- **libheif** (`libheif-js`), para abrir fotos HEIC: [LGPL-3.0](https://www.gnu.org/licenses/lgpl-3.0.html). É servida como ficheiros separados e sem alterações, por isso pode ser trocada por outra versão, como a LGPL pede.
- **MediaPipe Tasks Vision** (`@mediapipe/tasks-vision`), para procurar caras: Apache-2.0.
- **Leaflet**, para o mapa: BSD-2-Clause. Os mosaicos do mapa são do OpenStreetMap (© contribuidores do OpenStreetMap, ODbL; mosaicos CC BY-SA 2.0), com a atribuição no próprio mapa.

O modelo de deteção de caras (BlazeFace, da Google) está em `worker/public/models/`, sob Apache-2.0, com a origem no `README.txt` ao lado.

## O nome e a imagem ficam de fora

As licenças cobrem o código e as fotos, não a marca. Não estão licenciados:

- o nome **olh'o'posto**, e os domínios em `ocarroeletrico.com`;
- a mascote **Pic** (a ficha Type 2 que fotografa), o ícone, o favicon e as imagens feitas com eles, em `Design/marca/` e nos desenhos dos mockups em `Design/`;
- as cópias desses ficheiros que o site serve (`worker/public/`: `pic-icon.svg`, favicons, ícones de app e `site.webmanifest`);
- as mascotes dos outros sites do grupo do O Carro Elétrico, se aparecerem aqui, que são de cada um desses sites.

Podes, e deves, usar o nome para dizer de onde vêm as fotos ou o código. Um fork ou uma obra derivada precisa de nome e de imagem próprios.

---

Isto é um resumo para facilitar a leitura; o que vale é o texto das licenças.
