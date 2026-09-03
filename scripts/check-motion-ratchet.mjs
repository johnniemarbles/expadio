import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const baseRef=process.env.MOTION_RATCHET_BASE_REF;
if(!baseRef){console.error('MOTION_RATCHET_BASE_REF is required');process.exit(2)}
const base=execFileSync('git',['merge-base','HEAD',`origin/${baseRef}`],{encoding:'utf8'}).trim();
const files=execFileSync('git',['diff','--name-only',base,'HEAD','--','apps','verticals','packages/ui/src'],{encoding:'utf8'}).split('\n').filter((file)=>file.endsWith('.css'));
function findViolations(source){
  const found=[];
  for(const match of source.matchAll(/\b(?:animation|transition)(?:-[a-z-]+)?\s*:\s*([^;]+);/gi)){
    const value=match[1].replace(/\s+/g,' ').trim();
    if(/\b\d+(?:\.\d+)?m?s\b/i.test(value)&&!value.includes('var(--theme-motion'))found.push(`raw duration:${value}`);
    if(/\b(?:ease|ease-in|ease-out|ease-in-out|linear)\b/i.test(value)&&!value.includes('var(--theme-easing'))found.push(`raw easing:${value}`);
    if(/(?:^|,)\s*(?:width|height|top|left|right|bottom|margin|padding)\b/i.test(value))found.push(`layout property:${value}`);
  }
  return found;
}
const violations=[];
for(const file of files){
  if(file.endsWith('tokens/motion.css'))continue;
  const before=(()=>{try{return execFileSync('git',['show',`${base}:${file}`],{encoding:'utf8'})}catch{return ''}})();
  const after=(()=>{try{return readFileSync(file,'utf8')}catch{return ''}})();
  const baseline=new Map();
  for(const item of findViolations(before))baseline.set(item,(baseline.get(item)??0)+1);
  for(const item of findViolations(after)){
    const count=baseline.get(item)??0;
    if(count>0)baseline.set(item,count-1);else violations.push({file,reason:item});
  }
}
if(violations.length){console.error('New motion must use governed tokens and composited properties.');for(const v of violations)console.error(`- ${v.file}: ${v.reason}`);process.exit(1)}
console.log(`Motion ratchet: new application motion is governed (merge base ${base}).`);
