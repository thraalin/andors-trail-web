#!/usr/bin/env python3
"""Convert Andor's Trail Android resources into web-friendly bundles.

Outputs (in game/data):
  content.json        - all game data (items, monsters, quests, droplists, conditions, conversations,
                        map objects, worldmap, strings) in original load order
  layers/NN.json      - map layer data (base64 zlib tile layers) in chunks, loaded on demand
  img/*.png           - tileset / UI images
"""
import hashlib, json, os, re, shutil, sys, zlib, base64
import xml.etree.ElementTree as ET

# Usage: python3 tools/build_content.py <andors-trail checkout>/AndorsTrail/res [OUT_DIR]
if len(sys.argv) < 2:
    sys.exit('usage: build_content.py <path to AndorsTrail/res> [output data dir]')
SRC = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data')
CHUNK_BYTES = 300_000

def read_arrays():
    root = ET.parse(os.path.join(SRC, 'values/loadresources.xml')).getroot()
    arrays = {}
    for arr in root.findall('array'):
        name = arr.get('name').replace('loadresource_', '')
        arrays[name] = [it.text.strip().split('/', 1)[1] for it in arr.findall('item')]
    return arrays

def load_raw(name):
    with open(os.path.join(SRC, 'raw', name + '.json'), encoding='utf-8') as f:
        return json.load(f)

def android_unescape(s):
    if s is None:
        return ''
    s = s.strip()
    if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
        s = s[1:-1]
    out, i = [], 0
    while i < len(s):
        c = s[i]
        if c == '\\' and i + 1 < len(s):
            n = s[i + 1]
            out.append({'n': '\n', 't': '\t', "'": "'", '"': '"', '\\': '\\', '@': '@', '?': '?'}.get(n, n))
            i += 2
            continue
        out.append(c)
        i += 1
    return ''.join(out)

def inner_text(el):
    # strings may contain inline markup like <b>; flatten to text
    return ''.join(el.itertext())

def read_strings():
    root = ET.parse(os.path.join(SRC, 'values/strings.xml')).getroot()
    strings, plurals, arrays = {}, {}, {}
    for el in root:
        name = el.get('name')
        if el.tag == 'string':
            strings[name] = android_unescape(inner_text(el))
        elif el.tag == 'plurals':
            plurals[name] = {it.get('quantity'): android_unescape(inner_text(it)) for it in el.findall('item')}
        elif el.tag in ('string-array', 'array'):
            arrays[name] = [android_unescape(inner_text(it)) for it in el.findall('item')]
    aroot = ET.parse(os.path.join(SRC, 'values/arrays.xml')).getroot()
    for el in aroot:
        if el.tag in ('string-array', 'array', 'integer-array'):
            items = []
            for it in el.findall('item'):
                t = inner_text(it).strip()
                if t.startswith('@string/'):
                    t = strings.get(t[8:], t)
                else:
                    t = android_unescape(t)
                items.append(t)
            arrays[el.get('name')] = items
    return strings, plurals, arrays

def parse_props(el):
    props = []
    pe = el.find('properties')
    if pe is not None:
        for p in pe.findall('property'):
            v = p.get('value')
            if v is None:
                v = p.text or ''
            props.append([p.get('name'), v])
    return props

