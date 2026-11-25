// User roles: the page where moderators and admins see the accounts and
// change their role (Docs/plan.md, *Papéis*).
//
// Who can do what:
//   - admin: any role for anyone but themselves;
//   - moderator: contributor <-> trusted only, never on moderators or admins.
// Nobody changes their own role, so the last admin cannot lock themselves out.
// Every change records who made it and when (promoted_by, promoted_at).

import { currentUser, page, sameOrigin, type AuthEnv, type SessionUser } from './auth.ts';
import { BRAND, accountPath, esc, layout, type Lang } from './pages.ts';

export const ROLES = ['contributor', 'trusted', 'moderator', 'admin'] as const;
export type Role = (typeof ROLES)[number];
const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v);

export const adminUsersPath = (lang: Lang) => (lang === 'pt' ? '/admin/utilizadores' : '/en/admin/users');
// One POST for both languages; the form says which page to go back to.
export const ROLE_ACTION = '/admin/papel';

export const canManageUsers = (role: string) => role === 'moderator' || role === 'admin';

// The roles `actor` may give to `target`, other than the one it already has.
export function assignableRoles(actor: { id: string; role: string }, target: { id: string; role: string }): Role[] {
  if (actor.id === target.id) return [];
  if (actor.role === 'admin') return ROLES.filter((r) => r !== target.role);
  if (actor.role === 'moderator' && (target.role === 'contributor' || target.role === 'trusted')) {
    return target.role === 'contributor' ? ['trusted'] : ['contributor'];
  }
  return [];
}

const T = {
  pt: {
    title: 'Utilizadores',
    intro: 'Contas que já iniciaram sessão, da mais recente para a mais antiga. Só administradores podem nomear moderadores e administradores; moderadores só mudam entre contribuidor e de confiança.',
    search: 'Procurar pelo nome no OSM',
    searchButton: 'Procurar',
    name: 'Nome',
    role: 'Papel',
    lastLogin: 'Última sessão',
    changedBy: 'Mudado por',
    change: 'Mudar para',
    save: 'Guardar',
    you: '(tu)',
    none: 'Nenhuma conta encontrada.',
    forbidden: 'Esta página é só para moderadores e administradores.',
    back: 'Voltar à conta',
    roles: { contributor: 'contribuidor', trusted: 'de confiança', moderator: 'moderador', admin: 'administrador' } as Record<string, string>,
    ok: 'Papel mudado.',
    errors: {
      forbidden: 'Não podes dar esse papel a essa conta.',
      stale: 'A conta mudou entretanto. Vê outra vez e tenta de novo.',
      bad: 'Pedido inválido.',
    } as Record<string, string>,
  },
  en: {
    title: 'Users',
    intro: 'Accounts that have signed in, most recent first. Only admins can appoint moderators and admins; moderators only switch between contributor and trusted.',
    search: 'Search by OSM name',
    searchButton: 'Search',
    name: 'Name',
    role: 'Role',
    lastLogin: 'Last sign-in',
    changedBy: 'Changed by',
    change: 'Change to',
    save: 'Save',
    you: '(you)',
    none: 'No accounts found.',
    forbidden: 'This page is only for moderators and admins.',
    back: 'Back to account',
    roles: { contributor: 'contributor', trusted: 'trusted', moderator: 'moderator', admin: 'administrator' } as Record<string, string>,
    ok: 'Role changed.',
    errors: {
      forbidden: 'You cannot give that role to that account.',
      stale: 'The account changed in the meantime. Look again and retry.',
      bad: 'Invalid request.',
    } as Record<string, string>,
  },
};

export interface UserRow {
  id: string;
  osm_name: string;
  role: string;
  last_login_at: string;
  promoted_at: string | null;
  promoted_by_name: string | null;
}

const LIST_LIMIT = 200;

