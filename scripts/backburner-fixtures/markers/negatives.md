# The negative deck (M2 + T1) — every line here must harvest to ZERO

Jim's first fixture, the plan's own grammar documentation (placeholders = never parses):
one line, anywhere — `WAITING-ON: <who> — <what>`

Backtick-quoted: `WAITING-ON: quoted — must not parse` and `PARKED-UNTIL: 2020-01-01 | owner: x | because: y`

Fenced:
```
WAITING-ON: fenced — must not parse
PARKED-UNTIL: 2020-01-01 | owner: fenced | because: must not parse
```

Mid-line mention: the grammar WAITING-ON: appears here mid-sentence after text, which the
line-start rule rejects only if the marker is not at line start — this line starts with "Mid-line".

A derived-output specimen (T1 — rendered tokens must not re-enrol):
WAITING·ON: rendered token with middle dot — harvests to zero by construction
PARKED·UNTIL: rendered — same
