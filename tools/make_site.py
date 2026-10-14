#!/usr/bin/env python3
"""Assemble the deployable static website for the web version of Andor's Trail.

Usage:  python3 tools/make_site.py [OUT_DIR] [FONTS_DIR]

Takes the working game folder (index.html, js/, data/) and writes a self-contained
static site to OUT_DIR (default: ./site):
  * index.html as a complete HTML document (doctype, head, manifest, icons)
  * js/ and data/ (only the images the game actually references)
  * self-hosted Alegreya fonts (subset to Latin, WOFF) instead of Google Fonts
  * web app manifest + home-screen icons
  * LICENSE (GPL v2), README.md, CREDITS.md, and the build tools (tools/)

FONTS_DIR should contain the Google Fonts "ofl" folders alegreyasc/ and alegreyasans/
(from https://github.com/google/fonts). If it is missing, the site falls back to the
Google Fonts stylesheet.
"""
import json, os, re, shutil, sys
from io import BytesIO

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'site'))
FONTS = sys.argv[2] if len(sys.argv) > 2 else None
SRC_REPO = '/home/claude/src/andors-trail'  # used only for CREDITS.md if present

VERSION = '0.8.18'
THEME = '#14181b'


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def write(p, s):
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w', encoding='utf-8') as f:
        f.write(s)


def referenced_images():
    """Every data/img/<name>.png the game can request: tilesets + literal paths in HTML/JS."""
    names = set()
    srcs = [read(os.path.join(ROOT, 'index.html'))]
    for r, _, fs in os.walk(os.path.join(ROOT, 'js')):
        srcs += [read(os.path.join(r, f)) for f in fs if f.endswith('.js')]
    for s in srcs:
        # tileset names, literal data/img paths and names used in templates are all quoted identifiers
        names.update(re.findall(r"data/img/([A-Za-z0-9_]+)\.png", s))
        names.update(re.findall(r"[\"']([A-Za-z0-9_]+)[\"']", s))
    have = {f[:-4] for f in os.listdir(os.path.join(ROOT, 'data/img')) if f.endswith('.png')}
    missing = []
    return sorted(n for n in names if n in have), missing


def make_fonts(dst):
    """Subset the Alegreya faces to Latin and save as WOFF. Returns @font-face CSS or None."""
    if not FONTS or not os.path.isdir(FONTS):
        return None
    from fontTools import subset
    from fontTools.ttLib import TTFont
    faces = [
        ('Alegreya SC', 500, 'alegreyasc/AlegreyaSC-Medium.ttf'),
        ('Alegreya SC', 700, 'alegreyasc/AlegreyaSC-Bold.ttf'),
        ('Alegreya Sans', 400, 'alegreyasans/AlegreyaSans-Regular.ttf'),
        ('Alegreya Sans', 500, 'alegreyasans/AlegreyaSans-Medium.ttf'),
        ('Alegreya Sans', 700, 'alegreyasans/AlegreyaSans-Bold.ttf'),
    ]
    unicodes = list(range(0x20, 0x7F)) + list(range(0xA0, 0x180)) + list(range(0x2010, 0x2028)) + \
        list(range(0x2030, 0x205F)) + [0x20AC, 0x2122, 0x2212]
    css = []
    os.makedirs(dst, exist_ok=True)
    for fam, weight, rel in faces:
        font = TTFont(os.path.join(FONTS, rel))
        opts = subset.Options()
        opts.flavor = 'woff'
        opts.layout_features = ['kern', 'liga', 'smcp', 'c2sc', 'lnum', 'tnum', 'pnum']
        sub = subset.Subsetter(opts)
        sub.populate(unicodes=unicodes)
        sub.subset(font)
        name = os.path.basename(rel).replace('.ttf', '.woff')
        font.flavor = 'woff'
        font.save(os.path.join(dst, name))
        css.append(f"@font-face {{ font-family: '{fam}'; font-weight: {weight}; font-style: normal; font-display: swap; src: url('fonts/{name}') format('woff'); }}")
    shutil.copy(os.path.join(FONTS, 'alegreyasans/OFL.txt'), os.path.join(dst, 'OFL.txt'))
    return '\n'.join(css)