// auth.ts types only what login needs from D1; these are the two calls added here.
interface AdminStmt {
  bind(...values: unknown[]): AdminStmt;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
const adminDb = (env: AuthEnv) => env.DB as unknown as { prepare(sql: string): AdminStmt };

export function usersPage(
  lang: Lang,
  actor: SessionUser,
  users: UserRow[],
  p: { q: string; ok?: boolean; error?: string },
): string {
  const t = T[lang];
  const parts: string[] = [`<h1>${t.title}</h1>`, `<p>${t.intro}</p>`];
  if (p.ok) parts.push(`<p class="notice" role="status">${t.ok}</p>`);
  const err = p.error ? t.errors[p.error] : undefined;
  if (err) parts.push(`<p class="notice" role="alert">${esc(err)}</p>`);
  parts.push(
    `<form class="search" action="${adminUsersPath(lang)}" method="get" role="search">` +
      `<label for="q">${t.search}</label>` +
      `<div class="search-row"><input id="q" name="q" type="search" value="${esc(p.q)}" maxlength="100" autocomplete="off" spellcheck="false">` +
      `<button type="submit">${t.searchButton}</button></div></form>`,
  );
  if (users.length === 0) {
    parts.push(`<p>${t.none}</p>`);
  } else {
    const rows = users.map((u) => {
      const options = assignableRoles(actor, u);
      // OSM names are the person's own text, in whatever language they chose.
      const name = `<a lang="" href="https://www.openstreetmap.org/user/${encodeURIComponent(u.osm_name)}" rel="noopener" target="_blank">${esc(u.osm_name)}</a>` +
        (u.id === actor.id ? ` ${t.you}` : '');
      const changed = u.promoted_at
        ? `${u.promoted_by_name ? `<span lang="">${esc(u.promoted_by_name)}</span>, ` : ''}${esc(u.promoted_at.slice(0, 10))}`
        : '';
      const form = options.length
        ? `<form method="post" action="${ROLE_ACTION}" class="role-form">` +
          `<input type="hidden" name="user" value="${esc(u.id)}">` +
          `<input type="hidden" name="from" value="${esc(u.role)}">` +
          `<input type="hidden" name="lang" value="${lang}">` +
          `<label class="sr-only" for="r-${esc(u.id)}">${t.change}</label>` +
          `<select id="r-${esc(u.id)}" name="role">${options.map((r) => `<option value="${r}">${t.roles[r]}</option>`).join('')}</select> ` +
          `<button type="submit" class="button secondary">${t.save}</button></form>`
        : '';
      return `<tr><td>${name}</td><td>${esc(t.roles[u.role] ?? u.role)}</td><td>${esc(u.last_login_at.slice(0, 10))}</td><td>${changed}</td><td>${form}</td></tr>`;
    });
    parts.push(
      `<div class="table-wrap"><table class="users">` +
        `<thead><tr><th scope="col">${t.name}</th><th scope="col">${t.role}</th><th scope="col">${t.lastLogin}</th><th scope="col">${t.changedBy}</th><th scope="col">${t.change}</th></tr></thead>` +
        `<tbody>${rows.join('')}</tbody></table></div>`,
    );
  }
  parts.push(`<p><a href="${accountPath(lang)}">${t.back}</a></p>`);
  return layout({
    lang,
    title: `${t.title} · ${BRAND}`,
    description: t.title,
    noindex: true,
    switchTo: { pt: adminUsersPath('pt'), en: adminUsersPath('en') },
    body: parts.join('\n'),
  });
}

function forbiddenPage(lang: Lang): string {
  const t = T[lang];
  return layout({
    lang,
    title: `${t.title} · ${BRAND}`,
    description: t.title,
    noindex: true,
    body: `<div class="page-msg">\n<h1>${t.title}</h1>\n<p>${t.forbidden}</p>\n<p><a href="${accountPath(lang)}">${t.back}</a></p>\n</div>`,
  });
}

const redirect = (location: string, status = 302) =>
  new Response(null, { status, headers: { location, 'cache-control': 'no-store' } });

export async function usersHtml(lang: Lang, request: Request, env: AuthEnv, headers: Record<string, string>): Promise<Response> {
  const actor = await currentUser(request, env).catch(() => null);
  const url = new URL(request.url);
  if (!actor) return redirect(`/auth/osm/login?next=${encodeURIComponent(adminUsersPath(lang))}`);
  if (!canManageUsers(actor.role)) return page(lang, forbiddenPage(lang), 403, headers);
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 100);
  // LIKE wildcards in the name are matched literally.
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { results } = await adminDb(env).prepare(
    `SELECT u.id, u.osm_name, u.role, u.last_login_at, u.promoted_at,
            COALESCE(p.pseudonym, p.osm_name) AS promoted_by_name
       FROM users u LEFT JOIN users p ON p.id = u.promoted_by
      WHERE ? = '' OR u.osm_name LIKE ? ESCAPE '\\'
      ORDER BY u.last_login_at DESC
      LIMIT ${LIST_LIMIT}`,
  ).bind(q, like).all<UserRow>();
  const ok = url.searchParams.get('ok') === '1';
  const error = url.searchParams.get('erro') ?? undefined;
  return page(lang, usersPage(lang, actor, results ?? [], { q, ok, error }), 200, headers);
}

export async function setRole(request: Request, env: AuthEnv, now = new Date()): Promise<Response> {
  if (!sameOrigin(request)) return new Response('forbidden', { status: 403, headers: { 'cache-control': 'no-store' } });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response('bad request', { status: 400, headers: { 'cache-control': 'no-store' } });
  }
  const lang: Lang = form.get('lang') === 'en' ? 'en' : 'pt';
  const back = (q: string) => redirect(`${adminUsersPath(lang)}?${q}`, 303);
  const actor = await currentUser(request, env);
  if (!actor) return redirect(`/auth/osm/login?next=${encodeURIComponent(adminUsersPath(lang))}`, 303);
  if (!canManageUsers(actor.role)) return back('erro=forbidden');
  const userId = form.get('user');
  const from = form.get('from');
  const role = form.get('role');
  if (typeof userId !== 'string' || !isRole(from) || !isRole(role)) return back('erro=bad');
  if (!assignableRoles(actor, { id: userId, role: from }).includes(role)) return back('erro=forbidden');
  // `role = ?` makes it a compare-and-set: if someone else changed the account
  // since the page was drawn, nothing is written.
  const res = await adminDb(env).prepare(
    'UPDATE users SET role = ?, promoted_by = ?, promoted_at = ? WHERE id = ? AND role = ?',
  ).bind(role, actor.id, now.toISOString(), userId, from).run();
  return back(res.meta.changes === 1 ? 'ok=1' : 'erro=stale');
}
