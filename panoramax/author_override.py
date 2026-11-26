"""The photo's author, not the OlhaOPosto account, as its producer in Panoramax.

Every olh'o'posto photo is uploaded by the one service account, and geovisio
names the uploading account as the photo's producer (the STAC `providers`
and `geovisio:producer`). The web viewer shows that as "Author", so every
photo was credited to OlhaOPosto instead of the person who took it, which is
not the credit CC BY-SA asks for.

The author is already on each photo as the `OlhaOPosto|author` tag, and the
Worker rewrites that tag when someone changes their credit (Docs/arquitetura.md,
«Crédito»). So this module wraps geovisio's picture to STAC function: when a
picture carries the tag, its value becomes the only producer. Because it is
read on every request, photos uploaded before this module also show the right
author, and a credit change shows up on the next request.

Not the EXIF Artist field, which geovisio also lists as a producer: that one
is frozen at upload, so a later pseudonym would leave the old name for good.

Pictures without the tag (none today) keep the stock producers. Sequences
(`/api/collections`) still name the account: each of ours holds one photo.

Depends on geovisio internals. `check()` names every assumption; `apply()`
changes nothing unless all of them hold.
"""

from __future__ import annotations

import inspect

import geovisio.web.items as pnx_items

AUTHOR_KEY = "OlhaOPosto|author"
CALLERS = ("getCollectionItems", "_getPictureItemById", "searchItems")
DOC = "Docs/infra.md, secção «Autor das fotos no Panoramax»"


class DriftError(RuntimeError):
    """An upstream change broke an assumption of this module."""


def _fail(what: str, todo: str) -> DriftError:
    return DriftError(f"{what}\nO que fazer: {todo}\nMais em {DOC}.")


def _uses(func, name: str) -> bool:
    func = inspect.unwrap(func)
    return name in getattr(getattr(func, "__code__", None), "co_names", ())


def author_of(item: dict) -> str | None:
    """The `OlhaOPosto|author` value of a STAC item, if it has exactly one."""
    values = {
        s.get("value")
        for s in (item.get("properties") or {}).get("semantics") or []
        if isinstance(s, dict) and s.get("key") == AUTHOR_KEY and s.get("value")
    }
    return values.pop() if len(values) == 1 else None


def credit_author(item: dict) -> dict:
    author = author_of(item)
    if author is not None:
        item["providers"] = [{"name": author, "roles": ["producer"]}]
        item.setdefault("properties", {})["geovisio:producer"] = author
    return item


def check() -> None:
    """Raise DriftError if an assumption no longer holds."""
    upstream = getattr(pnx_items.dbPictureToStacItem, "oop_upstream", pnx_items.dbPictureToStacItem)
    if not callable(upstream):
        raise _fail(
            "geovisio.web.items.dbPictureToStacItem já não existe.",
            "ver no geovisio novo que função gera o item STAC de uma foto e embrulhá-la no author_override.py.",
        )
    for name in CALLERS:
        func = getattr(pnx_items, name, None)
        if not callable(func) or not _uses(func, "dbPictureToStacItem"):
            raise _fail(
                f"geovisio.web.items.{name} já não existe ou já não chama dbPictureToStacItem.",
                "ver como o geovisio novo gera os itens dessa rota e garantir que passam pelo embrulho.",
            )


def apply() -> None:
    """Wrap the picture to STAC function, or change nothing (DriftError)."""
    check()
    if getattr(pnx_items.dbPictureToStacItem, "oop_override", False):
        return
    upstream = pnx_items.dbPictureToStacItem

    def dbPictureToStacItem(*args, **kwargs):
        return credit_author(upstream(*args, **kwargs))

    dbPictureToStacItem.oop_override = True
    dbPictureToStacItem.oop_upstream = upstream
    pnx_items.dbPictureToStacItem = dbPictureToStacItem