def make_icons(dst):
    from PIL import Image
    hero = Image.open(os.path.join(ROOT, 'data/img/char_hero_large.png')).convert('RGBA')
    bbox = hero.getbbox()
    if bbox:
        hero = hero.crop(bbox)
    def icon(size, pad):
        bg = Image.new('RGBA', (size, size), THEME)
        inner = int(size * (1 - 2 * pad))
        scale = max(1, inner // max(hero.width, hero.height))
        h = hero.resize((hero.width * scale, hero.height * scale), Image.NEAREST)
        bg.alpha_composite(h, ((size - h.width) // 2, (size - h.height) // 2))
        return bg.convert('RGB')
    os.makedirs(dst, exist_ok=True)
    icon(180, 0.12).save(os.path.join(dst, 'apple-touch-icon.png'), optimize=True)
    icon(192, 0.12).save(os.path.join(dst, 'icon-192.png'), optimize=True)
    icon(512, 0.12).save(os.path.join(dst, 'icon-512.png'), optimize=True)
    icon(512, 0.22).save(os.path.join(dst, 'icon-maskable-512.png'), optimize=True)
    icon(32, 0.0).save(os.path.join(dst, 'favicon-32.png'), optimize=True)


def build_index(font_css):
    src = read(os.path.join(ROOT, 'index.html'))
    i = src.index('</style>') + len('</style>')
    head, body = src[:i], src[i:]
    # drop tags the full document re-declares
    head = re.sub(r'<meta charset="utf-8">\s*', '', head)
    head = re.sub(r'<link rel="apple-touch-icon"[^>]*>\s*', '', head)
    if font_css:
        head = re.sub(r'<link rel="preconnect"[^>]*>\s*', '', head)
        head = re.sub(r'<link rel="stylesheet" href="https://fonts.googleapis.com[^>]*>\s*', '', head)
        head = head.replace('<style>\n', '<style>\n' + font_css + '\n', 1)
    extra = (
        '<meta name="description" content="Andor\'s Trail, the open-source fantasy RPG, playable in your browser. '
        'Add it to your home screen to play full screen on iPhone and Android.">\n'
        '<link rel="manifest" href="manifest.webmanifest">\n'
        '<link rel="icon" type="image/png" sizes="32x32" href="icons/favicon-32.png">\n'
        '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">\n'
    )
    return ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' + head.strip() + '\n' + extra +
            '</head>\n<body>\n' + body.strip() + '\n</body>\n</html>\n')


def main():
    if os.path.exists(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    font_css = make_fonts(os.path.join(OUT, 'fonts'))
    write(os.path.join(OUT, 'index.html'), build_index(font_css))
    shutil.copytree(os.path.join(ROOT, 'js'), os.path.join(OUT, 'js'))
    os.makedirs(os.path.join(OUT, 'data/img'))
    shutil.copy(os.path.join(ROOT, 'data/content.json'), os.path.join(OUT, 'data/content.json'))
    shutil.copytree(os.path.join(ROOT, 'data/layers'), os.path.join(OUT, 'data/layers'))
    imgs, missing = referenced_images()
    for n in imgs:
        shutil.copy(os.path.join(ROOT, 'data/img', n + '.png'), os.path.join(OUT, 'data/img', n + '.png'))
    make_icons(os.path.join(OUT, 'icons'))
    manifest = {
        'name': "Andor's Trail", 'short_name': "Andor's Trail",
        'description': 'Open-source fantasy RPG. Find your brother Andor.',
        'start_url': './', 'scope': './', 'display': 'standalone', 'orientation': 'portrait',
        'background_color': THEME, 'theme_color': THEME,
        'icons': [
            {'src': 'icons/icon-192.png', 'sizes': '192x192', 'type': 'image/png'},
            {'src': 'icons/icon-512.png', 'sizes': '512x512', 'type': 'image/png'},
            {'src': 'icons/icon-maskable-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'maskable'},
        ],
    }
    write(os.path.join(OUT, 'manifest.webmanifest'), json.dumps(manifest, indent=2) + '\n')
    shutil.copytree(os.path.join(ROOT, 'tools'), os.path.join(OUT, 'tools'),
                    ignore=shutil.ignore_patterns('__pycache__'))
    for extra in ('README.md', 'LICENSE', 'CREDITS.md'):
        p = os.path.join(ROOT, 'site_extras', extra)
        if os.path.exists(p):
            shutil.copy(p, os.path.join(OUT, extra))
    print(f'site written to {OUT}: {len(imgs)} images' + (f'; referenced but missing: {missing}' if missing else ''))
    print('fonts:', 'self-hosted' if font_css else 'Google Fonts link')


if __name__ == '__main__':
    main()
