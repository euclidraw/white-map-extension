// OpenMapTiles XYZ/MVT. Work in integer tile space until clipping and dissolving
// buffered water polygons: tile borders must never become printed coastlines.
import {VectorTile} from '@mapbox/vector-tile';
import Pbf from 'pbf';
import pc from 'polygon-clipping';
import {geoArea} from 'd3-geo';

const TILEJSON = 'https://tiles.openfreemap.org/planet';
const limit = 85.05112878;
const extent = 4096;
const yOf = (lat,n) => n*(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2;
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const box = (x,y,X,Y)=>[[[x,y],[X,y],[X,Y],[x,Y],[x,y]]];
const fc = geometries=>({type:'FeatureCollection',features:geometries.map(geometry=>({type:'Feature',properties:{},geometry}))});

export function tilePlan(bbox,scale) {
  let [west,south,east,north]=bbox;
  if (![...bbox,scale].every(Number.isFinite) || north<=south || south < -limit || north > limit) return null;
  if (east<west) east+=360;
  if(east<=west || east-west>=180) return null;
  let z=clamp(Math.round(Math.log2(scale*2*Math.PI/256)),1,14);
  for (;z>=0;z--) {
    const n=2**z, x0=Math.floor((west+180)*n/360), x1=Math.max(x0,Math.ceil((east+180)*n/360)-1);
    const y0=clamp(Math.floor(yOf(north,n)),0,n-1), y1=clamp(Math.ceil(yOf(south,n))-1,y0,n-1);
    if ((x1-x0+1)*(y1-y0+1)>16) continue;
    const tiles=[];
    for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++) tiles.push({z,x:((x%n)+n)%n,y,unwrapped:x});
    const cx=(west+east+360)*n/720,cy=yOf((south+north)/2,n);
    tiles.sort((a,b)=>Math.hypot(a.unwrapped+.5-cx,a.y+.5-cy)-Math.hypot(b.unwrapped+.5-cx,b.y+.5-cy));
    return {tiles,z,n,x0,x1,y0,y1,key:[z,x0,x1,y0,y1].join('/')};
  }
}

// Cache encoded tiles, not all decoded OSM layers. Bound both count and bytes.
const cache=new Map(), inflight=new Map();
let byteCount=0, atlasUrl=null, epoch=0;
const controllers=new Set();
export function clearVectorTiles(){epoch++; for(const c of controllers)c.abort();controllers.clear();cache.clear();inflight.clear();byteCount=0;atlasUrl=null;}
async function request(url,fetcher,fn){
  const c=new AbortController();controllers.add(c);
  try{const res=await fetcher(url,{signal:c.signal,cache:'no-store',credentials:'omit'});if(!res.ok)throw Error(`타일 요청 실패 (${res.status})`);return await fn(res);}finally{controllers.delete(c);}
}
function template(fetcher){
  if(!atlasUrl){const p=request(TILEJSON,fetcher,async r=>{
    const u=(await r.json()).tiles?.[0];
    if(typeof u!=='string'||!/^https:\/\/tiles\.openfreemap\.org\/planet\/[\w-]+\/\{z\}\/\{x\}\/\{y\}\.pbf$/.test(u))throw Error('지원하지 않는 벡터 타일 주소');
    return u;
  });atlasUrl=p;p.catch(()=>{if(atlasUrl===p)atlasUrl=null;});}
  return atlasUrl;
}
async function bytesFor(t,fetcher){
  const key=`${t.z}/${t.x}/${t.y}`,hit=cache.get(key);
  if(hit){cache.delete(key);cache.set(key,hit);return hit;}
  if(inflight.has(key))return inflight.get(key);
  const gen=epoch;
  const job=(async()=>{const u=(await template(fetcher)).replace('{z}/{x}/{y}',key);
    if(gen!==epoch)throw Error('타일 요청 취소');
    const bytes=await request(u,fetcher,async r=>new Uint8Array(await r.arrayBuffer()));
    if(gen!==epoch || bytes.length>2*1024*1024)throw Error('타일 크기 또는 요청 범위를 확인하세요.');
    cache.set(key,bytes);byteCount+=bytes.length;
    while(cache.size>64||byteCount>8*1024*1024){const oldest=cache.keys().next().value;byteCount-=cache.get(oldest).length;cache.delete(oldest);}
    return bytes;
  })();inflight.set(key,job);
  try{return await job;}finally{if(inflight.get(key)===job)inflight.delete(key);}
}

