import fs from 'node:fs';
import { resolveArticle } from './resolve.mjs';
const AV = JSON.parse(fs.readFileSync(new URL('./availability_map.json', import.meta.url)));
const recs = Object.values(AV);
const N = parseInt(process.argv[2]||'400',10);
// stratified by URL-candidate tier
const groups={}; for(const r of recs){(groups[r.best_tier]||=[]).push(r);}
let sample=[];
for(const [t,arr] of Object.entries(groups)){const step=Math.max(1,Math.floor(arr.length/(N/4))); for(let i=0;i<arr.length && sample.length<N;i+=step) sample.push(arr[i]);}
const res={}; const downgrades=[];
for(const r of sample){
  const x=resolveArticle(r);
  const key=r.best_tier+' => '+x.tier;
  res[key]=(res[key]||0)+1;
  if(x.tier==='tier4-stub' && r.best_tier!=='none') downgrades.push(r.slug+' ('+r.best_tier+')');
}
console.log('sample',sample.length);
for(const [k,v] of Object.entries(res).sort((a,b)=>b[1]-a[1])) console.log('  ',k,':',v);
console.log('\nstub-but-candidate-had-source (first 15):'); downgrades.slice(0,15).forEach(s=>console.log('  ',s));
console.log('total such:',downgrades.length);
