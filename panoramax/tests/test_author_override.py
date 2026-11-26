"""Drift tests for author_override.py.

Each failure says which assumption broke and what to do. Background in
Docs/infra.md, secção «Autor das fotos no Panoramax».
"""

from datetime import datetime, timezone
from uuid import UUID

import geovisio.web.items as pnx_items
import pytest

import author_override

DOC = author_override.DOC
ACCOUNT = "OlhaOPosto"
AUTHOR = "Maria Exemplo"


def db_pic(semantics, artist=None):
    """A pictures row as the three item routes select it."""
    ts = datetime(2026, 1, 2, 10, 0, tzinfo=timezone.utc)
    return {
        "id": UUID("00000000-0000-0000-0000-000000000001"),
        "seq_id": UUID("00000000-0000-0000-0000-000000000002"),
        "account_id": UUID("00000000-0000-0000-0000-000000000003"),
        "account_name": ACCOUNT,
        "geojson": {"type": "Point", "coordinates": [-8.6, 39.9]},
        "ts": ts,
        "inserted_at": ts,
        "updated_at": ts,
        "heading": 0,
        "rank": 1,
        "status": "ready",
        "visibility": "anyone",
        "metadata": {"type": "flat", "width": 2048, "height": 1536},
        "exif": {"Exif.Image.Artist": artist} if artist else {},
        "semantics": semantics,
    }


@pytest.fixture(scope="module")
def to_stac(app):
    try:
        author_override.apply()
    except author_override.DriftError as err:
        pytest.fail(str(err), pytrace=False)

    def build(dbPic):
        with app.test_request_context():
            return pnx_items.dbPictureToStacItem(dbPic)

    return build


def test_upstream_assumptions():
    try:
        author_override.check()
    except author_override.DriftError as err:
        pytest.fail(str(err), pytrace=False)


def test_upstream_still_credits_the_account(app):
    """If geovisio stops naming the account, this module may be unnecessary."""
    upstream = getattr(pnx_items.dbPictureToStacItem, "oop_upstream", pnx_items.dbPictureToStacItem)
    with app.test_request_context():
        item = upstream(db_pic([{"key": author_override.AUTHOR_KEY, "value": AUTHOR}]))
    assert [p["name"] for p in item["providers"]] == [ACCOUNT], (
        f"O geovisio já não põe só a conta como produtor (providers = {item['providers']!r}). "
        f"Ver o que mudou no dbPictureToStacItem e se o author_override.py ainda faz falta. Mais em {DOC}."
    )
    assert any(s.get("key") == author_override.AUTHOR_KEY for s in item["properties"]["semantics"]), (
        f"O item STAC já não traz as etiquetas em properties.semantics como {{key, value}}. "
        f"Ajustar author_of() no author_override.py. Mais em {DOC}."
    )


def test_author_replaces_account_and_artist(to_stac):
    item = to_stac(db_pic(
        [{"key": "OlhaOPosto|site", "value": "X"}, {"key": author_override.AUTHOR_KEY, "value": AUTHOR}],
        artist="Old Name",
    ))
    assert item["providers"] == [{"name": AUTHOR, "roles": ["producer"]}]
    assert item["properties"]["geovisio:producer"] == AUTHOR


@pytest.mark.parametrize("semantics", [
    [],
    [{"key": author_override.AUTHOR_KEY, "value": ""}],
    [{"key": author_override.AUTHOR_KEY, "value": "A"}, {"key": author_override.AUTHOR_KEY, "value": "B"}],
])
def test_no_single_author_keeps_stock(to_stac, semantics):
    item = to_stac(db_pic(semantics))
    assert [p["name"] for p in item["providers"]] == [ACCOUNT]
    assert item["properties"]["geovisio:producer"] == ACCOUNT


def test_apply_is_idempotent(to_stac):
    first = pnx_items.dbPictureToStacItem
    author_override.apply()
    assert pnx_items.dbPictureToStacItem is first
