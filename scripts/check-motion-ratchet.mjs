import { execFileSync } from 'node:child_process';
const baseRef=process.env.MOTION_RATCHET_BASE_REF;
if(!baseRef){console.error('MOTION_RATCHET_BASE_REF is required');process.exit(2)}
const base=execFileSync('git',['merge-base','HEAD',`origin/${baseRef}`],{encoding:'utf8'}).trim();
const diff=execFileSync('git',['diff','--unified=0',base,'HEAD','--','apps','verticals','packages/ui/src'],{encoding:'utf8'});
const violations=[];let file='';
const rawDuration=/(?:animation|transition)(?:-[a-z-]+)?\s*:[^;]*\b(?:\d+(?:\.\d+)?m?s)\b/i;
const rawEasing=/(?:animation|transition)(?:-[a-z-]+)?\s*:[^;]*\b(?:ease|ease-in|ease-out|ease-in-out|linear)\b/i;
const layoutAnimation=/(?:animation|transition)(?:-[a-z-]+)?\s*:[^;]*\b(?:width|height|top|left|right|bottom|margin|padding)\b/i;
for(const line of diff.split('\n')){
  if(line.startsWith('+++ b/')){file=line.slice(6);continue}
  if(!line.startsWith('+')||line.startsWith('+++')||!file.endsWith('.css'))continue;
  const source=line.slice(1);
  if(file.endsWith('tokens/motion.css'))continue;
  if(rawDuration.test(source)&&!source.includes('var(--theme-motion'))violations.push({file,reason:'raw duration',source:source.trim()});
  if(rawEasing.test(source)&&!source.includes('var(--theme-easing'))violations.push({file,reason:'raw easing',source:source.trim()});
  if(layoutAnimation.test(source)&&!source.includes('MotionProgress'))violations.push({file,reason:'layout property animation',source:source.trim()});
}
if(violations.length){console.error('New motion must use governed tokens and composited properties.');for(const v of violations)console.error(`- ${v.file} (${v.reason}): ${v.source}`);process.exit(1)}
console.log(`Motion ratchet: new application motion is governed (merge base ${base}).`);
