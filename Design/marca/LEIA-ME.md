# Pic, a mascote do pIcŧU/Re (versão âmbar)

Ficha Type 2 com os 7 pinos, a objetiva no pino de terra, o obturador e o flash no topo.

## Cores

| Papel | Hex |
|---|---|
| Corpo | `#F2B33D` |
| Face | `#15201C` |
| Destaque (objetiva, obturador, raios) | `#0B6B58` |
| Pinos | `#FCE3A6` |
| Olhos, janela do flash | `#FFFFFF` |
| Fundo dos ícones de app | `#FBF3E2` |

## Ficheiros

- `svg/pic.svg`: mascote completa, com os raios do flash. Para o site, apresentações e autocolantes.
- `svg/pic-icon.svg`: sem raios, mais compacta. Para avatares e ícones a partir de 48 px.
- `svg/pic-icon-pequeno.svg`: simplificada para 16 a 32 px (sem pinos laterais, traços mais grossos).
- `svg/pic-mono-preto.svg`, `svg/pic-mono-branco.svg`, `svg/pic-icon-mono-preto.svg`: uma só cor, para impressão, carimbos e por cima de fotos.
- `png/`: as mesmas em vários tamanhos (fundo transparente).
- `favicon/`: tudo o que vai para a raiz do site.

## No `<head>`

```html
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#F2B33D">
```

O `aria-label` dos SVG é "picture", como pede o plano para a marca.
