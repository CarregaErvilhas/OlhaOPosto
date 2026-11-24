-- Lookup by socket code for GET /api/v1/evses/{evse}. Not UNIQUE: the NAP does
-- not guarantee one code per socket, and an operator has published the same
-- code on two stations before. Building it writes one index row per point.
CREATE INDEX evses_evse_compact ON evses (evse_compact);