def parse_tmx(path):
    root = ET.parse(path).getroot()
    w, h = int(root.get('width')), int(root.get('height'))
    info = {'w': w, 'h': h, 'props': parse_props(root), 'groups': []}
    layerinfo = {'tilesets': [], 'layers': []}
    for child in root:
        if child.tag == 'tileset':
            layerinfo['tilesets'].append([int(child.get('firstgid', 1)), child.get('name')])
        elif child.tag == 'layer':
            data = child.find('data')
            comp = data.get('compression')
            raw = re.sub(r'\s', '', data.text or '')
            buf = base64.b64decode(raw)
            if comp == 'zlib':
                dec = zlib.decompress(buf)
            elif comp == 'gzip':
                dec = zlib.decompress(buf, 16 + zlib.MAX_WBITS)
            elif comp is None and data.get('encoding') == 'base64':
                dec = buf
            else:
                raise Exception('Unhandled layer encoding in ' + path)
            dec = dec[: w * h * 4]
            md5 = hashlib.md5(dec).hexdigest()
            # Re-encode as zlib so the browser always gets one format
            layerinfo['layers'].append([child.get('name'), base64.b64encode(zlib.compress(dec, 9)).decode('ascii'), md5])
        elif child.tag == 'objectgroup':
            g = {'name': child.get('name'), 'props': parse_props(child), 'objects': []}
            for o in child.findall('object'):
                def iv(k):
                    v = o.get(k)
                    return int(round(float(v))) if v is not None else -1
                g['objects'].append({
                    'name': o.get('name'), 'type': o.get('type') or o.get('class'),
                    'x': iv('x'), 'y': iv('y'), 'w': iv('width'), 'h': iv('height'),
                    'props': parse_props(o),
                })
            info['groups'].append(g)
    return info, layerinfo

def parse_worldmap():
    root = ET.parse(os.path.join(SRC, 'xml/worldmap.xml')).getroot()
    segs = []
    for s in root.findall('segment'):
        seg = {'id': s.get('id'), 'x': int(s.get('x', 0)), 'y': int(s.get('y', 0)), 'maps': [], 'areas': []}
        for m in s.findall('map'):
            seg['maps'].append([m.get('id'), int(m.get('x', -1)), int(m.get('y', -1)), m.get('area')])
        for a in s.findall('namedarea'):
            seg['areas'].append([a.get('id'), a.get('name'), a.get('type')])
        segs.append(seg)
    return segs

def main():
    os.makedirs(OUT, exist_ok=True)
    arrays = read_arrays()
    content = {}
    for key in ['itemcategories', 'actorconditions', 'items', 'itemfilters', 'droplists', 'quests', 'monsters']:
        content[key] = [load_raw(n) for n in arrays[key]]
    content['conversations'] = {n: load_raw(n) for n in arrays['conversationlists']}

    # maps
    maps = []
    layer_chunks, cur, cur_size = [], {}, 0
    map_chunk = {}
    used_tilesets = set()
    for name in arrays['maps']:
        info, linfo = parse_tmx(os.path.join(SRC, 'xml', name + '.tmx'))
        info['name'] = name
        maps.append(info)
        for _, ts in linfo['tilesets']:
            used_tilesets.add(ts)
        size = sum(len(l[1]) for l in linfo['layers']) + 200
        if cur and cur_size + size > CHUNK_BYTES:
            layer_chunks.append(cur)
            cur, cur_size = {}, 0
        cur[name] = linfo
        cur_size += size
        map_chunk[name] = len(layer_chunks)
    if cur:
        layer_chunks.append(cur)
    content['maps'] = maps
    content['mapChunk'] = map_chunk
    content['worldmap'] = parse_worldmap()
    strings, plurals, sarrays = read_strings()
    content['strings'] = strings
    content['plurals'] = plurals
    content['arrays'] = sarrays

    with open(os.path.join(OUT, 'content.json'), 'w', encoding='utf-8') as f:
        json.dump(content, f, ensure_ascii=False, separators=(',', ':'))
    ldir = os.path.join(OUT, 'layers')
    if os.path.isdir(ldir):
        shutil.rmtree(ldir)
    os.makedirs(ldir)
    for i, ch in enumerate(layer_chunks):
        with open(os.path.join(ldir, '%02d.json' % i), 'w') as f:
            json.dump(ch, f, separators=(',', ':'))

    # images: every png in drawable (no density variants needed for tilesets)
    idir = os.path.join(OUT, 'img')
    os.makedirs(idir, exist_ok=True)
    n = 0
    for fn in os.listdir(os.path.join(SRC, 'drawable')):
        if fn.endswith('.png'):
            shutil.copy2(os.path.join(SRC, 'drawable', fn), os.path.join(idir, fn))
            n += 1
    print('maps', len(maps), 'chunks', len(layer_chunks), 'images', n)
    print('content.json', os.path.getsize(os.path.join(OUT, 'content.json')))

if __name__ == '__main__':
    main()
