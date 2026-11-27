-- What a photo shows: `photo`, the station or a socket as until now, or
-- `plate`, a charger's rating plate (the label with its model, serial and
-- rated V/A/kW). Plates live in their own gallery: never a main photo, no
-- static link, points counted apart from the station's photos
-- (Docs/arquitetura.md, *Chapas*).
ALTER TABLE photos ADD COLUMN kind TEXT NOT NULL DEFAULT 'photo' CHECK (kind IN ('photo', 'plate'));
