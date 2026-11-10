"""Cut the site's fonts down to what its pages use.

The complete fonts live in src/assets/fonts/full/. Every page needs three of
them, and they were most of what a visitor downloaded, so this writes smaller
copies next to that folder: Latin characters only, and only the range of
weights (and, for the text font, sizes) the stylesheets ask for. The pages
load these; the Torrens Serif page also loads the complete font for its
tester and specimen (the "Torrens Serif Complete" family in fonts.css).

    pip install "fonttools[woff]"
    python3 scripts/trim-fonts.py

Run it again after changing a font in full/, after using a weight outside
400 to 700, or after writing in a character outside the list below (a
character the trimmed fonts lack shows in the fallback font, not as a box).
"""

from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

FONTS = Path(__file__).resolve().parent.parent / "src" / "assets" / "fonts"
LATIN = (
    "U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+02C6,U+02DA,U+02DC,U+2010-2015,U+2018-201E,"
    "U+2020-2022,U+2026,U+2030,U+2039-203A,U+2044,U+20AC,U+2122,U+2190-2193,U+2212,U+2215"
)
WEIGHTS = (400, 700)
# The text font adjusts its shapes to the size it is set at; nothing on the
# site sets it larger than the specimen's 72.
SIZES = (9, 72)

KEEP = {
    "torrens-serif.woff2": {"wght": WEIGHTS},
    "torrens-serif-italic.woff2": {"wght": WEIGHTS},
    "fraunces-soft.woff2": {"wght": WEIGHTS, "opsz": SIZES},
    "fraunces-soft-italic.woff2": {"wght": WEIGHTS, "opsz": SIZES},
    "drafting-mono.woff2": {"wght": WEIGHTS},
}

for name, ranges in KEEP.items():
    source = FONTS / "full" / name
    font = instancer.instantiateVariableFont(TTFont(source), ranges)
    # Narrowing an axis can leave glyphs without an entry in the variations
    # table, which the subsetter then trips over.
    for glyph in font.getGlyphOrder():
        font["gvar"].variations.setdefault(glyph, [])

    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.name_IDs = ["*"]
    options.notdef_outline = True
    options.hinting = False
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=subset.parse_unicodes(LATIN))
    subsetter.subset(font)

    font.flavor = "woff2"
    font.save(FONTS / name)
    print(f"{name}: {source.stat().st_size // 1024} KB -> {(FONTS / name).stat().st_size // 1024} KB")