// Liang–Barsky trim: remove the provider's MVT buffer before joining linework.
function clipLine(points,x,y,X,Y){const out=[];let line=[];
  for(let i=1;i<points.length;i++){const [a,b]=points[i-1],[c,d]=points[i],dx=c-a,dy=d-b;let lo=0,hi=1;
    for(const [p,q] of [[-dx,a-x],[dx,X-a],[-dy,b-y],[dy,Y-b]]){if(!p){if(q<0)hi=-1;}else if(p<0)lo=Math.max(lo,q/p);else hi=Math.min(hi,q/p);}
    if(lo>=hi){if(line.length)out.push(line);line=[];continue;}
    const s=[a+lo*dx,b+lo*dy],e=[a+hi*dx,b+hi*dy];if(!line.length)line.push(s);line.push(e);
    if(hi<1){out.push(line);line=[];}
  }if(line.length)out.push(line);return out;
}
function signed(r){let a=0;for(let i=1;i<r.length;i++)a+=r[i-1][0]*r[i][1]-r[i][0]*r[i-1][1];return a;}
export function decodeViewport(plan, payloads){
  const oceans=[],lakes=[],riverAreas=[],rivers=[];
  for(let i=0;i<plan.tiles.length;i++){
    const t=plan.tiles[i],vt=new VectorTile(new Pbf(payloads[i])),x=t.unwrapped*extent,y=t.y*extent;
    const tileBox=box(x,y,x+extent,y+extent);
    for(const name of ['water','waterway']){const layer=vt.layers[name];if(!layer)continue;
      for(let k=0;k<layer.length;k++){const f=layer.feature(k);if(f.type!==(name==='water'?3:2))continue;
        const rings=f.loadGeometry().map(r=>r.map(pt=>[x+pt.x*extent/f.extent,y+pt.y*extent/f.extent]));
        if(name==='waterway'){for(const l of rings)rivers.push(...clipLine(l,x,y,x+extent,y+extent));continue;}
        const polygons=[];for(const ring of rings){if(signed(ring)>0)polygons.push([ring]);else polygons.at(-1)?.push(ring);}
        // OpenMapTiles water includes flowing-water polygons as well as standing water.
        const cls=f.properties.class;
        const group=cls==='ocean'?oceans:cls==='river'?riverAreas:['lake','pond','reservoir'].includes(cls)?lakes:null;
        if(group && polygons.length) group.push(...pc.intersection(polygons,tileBox));
      }
    }
  }
  const ll=([x,y])=>[360*x/(extent*plan.n)-180,180/Math.PI*Math.atan(Math.sinh(Math.PI*(1-2*y/(extent*plan.n))))];
  const union=polys=>polys.length?pc.union(...polys):[];
  const ocean=union(oceans), freshwater=union(lakes);
  const x=plan.x0*extent,y=plan.y0*extent,X=(plan.x1+1)*extent,Y=(plan.y1+1)*extent;
  const polygons=polys=>fc(polys.map(p=>{const g={type:'Polygon',coordinates:p.map(r=>r.map(ll))};if(geoArea(g)>2*Math.PI)g.coordinates.forEach(r=>r.reverse());return g;}));
  function edges(polys){const lines=[];for(const p of polys)for(const r of p){let run=[];for(let i=1;i<r.length;i++){const a=r[i-1],b=r[i];if((a[0]===b[0]&&(a[0]===x||a[0]===X))||(a[1]===b[1]&&(a[1]===y||a[1]===Y))){if(run.length)lines.push(run);run=[];continue;}if(!run.length)run.push(ll(a));run.push(ll(b));}if(run.length)lines.push(run);}return {type:'MultiLineString',coordinates:lines};}
  return {zoom:plan.z,land:polygons(pc.difference(box(x,y,X,Y),ocean)),coast:edges(ocean),riverAreas:polygons(union(riverAreas)),lakes:polygons(freshwater),lakeEdges:edges(freshwater),rivers:{type:'MultiLineString',coordinates:rivers.map(l=>l.map(ll))},featureCount:oceans.length+lakes.length+riverAreas.length+rivers.length};
}
export async function fetchViewport(plan,fetcher=globalThis.fetch,signal){
  if(!plan)throw Error('이 범위에서는 기본 지도를 사용합니다.');
  let index=0;const bytes=new Array(plan.tiles.length);
  await Promise.all(Array.from({length:Math.min(4,bytes.length)},async()=>{while(index<bytes.length){signal?.throwIfAborted();const i=index++;bytes[i]=await bytesFor(plan.tiles[i],fetcher);}}));
  signal?.throwIfAborted();return decodeViewport(plan,bytes);
}
