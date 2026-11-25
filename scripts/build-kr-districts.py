# /// script
# dependencies = ["pyarrow==26.0.1", "shapely==2.2.0"]
# ///
"""uv run scripts/build-kr-districts.py [local-copy.parquet]"""
import hashlib, json, sys, urllib.request
from collections import defaultdict
from pathlib import Path
import pyarrow as pa
import pyarrow.parquet as pq
from shapely import from_wkb, orient_polygons, set_precision, union_all, line_merge

rev = '078ef4ac13b8bfeb215d2eabace49f4fdea71d5e'
url = f'https://raw.githubusercontent.com/vuski/admdongkor/{rev}/parquet/simplified/sgg_20261001_light.parquet'
raw = Path(sys.argv[1]).read_bytes() if len(sys.argv) > 1 else urllib.request.urlopen(url).read()
assert hashlib.sha256(raw).hexdigest() == 'c0ee6f1cb5868163e5a6456d47fc5a1412c75c475a18f05c52ea165a290fde9a'
table = pq.read_table(pa.BufferReader(raw))
assert json.loads(table.schema.metadata[b'geo'])['columns']['geometry']['crs']['id']['code'] == 4326
out = Path(__file__).resolve().parents[1] / 'src/data'
def save(name, value):
    (out / name).write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':'))+'\n')
def pack(coords):
    prev = (0,0)
    deltas = []
    for lon, lat, *_ in coords:
        pt = round(lon*100000), round(lat*100000)
        if pt != prev:
            deltas.extend([pt[0]-prev[0],pt[1]-prev[1]])
            prev = pt
    return deltas
def parts(g): return g.geoms if g.geom_type.startswith('Multi') else [g]
def polygons(g):
    return [[pack(list(r.coords)[:-1]) for r in [p.exterior,*p.interiors]] for p in parts(orient_polygons(g, exterior_cw=True))]
def lines(g): return [pack(l.coords) for l in parts(line_merge(g))]

rows, by_province, names = [], defaultdict(list), {}
for row in sorted(table.to_pylist(), key=lambda x:x['sggcd']):
    geom = set_precision(from_wkb(row['geometry']),1e-5)
    sid = row['sidocd']; by_province[sid].append(geom); names[sid]=row['sidonm']
    rows.append([row['sggcd'],names[sid],row['sggnm'],polygons(geom)])
assert len(rows) == len(set(r[0] for r in rows)) == 256
provinces = {sid:union_all(gs) for sid,gs in by_province.items()}
land = union_all(list(provinces.values()))
province_edges = union_all([g.boundary for g in provinces.values()])
district_edges = union_all([g.boundary for gs in by_province.values() for g in gs])
save('kr-district-names.json',[r[:3] for r in rows]); save('kr-districts.json',rows)
save('kr-sido.json',[[sid,names[sid],polygons(g)] for sid,g in provinces.items()])
save('kr-sido-lines.json',lines(province_edges.difference(land.boundary)))
save('kr-sgg-lines.json',lines(district_edges.difference(province_edges)))
