import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCustomGisInput as parse} from '../dist/plugin.js';

const xy=[953901.1653121515,1952032.0809790879]; // EPSG:5179; independent PROJ reference
const ll=[126.978,37.5665];
const crs={type:'name',properties:{name:'urn:ogc:def:crs:EPSG::5179'}};
function check(pt){assert.ok(Math.abs(pt[0]-ll[0])<1e-7 && Math.abs(pt[1]-ll[1])<1e-7);}
test('5179 GeoJSON/CSV and quantized TopoJSON converge on WGS84 lon/lat',()=>{
  const geo=parse(JSON.stringify({type:'MultiLineString',coordinates:[[xy,xy]],crs}));
  check(geo.geojson.features[0].geometry.coordinates[0][0]);
  assert.ok(!('crs' in geo.geojson.features[0].geometry));
  check(parse('name,x,y\n서울,'+xy.join(','),'EPSG:5179').geojson.features[0].geometry.coordinates);
  const topo={type:'Topology',transform:{scale:[1,1],translate:xy},objects:{test:{type:'Point',coordinates:[0,0]}},arcs:[],crs};
  check(parse(JSON.stringify(topo)).geojson.features[0].geometry.coordinates);
  assert.deepEqual(parse(JSON.stringify({type:'Point',coordinates:ll})).geojson.features[0].geometry.coordinates,ll);
});
test('unsupported, contradictory, and undeclared metre coordinates are not saved as degrees',()=>{
  const g={type:'Point',coordinates:xy,crs};
  assert.equal(parse(JSON.stringify(g),'EPSG:4326').ok,false);
  assert.equal(parse(JSON.stringify({...g,crs:{type:'name',properties:{name:'EPSG:3857'}}})).ok,false);
  assert.equal(parse('name,x,y\n서울,'+xy.join(',')).ok,false);
  assert.equal(parse('name,lon,lat\n서울,,37.56').ok,false);
});
