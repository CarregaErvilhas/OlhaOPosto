"""The real Panoramax app (geovisio from requirements.txt), without a database.

The drift tests need the app exactly as production builds it, so that a
geovisio upgrade is tested against the code it ships. Only the three calls
that open the database are replaced; tile SQL is built, never run.
"""

import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

PANORAMAX = Path(__file__).resolve().parents[1]
FIXTURES = Path(__file__).resolve().parent / "fixtures"
sys.path.insert(0, str(PANORAMAX))

import geovisio  # noqa: E402
import geovisio.web.map as pnx_map  # noqa: E402
from geovisio import config_app  # noqa: E402
from geovisio.utils import db  # noqa: E402

# What upstream shipped, read before anything in this process changes it.
UPSTREAM = {"ZOOM_PICTURES": getattr(pnx_map, "ZOOM_PICTURES", None)}


@pytest.fixture(scope="session")
def app():
    db.create_db_pool = lambda app: None
    config_app.persist_config = lambda app: None
    app = geovisio.create_api(
        {
            "DB_URL": "postgresql://nobody@127.0.0.1:9/none",
            "DB_CHECK_SCHEMA": False,
            "FS_URL": "mem://",
            "TESTING": True,
        }
    )
    # Pools that cleanup_app() can "close" at exit.
    app.pool = app.long_queries_pool = SimpleNamespace(closed=True)
    # Both ask the database which grid table exists.
    pnx_map._has_non_public_fields = lambda: False
    pnx_map._get_pictures_grid_table = lambda: "pictures_aggregate_grid"
    return app


@pytest.fixture(scope="session")
def patched_app(app):
    import map_override

    try:
        map_override.apply(app)
    except map_override.DriftError as err:
        pytest.fail(str(err), pytrace=False)
    return app
