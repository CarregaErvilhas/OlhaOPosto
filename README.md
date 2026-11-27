# olh'o'posto

Fotos comunitárias dos postos e tomadas de carregamento de veículos elétricos em Portugal, com **links estáticos pelo ID oficial**, para qualquer app ou mapa (OpenStreetMap, NAP dashboard, ohmigo…).

```
https://pictures.ocarroeletrico.com/<id-do-posto>.jpg
```

O link nunca muda. Muda só a foto para onde aponta.

## O que funciona

- Páginas dos postos e das tomadas, em pt-PT e inglês, com pesquisa por texto e por proximidade.
- Login com o OpenStreetMap e envio de fotos, com desfocagem de caras no browser.
- Fila de moderação; a aprovação publica a foto principal no link estático.
- API `/api/v1` (leitura aberta, escrita com sessão ou *token*) e servidor MCP em `/mcp`.
- Pontos, ranking, pedidos de remoção e fotos externas do OSM na galeria.
- Servidor Panoramax próprio em `panoramax.ocarroeletrico.com`, ainda fora da federação.

O detalhe está em [`Docs/arquitetura.md`](Docs/arquitetura.md); o que falta, em [`Docs/plan.md`](Docs/plan.md).

## Como funciona

- **Postos oficiais como base.** A lista de postos e tomadas vem de hora a hora dos dados abertos do NAP/MOBI.E. O OSM é um complemento.
- **Envio com login OSM.** Quem contribui escolhe o posto ou a tomada e envia a foto. No browser, a foto é redimensionada, as caras e matrículas são desfocadas e o EXIF é removido.
- **Moderação.** As fotos passam por uma fila de revisão antes de serem públicas.
- **Foto principal.** Quando há várias fotos de um posto ou tomada, escolhe-se a que alimenta o link estático.
- **Panoramax.** As fotos ficam num servidor [Panoramax](https://panoramax.fr) próprio, só para postos, que pode juntar-se à federação. O OSM liga-se a elas com a etiqueta `panoramax=<uuid>`.
- **Licença aberta.** CC BY-SA 4.0, com autorização para criar dados ODbL, para poderem ser usadas no OSM.

## Arquitetura

| Componente | Onde | O que faz |
| --- | --- | --- |
| Site, API, MCP (`olhaoposto.ocarroeletrico.com`) | Cloudflare Worker + D1 | Postos, envios, moderação, ranking, API `/api/v1`, servidor MCP `/mcp` |
| Links estáticos (`pictures.ocarroeletrico.com`) | Bucket R2 `pictures`, sem Worker | Serve `/<id>.jpg` e tamanhos pela CDN |
| Servidor Panoramax (`panoramax.ocarroeletrico.com`) | Zerops (Python + PostgreSQL/PostGIS), imagens no R2 | Guarda as fotos, os tamanhos e os metadados |

O que já existe está em [`Docs/arquitetura.md`](Docs/arquitetura.md); o que falta, em [`Docs/plan.md`](Docs/plan.md).

## Estrutura do repositório

| Caminho | Conteúdo |
| --- | --- |
| [`Docs/arquitetura.md`](Docs/arquitetura.md) | O que está a funcionar: objetivos, princípios, domínios, postos e tomadas, links estáticos |
| [`Docs/plan.md`](Docs/plan.md) | O que falta construir: fases, envio, moderação, login, API, OSM |
| [`Docs/licenca.md`](Docs/licenca.md) | Licenças do código, das fotos e das fontes |
| [`Docs/infra.md`](Docs/infra.md) | Infraestrutura do servidor Panoramax: serviços, segredos, R2, DNS, deploy, ensaio |
| [`Docs/cloudflare.md`](Docs/cloudflare.md) | Recursos Cloudflare do olh'o'posto: buckets R2, cache, CORS, Worker e rotas, login, página de envio, D1 e import |
| `zerops.yml`, `zerops-import.yaml` | Configuração dos serviços `pano` (Panoramax) e `db` no Zerops |
| `worker/` | Worker do olh'o'posto (TypeScript + D1): páginas, API, login, página de envio, migrações e import dos postos (de hora a hora) |
| `panoramax/` | Versão do Panoramax, ponto de entrada do gunicorn, scripts de preparação da BD e da conta de serviço, e scripts de envio de teste |
| `Design/` | Mockups das páginas e do fluxo olh'o'posto ↔ Panoramax |

## Contribuir

- Documentação e interface em português de Portugal; código e commits em inglês.
- Commits assinados com `git commit -s` (DCO).
- Os princípios do projeto estão em [`AGENTS.md`](AGENTS.md). Mudanças a esses princípios discutem-se primeiro numa issue.
