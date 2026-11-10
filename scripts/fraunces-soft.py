"""Make the site's text font from Fraunces.

Fraunces has four adjustable axes. The site only ever uses it fully soft and
without its "wonky" alternates, so this fixes those two, keeps weight and
optical size adjustable, keeps Latin only, and writes WOFF2. The result is
about half the size of the full font.

    pip install "fonttools[woff]"
    python3 scripts/fraunces-soft.py path/to/Fraunces-Roman-VF.ttf path/to/Fraunces-Italic-VF.ttf

The two sources come from https://github.com/undercasetype/Fraunces (SIL Open
Font License; see src/assets/fonts/OFL-Fraunces.txt).
"""

import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

OUT = Path(__file__).resolve().parent.parent / "src" / "assets" / "fonts"
LATIN = (
    "U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+02C6,U+02DA,U+02DC,U+2010-2015,U+2018-201E,"
    "U+2020-2022,U+2026,U+2030,U+2039-203A,U+2044,U+20AC,U+2122,U+2190-2193,U+2212,U+2215"
)

roman, italic = sys.argv[1:3]
for source, name in ((roman, "fraunces-soft.woff2"), (italic, "fraunces-soft-italic.woff2")):
    font = instancer.instantiateVariableFont(TTFont(source), {"SOFT": 100, "WONK": 0})
    # Fixing an axis can leave glyphs without an entry in the variations table,
    # which the subsetter then trips over.
    variations = font["gvar"].variations
    for glyph in font.getGlyphOrder():
        variations.setdefault(glyph, [])

    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.notdef_outline = True
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=subset.parse_unicodes(LATIN))
    subsetter.subset(font)

    font.flavor = "woff2"
    font.save(OUT / name)
    print(f"wrote {name}: {(OUT / name).stat().st_size // 1024} KB")
