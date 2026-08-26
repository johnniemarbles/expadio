const fs = require('fs');
const path = require('path');
const p = path.resolve('apps/platform-web/lib/live-adapter.ts');
let c = fs.readFileSync(p, 'utf8');
c = c.replace(/kind: 'live'/g, "kind: 'live' as const");
fs.writeFileSync(p, c);
