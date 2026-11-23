"""Prepare the Zerops PostgreSQL database for Panoramax.

Runs as a Zerops initCommand before `panoramax_backend db upgrade`, on every
container start. Idempotent.

The Panoramax migrations create three extensions. `pg_trgm` and `uuid-ossp`
are trusted (the database owner can create them), but `postgis` is not, so
this script creates all three with the superuser. It also lets the app role
set `session_replication_role`, which some migrations use to speed up large
updates (without it they still work, only slower).

Environment:
  PANO_DB_SUPERUSER_URL  postgresql://postgres:...@db:5432/db (Zerops superuser)
  PANO_DB_APP_USER       role used by the API (the Zerops service user, `db`)
"""

import os
import sys

import psycopg
from psycopg import sql

MIN_POSTGIS = (3, 4)
EXTENSIONS = ("postgis", "pg_trgm", "uuid-ossp")


def main() -> int:
    url = os.environ.get("PANO_DB_SUPERUSER_URL")
    app_user = os.environ.get("PANO_DB_APP_USER")
    if not url or not app_user:
        print("bootstrap_db: PANO_DB_SUPERUSER_URL and PANO_DB_APP_USER are required", file=sys.stderr)
        return 1

    with psycopg.connect(url, autocommit=True) as conn:
        server_version = conn.info.server_version // 10000
        print(f"bootstrap_db: PostgreSQL {server_version}")

        available = {
            name
            for (name,) in conn.execute(
                "SELECT name FROM pg_available_extensions WHERE name = ANY(%s)", [list(EXTENSIONS)]
            )
        }
        missing = [e for e in EXTENSIONS if e not in available]
        if missing:
            print(f"bootstrap_db: extensions not available on this server: {', '.join(missing)}", file=sys.stderr)
            return 1

        for ext in EXTENSIONS:
            conn.execute(sql.SQL("CREATE EXTENSION IF NOT EXISTS {}").format(sql.Identifier(ext)))

        (postgis,) = conn.execute("SELECT extversion FROM pg_extension WHERE extname = 'postgis'").fetchone()
        major_minor = tuple(int(p) for p in postgis.split(".")[:2])
        print(f"bootstrap_db: PostGIS {postgis}")
        if major_minor < MIN_POSTGIS:
            print(f"bootstrap_db: Panoramax needs PostGIS >= {'.'.join(map(str, MIN_POSTGIS))}", file=sys.stderr)
            return 1

        if server_version >= 15:
            conn.execute(
                sql.SQL("GRANT SET ON PARAMETER session_replication_role TO {}").format(sql.Identifier(app_user))
            )

        # Panoramax refuses to start on a database that is not in UTC.
        (dbname,) = conn.execute("SELECT current_database()").fetchone()
        conn.execute(sql.SQL("ALTER DATABASE {} SET timezone TO 'UTC'").format(sql.Identifier(dbname)))

    print("bootstrap_db: ok")
    return 0


if __name__ == "__main__":
    sys.exit(main())
