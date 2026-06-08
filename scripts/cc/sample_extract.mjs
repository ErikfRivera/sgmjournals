import fs from 'node:fs';
import path from 'node:path';
import { extractArticle } from '../lib/extract.mjs';
import { isOldFormat } from '../lib/oldformat.mjs';
const AV = JSON.parse(fs.readFileSync(new URL('./availability_map.json', import.meta.url)));
const ARCH = path.resolve('..','NWK0G2ISWAUU0C6K','sgmjournals.org','.content.DFgjfXp1');
const recs = Object.values(AV).filter(r=>r.best_tier==='tier1-full' && r.html_file);
// deterministic spread sample across journals
const byJ={}; for(const r of recs){(byJ[r.journal]||=[]).push(r);}
const N=parseInt(process.argv[2]||'40',10);
let sample=[];
for(const j of Object.keys(byJ)){const a=byJ[j]; for(let i=0;i<a.length;i+=Math.max(1,Math.floor(a.length/Math.ceil(N/Object.keys(byJ).length)))){sample.push(a[i]); if(sample.length>=N)break;} if(sample.length>=N)break;}
let okBody=0, okAbs=0, empty=0, oldN=0, newN=0; const fails=[];
for(const r of sample){
  const f=path.join(ARCH, r.html_file);
  if(!fs.existsSync(f)){fails.push([r.slug,'missing-file']);continue;}
  const html=fs.readFileSync(f,'latin1');
  const old=isOldFormat(html); old?oldN++:newN++;
  let ex; try{ex=extractArticle(html,{host:r.journal+'.sgmjournals.org',requestUri:r.html_uri,journal:r.journal});}catch(e){fails.push([r.slug,'err:'+e.message]);continue;}
  const bt=(ex.bodyHtml||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().length;
  const at=(ex.abstractHtml||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().length;
  if(bt>400)okBody++; else if(at>100){okAbs++;} else {empty++; fails.push([r.slug,(old?'OLD':'NEW')+` body=${bt} abs=${at}`]);}
}
console.log(`sample=${sample.length} old=${oldN} new=${newN}`);
console.log(`body-ok(>400)=${okBody}  abstract-only=${okAbs}  EMPTY=${empty}`);
console.log('failures:'); fails.slice(0,25).forEach(x=>console.log('  ',x[0],'|',x[1]));
