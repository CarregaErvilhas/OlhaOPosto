"""Create the VoltFrame service account on Panoramax and rotate its token.

The account (`pictures` by default) has the `user` role, not `admin`: it can
upload and change the visibility of its own pictures, and nothing else. The
default account that Panoramax creates (role `admin`) stays for maintenance
only; its token is never handed to the Worker.

Run inside the `pano` container (ssh pano), from /var/www:

    /opt/venv/bin/python panoramax/service_account.py [name] [description]

Each run deletes ALL tokens of the account and creates one new token. Any
token of an account can list its siblings (GET /api/users/me/tokens) and
fetch their JWTs (GET /api/users/me/tokens/<id>), so revoking one row is not
enough: a leaked token must take the whole account's tokens with it. This
also removes the 'default token' that Panoramax's generate_default_token_trg
trigger adds to every new account. The JWTs carry no expiry.

To revoke without minting a new token:

    DELETE FROM tokens WHERE account_id = (SELECT id FROM accounts WHERE name = 'pictures');

The JWT is printed to stdout and nothing else is: pipe it straight into
`wrangler secret put` instead of copying it from the terminal when possible.
"""

import sys

from flask import current_app
from psycopg.rows import dict_row

from geovisio import create_app
from geovisio.utils import db
from geovisio.web.tokens import _generate_jwt_token


def main() -> int:
    name = sys.argv[1] if len(sys.argv) > 1 else "pictures"
    description = sys.argv[2] if len(sys.argv) > 2 else "VoltFrame Worker"

    app = create_app()
    with app.app_context(), db.conn(current_app) as conn, conn.transaction():
        cur = conn.cursor(row_factory=dict_row)
        rows = cur.execute("SELECT id, role, is_default FROM accounts WHERE name = %s", [name]).fetchall()
        if len(rows) > 1:
            print(f"service_account: several accounts named {name!r}, fix this by hand", file=sys.stderr)
            return 1
        if rows:
            account = rows[0]
            if account["is_default"] or account["role"] != "user":
                print(f"service_account: {name!r} is the default or an admin account, refusing", file=sys.stderr)
                return 1
        else:
            account = cur.execute(
                "INSERT INTO accounts (name, role) VALUES (%s, 'user') RETURNING id, role, is_default", [name]
            ).fetchone()
            print(f"service_account: created account {name!r} ({account['id']})", file=sys.stderr)

        deleted = cur.execute("DELETE FROM tokens WHERE account_id = %s", [account["id"]]).rowcount
        print(f"service_account: revoked {deleted} old token(s) of {name!r}", file=sys.stderr)

        token = cur.execute(
            "INSERT INTO tokens (account_id, description) VALUES (%s, %s) RETURNING id",
            [account["id"], description],
        ).fetchone()
        print(f"service_account: token {token['id']} for {name!r}", file=sys.stderr)
        print(_generate_jwt_token(token["id"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
