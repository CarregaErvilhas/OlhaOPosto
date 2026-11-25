"""Drift tests for map_override.py, server side.

Each failure says which assumption broke and what to do. Background in
Docs/infra.md, secção «Mapa: fotos de uma só foto».
"""

import json
from pathlib import Path

import geovisio
import geovisio.web.map as pnx_map
import pytest
from flask import Flask

import map_override
from conftest import FIXTURES, PANORAMAX, UPSTREAM

PICTURE = json.loads((FIXTURES / "picture.json").read_text())
DOC = map_override.DOC


def tile_sql(app, z):
    """The SQL geovisio builds for the tile holding the fixture picture at zoom z."""
    import math

    n = 2**z
    x = int((PICTURE["lon"] + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(PICTURE["lat"]))) / math.pi) / 2 * n)
    with app.test_request_context():
        query, _ = pnx_map._get_query(z, x, y, None, None)
        return query.as_string(None)


def test_upstream_assumptions(app):
    assert UPSTREAM["ZOOM_PICTURES"] == map_override.UPSTREAM_ZOOM_PICTURES, (
        f"O geovisio passou a pôr as fotos nos tiles a partir do zoom {UPSTREAM['ZOOM_PICTURES']!r} "
        f"(era {map_override.UPSTREAM_ZOOM_PICTURES}). Pode já não ser preciso baixá-lo: ver o changelog, "
        f"e ajustar UPSTREAM_ZOOM_PICTURES ou retirar essa parte do map_override.py. Mais em {DOC}."
    )
    try:
        map_override.check(app)
    except map_override.DriftError as err:
        pytest.fail(str(err), pytrace=False)


def test_upstream_viewer_template_unchanged():
    installed = Path(geovisio.__file__).parent / "templates" / "viewer.html"
    ours = PANORAMAX / "templates" / "viewer.upstream.html"
    assert installed.is_file(), (
        f"O geovisio já não tem templates/viewer.html. O /viewer passou a ser servido de outra forma: "
        f"ver como e mudar o map_override.py. Mais em {DOC}."
    )
    assert installed.read_text() == ours.read_text(), (
        "O geovisio mudou o templates/viewer.html (por exemplo, outra versão do visualizador). O nosso "
        "/viewer é panoramax/templates/viewer.html, uma cópia com alterações. Passar a mudança para a "
        "nossa cópia (e a versão para panoramax/viewer/package.json, se for o caso) e depois copiar o "
        f"ficheiro novo para panoramax/templates/viewer.upstream.html. Mais em {DOC}."
    )


@pytest.mark.parametrize("z", range(map_override.PICTURES_FROM_ZOOM, 16))
def test_tiles_carry_pictures(patched_app, z):
    assert "'pictures'" in tile_sql(patched_app, z), (
        f"Os tiles do zoom {z} já não levam a camada `pictures`, mesmo com o ZOOM_PICTURES em "
        f"{map_override.PICTURES_FROM_ZOOM}: o geovisio mudou a forma como escolhe as camadas. Ver o "
        f"_get_query do geovisio novo e ajustar o map_override.py. Mais em {DOC}."
    )


def test_tiles_below_from_zoom_keep_the_grid(patched_app):
    sql = tile_sql(patched_app, map_override.PICTURES_FROM_ZOOM - 1)
    assert "'grid'" in sql and "'pictures'" not in sql, (
        f"Os tiles do zoom {map_override.PICTURES_FROM_ZOOM - 1} deviam ter só a grelha e as sequências. "
        f"Ver o _get_query do geovisio novo. Mais em {DOC}."
    )


def test_tiles_only_public_pictures(patched_app):
    sql = tile_sql(patched_app, map_override.PICTURES_FROM_ZOOM)
    assert "is_picture_visible_by_user" in sql or "p.visibility = 'anyone'" in sql, (
        "Os tiles anónimos já não filtram as fotos escondidas (as que esperam moderação) da forma que "
        "conhecemos. Com as fotos a aparecer desde o zoom 7, isso poria fotos por aprovar no mapa do país. "
        f"Não fazer merge: ver o filtro de visibilidade no _get_query do geovisio novo. Mais em {DOC}."
    )


def test_style_json(patched_app):
    resp = patched_app.test_client().get("/api/map/style.json")
    assert resp.status_code == 200, f"/api/map/style.json deu {resp.status_code}: {resp.data[:300]!r}"
    style = resp.get_json()
    sources = style.get("sources", {})
    assert sources.get("geovisio", {}).get("maxzoom") == map_override.TILE_MAXZOOM, (
        f"A fonte `geovisio` do style.json tem maxzoom {sources.get('geovisio', {}).get('maxzoom')!r}, "
        f"esperava {map_override.TILE_MAXZOOM}. Com o maxzoom baixo, o MapLibre estica os tiles de zoom "
        "baixo até à rua e as fotos ficam dezenas de metros ao lado. Ver o embrulho do get_style_json "
        f"no map_override.py. Mais em {DOC}."
    )
    layers = {layer["id"]: layer for layer in style.get("layers", [])}
    assert layers.get("geovisio_pictures", {}).get("source-layer") == "pictures", (
        "O style.json já não tem a camada `geovisio_pictures` (source-layer `pictures`), que o script do "
        f"/viewer reestiliza. Ver os ids das camadas no geovisio novo. Mais em {DOC}."
    )


def test_viewer_page(patched_app):
    resp = patched_app.test_client().get("/viewer")
    html = resp.get_data(as_text=True)
    version = map_override.viewer_version()
    assert resp.status_code == 200, f"/viewer deu {resp.status_code}"
    assert "oopMapOverride" in html, (
        "O /viewer não é o nosso template (panoramax/templates/viewer.html): o map_override.py não "
        f"substituiu a rota. Mais em {DOC}."
    )
    assert f"@panoramax/web-viewer@{version}/build/index.js" in html and "@~" not in html, (
        f"O /viewer não carrega o visualizador na versão fixada ({version}, de panoramax/viewer/package.json)."
    )
    assert "max-age=0" in resp.headers.get("Cache-Control", ""), (
        f"O /viewer vai com Cache-Control {resp.headers.get('Cache-Control')!r}: sem max-age=0, os browsers "
        "guardam a página antiga dias depois de um deploy."
    )


def test_apply_changes_nothing_on_drift(app, monkeypatch):
    other = Flask("drift")
    other.view_functions["viewer"] = upstream_view = lambda: "upstream"
    style_before, zoom_before = pnx_map.get_style_json, pnx_map.ZOOM_PICTURES
    monkeypatch.delattr(pnx_map, "_get_query")
    with pytest.raises(map_override.DriftError, match="_get_query"):
        map_override.apply(other)
    assert other.view_functions["viewer"] is upstream_view
    assert pnx_map.get_style_json is style_before and pnx_map.ZOOM_PICTURES == zoom_before
