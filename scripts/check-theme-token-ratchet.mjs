import { execFileSync } from 'node:child_process';

const baseRef=process.env.THEME_RATCHET_BASE_REF;
if(!baseRef){
  console.error('THEME_RATCHET_BASE_REF is required');
  process.exit(2);
}

const base=execFileSync('git',['merge-base','HEAD',`origin/${baseRef}`],{encoding:'utf8'}).trim();
const diff=execFileSync(
  'git',
  ['diff','--unified=0',base,'HEAD','--','apps','verticals','packages/ui/src/components'],
  {encoding:'utf8'},
);

const rawColor=/(#[0-9a-f]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(|(?:^|[:;,\s(])(?:white|black)(?=[;,\s)]))/i;
let file='';
const violations=[];

for(const line of diff.split('\n')){
  if(line.startsWith('+++ b/')){
    file=line.slice(6);
    continue;
  }
  if(!line.startsWith('+')||line.startsWith('+++'))continue;
  if(!file||!/\.(?:css|scss|tsx?|jsx?)$/i.test(file))continue;
  const source=line.slice(1);
  const normalized=source.replace(/\bwhite-space\b/gi,'');
  if(rawColor.test(normalized)){
    violations.push({file,source:source.trim()});
  }
}

if(violations.length){
  console.error('New raw application palette values are not allowed. Use semantic --theme-* tokens.');
  for(const violation of violations){
    console.error(`- ${violation.file}: ${violation.source}`);
  }
  process.exit(1);
}

console.log(`Theme token ratchet: no new raw application palette values (merge base ${base}).`);
