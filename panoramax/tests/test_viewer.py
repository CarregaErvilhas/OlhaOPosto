"""Drift test for map_override.py, viewer side, in a real browser.

Serves the real /viewer and style.json from the patched app, with the web
viewer from the CDN at the version in panoramax/viewer/package.json, and one
picture (fixtures/picture.mvt) in the zoom 10 tile. The test passes only if
that picture is drawn, visibly, at zoom 10, where stock Panoramax draws
nothing. The basemap comes from the internet too; its font errors in the
console are normal and not checked.
"""

import json
import re
import threading

import pytest
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import sync_playwright
from werkzeug.serving import make_server

import map_override
from conftest import FIXTURES

PICTURE = json.loads((FIXTURES / "picture.json").read_text())
TILE = (FIXTURES / "picture.mvt").read_bytes()
LANDING = (FIXTURES / "landing.json").read_text()
DOC = map_override.DOC
ZOOM = 10


@pytest.fixture(scope="module")
def base_url(patched_app):
    server = make_server("127.0.0.1", 0, patched_app, threaded=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()


def fail(what, todo):
    pytest.fail(f"{what}\nO que fazer: {todo}\nMais em {DOC}.", pytrace=False)


def test_viewer_draws_single_photo_at_zoom_10(base_url):
    version = map_override.viewer_version()
    tile_path = f"/api/map/{PICTURE['z']}/{PICTURE['x']}/{PICTURE['y']}.mvt"

    def landing(route):
        route.fulfill(status=200, content_type="application/json", body=LANDING.replace("{base}", base_url))

    def tiles(route):
        # The fixture tile for its z/x/y; every other tile is empty (no database).
        body = TILE if route.request.url.endswith(tile_path) else b""
        route.fulfill(status=200, content_type="application/vnd.mapbox-vector-tile", body=body)

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1024, "height": 768})
        page.route(re.compile(r"^http://127\.0\.0\.1:\d+/api/?(\?.*)?$"), landing)
        page.route(re.compile(r"^http://127\.0\.0\.1:\d+/api/map/\d+/\d+/\d+\.mvt$"), tiles)
        page.goto(f"{base_url}/viewer?focus=map&map={ZOOM}/{PICTURE['lat']}/{PICTURE['lon']}")

        try:
            page.wait_for_function("() => window.oopMapOverride && window.oopMapOverride.applied > 0", timeout=60_000)
        except PlaywrightError:
            state = page.evaluate("() => window.oopMapOverride || null")
            viewer = page.evaluate("() => { const v = document.getElementById('viewer'); return v ? Object.keys(v).length : null }")
            if state is None:
                fail("O script do /viewer não correu.", "ver se o /viewer ainda é o nosso template e se há erros de JavaScript.")
            if state.get("error"):
                fail(
                    f"O visualizador {version} já não expõe o mapa em `viewer.map` ({state['error']}; viewer={viewer}).",
                    "confirmar primeiro que o bundle carrega do CDN e que o componente iniciou; se sim, procurar no visualizador novo onde fica o objeto do MapLibre e mudar o script em panoramax/templates/viewer.html.",
                )
            fail(
                f"O visualizador {version} carregou mas não tem nenhuma camada `geovisio…_pictures` do tipo circle.",
                "ver os ids das camadas no visualizador novo e mudar o filtro no script em panoramax/templates/viewer.html.",
            )

        paint = page.evaluate(
            """() => {
                const map = document.getElementById('viewer').map;
                const id = window.oopMapOverride.layers[0];
                return { opacity: map.getPaintProperty(id, 'circle-opacity'), radius: map.getPaintProperty(id, 'circle-radius') };
            }"""
        )
        if paint["opacity"] != 1 or not isinstance(paint["radius"], list) or paint["radius"][3] != map_override.PICTURES_FROM_ZOOM:
            fail(
                f"O estilo das fotos foi reposto pelo visualizador {version} (opacidade {paint['opacity']!r}).",
                "ver quando o visualizador novo volta a definir o paint das camadas e reaplicar o nosso aí.",
            )

        # The feature must be in the map (queryRenderedFeatures) and drawn as
        # visible orange pixels where the picture is. The pixel check matters:
        # MapLibre returns a circle of radius 0 or opacity 0 as "rendered".
        found = page.evaluate(
            """([id, lon, lat]) => new Promise((resolve) => {
                const map = document.getElementById('viewer').map;
                const look = () => {
                    const features = map.queryRenderedFeatures({ layers: window.oopMapOverride.layers })
                        .filter((f) => f.properties.id === id);
                    const canvas = map.getCanvas();
                    const ratio = canvas.width / (canvas.clientWidth || canvas.width);
                    const at = map.project([lon, lat]);
                    const copy = document.createElement('canvas');
                    copy.width = canvas.width; copy.height = canvas.height;
                    const ctx = copy.getContext('2d');
                    ctx.drawImage(canvas, 0, 0);
                    const r = Math.round(8 * ratio);
                    const px = ctx.getImageData(Math.round(at.x * ratio) - r, Math.round(at.y * ratio) - r, 2 * r + 1, 2 * r + 1).data;
                    let visible = 0;
                    for (let i = 0; i < px.length; i += 4) {
                        // v4 draws orange dots; v5 uses the purple default palette.
                        const orange = px[i] > 200 && px[i + 1] > 70 && px[i + 1] < 160 && px[i + 2] < 90;
                        const purple = px[i] > 60 && px[i] < 130 && px[i + 1] < 80 && px[i + 2] > 110 && px[i + 2] < 180;
                        if (orange || purple) visible += 1;
                    }
                    return { features: features.length, visible };
                };
                let last = null;
                const deadline = Date.now() + 45000;
                const tick = () => {
                    last = look();
                    if ((last.features && last.visible >= 4) || Date.now() > deadline) resolve(last);
                    else { map.triggerRepaint(); setTimeout(tick, 300); }
                };
                tick();
            })""",
            [PICTURE["id"], PICTURE["lon"], PICTURE["lat"]],
        )
        browser.close()
    if not found["features"]:
        fail(
            f"Ao zoom {ZOOM} a foto de teste não chega ao mapa do visualizador {version} (tile 10/{PICTURE['x']}/{PICTURE['y']}).",
            "ver se o visualizador novo filtra as fotos por zoom de outra forma (por exemplo minzoom na camada) e ajustar o script em panoramax/templates/viewer.html.",
        )
    if found["visible"] < 4:
        fail(
            f"Ao zoom {ZOOM} a foto de teste está no mapa mas não se vê ({found['visible']} píxeis da cor da camada onde ela está).",
            "ver o raio, a opacidade e a cor da camada das fotos no visualizador novo e ajustar o PAINT em panoramax/templates/viewer.html.",
        )
