import { execFileSync } from 'node:child_process';

const base=process.env.THEME_RATCHET_BASE_SHA;
if(!base){
  console.error('THEME_RATCHET_BASE_SHA is required');
  process.exit(2);
}

const diff=execFileSync('git',['diff','--unified=0',base,'HEAD','--','apps','packages'],{encoding:'utf8'});
const allowed=[
  /^packages\/ui\/src\/tokens\//,
  /^packages\/ui\/src\/theme\.ts$/,
  /^packages\/ui\/src\/governed-theme\.ts$/,
];

const rawColor=/(#[0-9a-f]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(|\b(?:white|black)\b)/i;
let file='';
const violations=[];

for(const line of diff.split('\n')){
  if(line.startsWith('+++ b/')){
    file=line.slice(6);
    continue;
  }
  if(!line.startsWith('+')||line.startsWith('+++'))continue;
  if(!file||allowed.some((pattern)=>pattern.test(file)))continue;
  if(!/\.(?:css|scss|tsx?|jsx?)$/i.test(file))continue;
  const source=line.slice(1);
  if(rawColor.test(source)){
    violations.push({file,source:source.trim()});
  }
}

if(violations.length){
  console.error('New raw application palette values are not allowed. Use semantic --theme-* tokens or canonical theme-definition files.');
  for(const violation of violations){
    console.error(`- ${violation.file}: ${violation.source}`);
  }
  process.exit(1);
}

console.log('Theme token ratchet: no new raw application palette values.');
