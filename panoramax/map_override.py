"""Photos on the Panoramax map from zoom 7, not only from zoom 16.

Panoramax draws a sequence as a line from zoom 7 and its pictures as dots
only from zoom 15 (and the web viewer keeps the dots at radius 0 until about
16.5). Every olh'o'posto upload is a sequence of one picture, which has no
line, so between zoom 7 and ~16 the map showed nothing at all. Two changes
fix that, both owned by this module:

- Server: geovisio's `ZOOM_PICTURES` goes from 15 to 7, so the vector tiles
  carry the `pictures` layer from zoom 7. The constant also sets the tile
  source's `maxzoom` in style.json; that one is put back to 15, otherwise
  MapLibre would stretch the zoom 7 tiles to street level and move every dot
  by up to ~76 m.
- Viewer: our own /viewer page (templates/viewer.html) pins the web viewer to
  the version in viewer/package.json and restyles the pictures layer so the
  dots are visible from zoom 7.

Both depend on geovisio and web-viewer internals. `check()` names every
assumption; `apply()` changes nothing unless all of them hold. The tests in
tests/ run on every PR, including Dependabot's, and fail with the broken
assumption and what to do (Docs/infra.md, «Mapa: fotos de uma só foto»).
"""

from __future__ import annotations

import inspect
import json
import re
from pathlib import Path

import geovisio.web.map as pnx_map
from flask import Flask, Response
from jinja2 import Environment, FileSystemLoader, select_autoescape

PICTURES_FROM_ZOOM = 7
UPSTREAM_ZOOM_PICTURES = 15
TILE_MAXZOOM = 15
VIEWER_PACKAGE = "@panoramax/web-viewer"

HERE = Path(__file__).resolve().parent
TEMPLATES = HERE / "templates"
VIEWER_PACKAGE_JSON = HERE / "viewer" / "package.json"
DOC = "Docs/infra.md, secção «Mapa: fotos de uma só foto»"


class DriftError(RuntimeError):
    """An upstream change broke an assumption of this module."""


def _fail(what: str, todo: str) -> DriftError:
    return DriftError(f"{what}\nO que fazer: {todo}\nMais em {DOC}.")


def viewer_version() -> str:
    try:
        deps = json.loads(VIEWER_PACKAGE_JSON.read_text())["dependencies"]
        version = deps[VIEWER_PACKAGE]
    except (OSError, ValueError, KeyError) as err:
        raise _fail(
            f"Não consegui ler a versão do {VIEWER_PACKAGE} em panoramax/viewer/package.json ({err!r}).",
            "repor o ficheiro com a dependência numa versão exata, por exemplo \"4.4.0\".",
        ) from err
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise _fail(
            f"A versão do {VIEWER_PACKAGE} em panoramax/viewer/package.json é {version!r}, não uma versão exata.",
            "fixar uma versão exata (sem ^ nem ~): o /viewer carrega-a do CDN e os testes só garantem essa.",
        )
    return version


def _uses(func, name: str) -> bool:
    """Whether func (under its decorators) reads the global `name` by name."""
    func = inspect.unwrap(func)
    return name in getattr(getattr(func, "__code__", None), "co_names", ())


def check(app: Flask) -> str:
    """Raise DriftError if an assumption no longer holds; return the viewer version."""
    zoom = getattr(pnx_map, "ZOOM_PICTURES", None)
    if zoom not in (UPSTREAM_ZOOM_PICTURES, PICTURES_FROM_ZOOM):
        raise _fail(
            f"geovisio.web.map.ZOOM_PICTURES já não existe ou mudou (é {zoom!r}, esperava {UPSTREAM_ZOOM_PICTURES}).",
            "ver no geovisio novo a partir de que zoom os tiles levam a camada `pictures` e ajustar o map_override.py.",
        )
    for name in ("get_style_json", "_get_query", "getStyle"):
        if not callable(getattr(pnx_map, name, None)):
            raise _fail(
                f"geovisio.web.map.{name} já não existe.",
                "ver como o geovisio novo gera o style.json e os tiles e ajustar o map_override.py.",
            )
    if not _uses(pnx_map._get_query, "ZOOM_PICTURES"):
        raise _fail(
            "geovisio.web.map._get_query já não usa ZOOM_PICTURES para decidir quando os tiles levam as fotos.",
            "ver no _get_query novo como se escolhe a camada `pictures` e mudar o map_override.py para a pôr a partir do zoom 7.",
        )
    upstream_style = getattr(pnx_map.get_style_json, "oop_upstream", pnx_map.get_style_json)
    if not _uses(upstream_style, "ZOOM_PICTURES"):
        raise _fail(
            "geovisio.web.map.get_style_json já não usa ZOOM_PICTURES para o maxzoom da fonte dos tiles.",
            "confirmar que o style.json continua com maxzoom 15 e ajustar o embrulho em map_override.py.",
        )
    if not _uses(pnx_map.getStyle, "get_style_json"):
        raise _fail(
            "A rota /api/map/style.json (geovisio.web.map.getStyle) já não chama get_style_json.",
            "embrulhar a nova função que gera o style.json, para o maxzoom voltar a 15.",
        )
    if "viewer" not in app.view_functions:
        raise _fail(
            "A app do Panoramax já não tem a rota `viewer` (/viewer).",
            "ver como o geovisio novo serve o visualizador e onde pôr o nosso template.",
        )
    if not (TEMPLATES / "viewer.html").is_file():
        raise _fail("Falta panoramax/templates/viewer.html.", "repor o template do /viewer.")
    return viewer_version()


def apply(app: Flask) -> None:
    """Change tiles, style.json and /viewer, or nothing at all (DriftError)."""
    version = check(app)
    page = Environment(loader=FileSystemLoader(TEMPLATES), autoescape=select_autoescape()).get_template("viewer.html")

    upstream_style = pnx_map.get_style_json

    def get_style_json(*args, **kwargs):
        resp = upstream_style(*args, **kwargs)
        style = resp.get_json()
        for source in style.get("sources", {}).values():
            if source.get("type") == "vector":
                source["maxzoom"] = TILE_MAXZOOM
        resp.set_data(json.dumps(style))
        return resp

    get_style_json.oop_override = True
    get_style_json.oop_upstream = upstream_style

    def viewer():
        html = page.render(viewer_version=version, pictures_from_zoom=PICTURES_FROM_ZOOM)
        # Upstream sends `Cache-Control: public` with no max-age, which lets
        # browsers keep an old page for days after a deploy. Not `no-cache`:
        # geovisio's after_request hook strips it (it keeps max-age).
        return Response(html, mimetype="text/html", headers={"Cache-Control": "max-age=0, must-revalidate"})

    # Everything was checked above; the three changes go in together. The
    # module ones only once per process (the tests build several apps).
    if not getattr(upstream_style, "oop_override", False):
        pnx_map.get_style_json = get_style_json
        pnx_map.ZOOM_PICTURES = PICTURES_FROM_ZOOM
    app.view_functions["viewer"] = viewer
