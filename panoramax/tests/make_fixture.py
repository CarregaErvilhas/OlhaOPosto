"""Writes tests/fixtures/picture.mvt: one picture in a zoom 10 tile.

Run by hand only if the fixture must change (needs `mapbox-vector-tile`):
    python tests/make_fixture.py
The test serves this tile for its z/x/y, so the viewer has a picture to draw
at zoom 10 without a database.
"""

import json
import math
from pathlib import Path

import mapbox_vector_tile

LON, LAT, Z = -8.536285, 41.13669, 10
PICTURE_ID = "00000000-0000-4000-8000-0000000000a1"
EXTENT = 4096


def tile_position(lon, lat, z):
    n = 2**z
    fx = (lon + 180) / 360 * n
    fy = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return int(fx), int(fy), fx % 1, fy % 1


def main():
    x, y, px, py = tile_position(LON, LAT, Z)
    point = f"POINT({round(px * EXTENT)} {round(py * EXTENT)})"
    tile = mapbox_vector_tile.encode(
        [
            {"name": "sequences", "features": []},
            {
                "name": "pictures",
                "features": [
                    {
                        "geometry": point,
                        "properties": {
                            "id": PICTURE_ID,
                            "ts": "2026-01-01 12:00:00+00",
                            "heading": 0,
                            "account_id": "00000000-0000-4000-8000-0000000000b2",
                            "type": "flat",
                            "model": "",
                            "sequences": json.dumps(["00000000-0000-4000-8000-0000000000c3"]),
                            "first_sequence": "00000000-0000-4000-8000-0000000000c3",
                        },
                    }
                ],
            },
        ],
        default_options={"y_coord_down": True, "extents": EXTENT},
    )
    out = Path(__file__).parent / "fixtures"
    (out / "picture.mvt").write_bytes(tile)
    (out / "picture.json").write_text(json.dumps({"z": Z, "x": x, "y": y, "lon": LON, "lat": LAT, "id": PICTURE_ID}, indent=2) + "\n")
    print(f"tile {Z}/{x}/{y}, {len(tile)} bytes")


if __name__ == "__main__":
    main()
