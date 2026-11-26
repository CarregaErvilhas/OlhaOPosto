# Promover moderadores e administradores

Guia operacional para nomear moderadores e administradores do olh'o'posto. O papel vive na D1 (tabela `users`); o Cloudflare Access só abre a porta para `/admin/*`. Os dois têm de estar alinhados.

## Pré-requisito

A pessoa tem de ter iniciado sessão no site pelo menos uma vez (login OSM), para existir uma linha em `users`.

## Passo 1 — Cloudflare Zero Trust (porta de entrada)

1. Dashboard Cloudflare → **Zero Trust → Access → Applications**.
2. Abrir a aplicação que cobre `/admin`, `/admin/*`, `/en/admin` e `/en/admin/*`.
3. **Policies → "Moderadores" → Edit**.
4. Em **Include**, adicionar o email da pessoa (ou criar um grupo e incluir o grupo).
5. Guardar. A sessão dura 24 h.

Os emails vivem só na Cloudflare, nunca no repositório.

## Passo 2 — Papel na D1 (o que ela pode fazer)

1. A pessoa entra no site e faz login OSM.
2. Um administrador abre `/admin/utilizadores` (ou `/en/admin/users`).
3. Procura pelo nome no OSM e muda o papel com o formulário (`POST /admin/papel`).
- Administrador: pode dar qualquer papel.
- Moderador: só `contributor` ↔ `trusted`.

Ninguém muda o próprio papel (evita trancar o último administrador fora). Cada mudança guarda `promoted_by` e `promoted_at`.

## Bootstrap do primeiro administrador

Se ainda não há admin, promover à mão na D1:

```bash
npm run remote -- d1 execute DB --remote \
  --command "UPDATE users SET role='admin', promoted_at=datetime('now') WHERE osm_name='<nome_no_osm>';"
```

(depois de a pessoa ter feito login pelo menos uma vez).

## Notas

- O Access só decide quem chega a `/admin/*`; o papel real está na D1.
- Moderadores e administradores também precisam da regra do Access, senão o Cloudflare bloqueia antes do Worker.
- Um moderador nunca mexe em moderadores ou administradores, e só promove entre `contributor` e `trusted`.
