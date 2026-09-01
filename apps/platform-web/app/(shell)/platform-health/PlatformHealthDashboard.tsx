"use client";

import { type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./telemetry.module.css";

type HealthStatus = "WATCH" | "DEGRADED" | "CRITICAL";
interface HealthEntry { readonly tenantId:string; readonly healthKey:string; readonly healthStatus:HealthStatus; readonly itemCount:number; readonly oldestAt:string|null; readonly newestAt:string|null; readonly metadata:Readonly<Record<string,unknown>>; }
interface HealthDomain { readonly key:string; readonly label:string; readonly endpoint:string; readonly detailPath:string; readonly x:number; readonly y:number; }
interface LoadedDomain extends HealthDomain { readonly entries:HealthEntry[]; readonly error?:string; }
interface HealthApiResponse { readonly entries?:HealthEntry[]; }
interface TelemetryLog { readonly id:string; readonly domain:string; readonly status:HealthStatus; readonly count:number; readonly key:string; readonly at:string|null; }
export interface PlatformHealthDashboardProps { readonly queryString?:string; }

const POLL_INTERVAL_MS = 30_000;
const DOMAINS:readonly HealthDomain[] = [
  { key:"execution", label:"Execution", endpoint:"/api/execution/health", detailPath:"/execution-trace", x:155, y:118 },
  { key:"communications", label:"Communications", endpoint:"/api/communications/health", detailPath:"/communications?tab=deliverability", x:445, y:118 },
  { key:"scheduler", label:"Scheduler", endpoint:"/api/scheduler/health", detailPath:"/platform-health#scheduler", x:155, y:338 },
  { key:"outbox", label:"Outbox", endpoint:"/api/outbox/health", detailPath:"/platform-health#outbox", x:445, y:338 },
] as const;

function appendQuery(path:string, queryString:string|undefined):string { if (!queryString) return path; const separator=path.includes("?")?"&":"?"; return `${path}${separator}${queryString.startsWith("?")?queryString.slice(1):queryString}`; }
function statusRank(status:HealthStatus|"NOMINAL"):number { return status==="CRITICAL"?3:status==="DEGRADED"?2:status==="WATCH"?1:0; }
function statusLabel(status:HealthStatus|"NOMINAL"):string { return status==="CRITICAL"?"Critical":status==="DEGRADED"?"Degraded":status==="WATCH"?"Watch":"Nominal"; }
function totalItems(entries:readonly HealthEntry[]):number { return entries.reduce((sum,entry)=>sum+Number(entry.itemCount||0),0); }
function worstStatus(entries:readonly HealthEntry[]):HealthStatus|"NOMINAL" { return entries.reduce<HealthStatus|"NOMINAL">((worst,entry)=>statusRank(entry.healthStatus)>statusRank(worst)?entry.healthStatus:worst,"NOMINAL"); }
function formatHealthKey(value:string):string { return value.replace(/^domain_event_/,"").replace(/_/g," ").replace(/\b\w/g,(char)=>char.toUpperCase()); }
function formatLogTime(value:string|null):string { if (!value) return "--:--:--"; const date=new Date(value); return Number.isNaN(date.getTime())?"--:--:--":date.toISOString().slice(11,19); }
function formatClock(value:Date):string { return new Intl.DateTimeFormat("en-GB",{timeZone:"UTC",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(value)+" UTC"; }
function healthScore(domain:LoadedDomain|undefined):number { if (!domain||domain.error) return 0; const status=worstStatus(domain.entries.filter((entry)=>entry.itemCount>0)); return status==="CRITICAL"?18:status==="DEGRADED"?48:status==="WATCH"?76:100; }
function gaugeColor(score:number):string { return score===0?"#71717a":score<30?"#fb7185":score<60?"#f59e0b":score<90?"#8b5cf6":"#06b6d4"; }
function nodeRingClass(status:HealthStatus|"NOMINAL"):string { return [styles.nodeRing,status==="CRITICAL"?styles.nodeRingCritical:status!=="NOMINAL"?styles.nodeRingWatch:""].join(" "); }
function nodeCoreClass(status:HealthStatus|"NOMINAL"):string { return [styles.nodeCore,status==="CRITICAL"?styles.nodeCoreCritical:status!=="NOMINAL"?styles.nodeCoreWatch:""].join(" "); }

async function loadDomain(domain:HealthDomain, queryString:string|undefined):Promise<LoadedDomain> {
  const response = await fetch(appendQuery(domain.endpoint, queryString), { cache: "no-store" });
  if (!response.ok) return {...domain,entries:[],error:`HTTP ${response.status}`};
  const body=await response.json() as HealthApiResponse;
  return {...domain,entries:Array.isArray(body.entries)?body.entries:[]};
}

function useCountUp(target:number):number {
  const [value,setValue]=useState(target); const previous=useRef(target);
  useEffect(()=>{ const from=previous.current; previous.current=target; if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setValue(target); return; }
    let frame=0; const start=performance.now(); const tick=(now:number)=>{ const progress=Math.min(1,(now-start)/700); setValue(Math.round(from+(target-from)*(1-Math.pow(1-progress,3)))); if (progress<1) frame=requestAnimationFrame(tick); };
    frame=requestAnimationFrame(tick); return ()=>cancelAnimationFrame(frame); },[target]);
  return value;
}

function SpotlightCard({className="",stagger,children}:{readonly className?:string;readonly stagger:number;readonly children:ReactNode}) {
  function track(event:ReactPointerEvent<HTMLElement>) { const rect=event.currentTarget.getBoundingClientRect(); event.currentTarget.style.setProperty("--spot-x",`${event.clientX-rect.left}px`); event.currentTarget.style.setProperty("--spot-y",`${event.clientY-rect.top}px`); }
  return <section className={[styles.telemetryCard,className].join(" ")} style={{"--stagger":stagger} as CSSProperties} onPointerMove={track}>{children}</section>;
}

function MetricCard({label,value,suffix="",meta,stagger,samples}:{readonly label:string;readonly value:number;readonly suffix?:string;readonly meta:string;readonly stagger:number;readonly samples:readonly number[]}) {
  const animated=useCountUp(value); const width=78,height=25,max=Math.max(...samples,1),min=Math.min(...samples,0),span=Math.max(1,max-min);
  const points=samples.map((sample,index)=>`${(index/Math.max(1,samples.length-1))*width},${height-((sample-min)/span)*(height-4)-2}`); const path=`M${points.join(" L")}`; const last=points.at(-1)!.split(",");
  return <SpotlightCard className={styles.metricCard} stagger={stagger}><div className={styles.metricLabel}><span>{label}</span><svg className={styles.sparkline} viewBox={`0 0 ${width} ${height}`} aria-hidden="true"><path d={path}/><circle cx={last[0]} cy={last[1]} r="2.3"/></svg></div><div className={styles.metricValue} aria-label={`${value}${suffix}`}><span aria-hidden="true">{animated.toLocaleString()}{suffix}</span></div><div className={styles.metricMeta}><span>{meta}</span><span className={styles.metricTrend}>LIVE</span></div></SpotlightCard>;
}

function Gauge({label,score,detail}:{readonly label:string;readonly score:number;readonly detail:string}) {
  const circumference=2*Math.PI*34,color=gaugeColor(score);
  return <div className={styles.gauge} style={{"--gauge-color":color,"--gauge-glow":`${color}73`} as CSSProperties}><svg className={styles.gaugeVisual} viewBox="0 0 80 80" role="img" aria-label={`${label} health score ${score} percent`}><circle className={styles.gaugeTrack} cx="40" cy="40" r="34"/><circle className={styles.gaugeProgress} cx="40" cy="40" r="34" strokeDasharray={circumference} strokeDashoffset={circumference*(1-score/100)}/></svg><strong>{label}</strong><span>{detail}</span></div>;
}

export function PlatformHealthDashboard({queryString}:PlatformHealthDashboardProps) {
  const [domains,setDomains]=useState<LoadedDomain[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null),[loadedAt,setLoadedAt]=useState<string|null>(null),[latencyHistory,setLatencyHistory]=useState<number[]>([]),[clock,setClock]=useState(()=>new Date()),[paletteOpen,setPaletteOpen]=useState(false);
  const firstAction=useRef<HTMLButtonElement>(null),terminalRef=useRef<HTMLDivElement>(null);
  const refresh=useCallback(async()=>{ setLoading(true); setError(null); const startedAt=performance.now(); try { const loaded=await Promise.all(DOMAINS.map((domain)=>loadDomain(domain,queryString))); const elapsed=Math.max(1,Math.round(performance.now()-startedAt)); setDomains(loaded); setLoadedAt(new Date().toISOString()); setLatencyHistory((current)=>[...current.slice(-11),elapsed]); } catch (err) { setError(err instanceof Error?err.message:"Unable to load governed health telemetry."); } finally { setLoading(false); } },[queryString]);

  useEffect(()=>{ void refresh(); const poll=window.setInterval(()=>{if(document.visibilityState==="visible") void refresh();},POLL_INTERVAL_MS); return()=>window.clearInterval(poll); },[refresh]);
  useEffect(()=>{const timer=window.setInterval(()=>setClock(new Date()),1000); return()=>window.clearInterval(timer);},[]);
  useEffect(()=>{const onKey=(event:KeyboardEvent)=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==="k"){event.preventDefault();setPaletteOpen((value)=>!value);}if(event.key==="Escape")setPaletteOpen(false);};window.addEventListener("keydown",onKey);return()=>window.removeEventListener("keydown",onKey);},[]);
  useEffect(()=>{if(paletteOpen)requestAnimationFrame(()=>firstAction.current?.focus());},[paletteOpen]);

  const allEntries=useMemo(()=>domains.flatMap((domain)=>domain.entries),[domains]); const activeEntries=useMemo(()=>allEntries.filter((entry)=>entry.itemCount>0),[allEntries]); const totalOpen=totalItems(activeEntries),worst=worstStatus(activeEntries),criticalCount=activeEntries.filter((entry)=>entry.healthStatus==="CRITICAL").length;
  const logs=useMemo<TelemetryLog[]>(()=>domains.flatMap((domain)=>domain.entries.filter((entry)=>entry.itemCount>0).map((entry)=>({id:`${domain.key}:${entry.healthKey}`,domain:domain.label,status:entry.healthStatus,count:entry.itemCount,key:formatHealthKey(entry.healthKey),at:entry.newestAt??entry.oldestAt}))).sort((a,b)=>statusRank(b.status)-statusRank(a.status)||String(b.at).localeCompare(String(a.at))),[domains]);
  useEffect(()=>{terminalRef.current?.scrollTo({top:0,behavior:"smooth"});},[logs]);
  const currentLatency=latencyHistory.at(-1)??0, latencySamples=latencyHistory.length>1?latencyHistory:[0,currentLatency,currentLatency], postureScore=activeEntries.length===0?100:worst==="CRITICAL"?18:worst==="DEGRADED"?48:76;
  const chartWidth=320,chartHeight=72,latencyMax=Math.max(...latencySamples,1),chartPoints=latencySamples.map((sample,index)=>`${(index/Math.max(1,latencySamples.length-1))*chartWidth},${chartHeight-(sample/latencyMax)*58-7}`),chartPath=`M${chartPoints.join(" L")}`,chartArea=`${chartPath} L${chartWidth},${chartHeight} L0,${chartHeight} Z`;
  function magnetic(event:ReactPointerEvent<HTMLButtonElement>){const rect=event.currentTarget.getBoundingClientRect();event.currentTarget.style.transform=`translate(${(event.clientX-rect.left-rect.width/2)*.08}px,${(event.clientY-rect.top-rect.height/2)*.12}px)`;} function resetMagnetic(event:ReactPointerEvent<HTMLButtonElement>){event.currentTarget.style.transform="";}

  return <div className={styles.commandCenter}>
    <header className={styles.hudHeader}><div className={styles.identity}><div className={styles.identityMark} aria-hidden="true">PX</div><div><p className={styles.eyebrow}>EXPADIO / Platform Operations</p><h1>Telemetry Command Center</h1></div></div><div className={styles.statusStrip} aria-label="Global telemetry status"><span className={styles.statusChip}><span className={[styles.statusDot,worst!=="NOMINAL"?styles.statusDotWarning:""].join(" ")}/>{statusLabel(worst)}</span><span className={[styles.statusChip,styles.statusChipOptional].join(" ")}>PING {currentLatency||"—"} MS</span><span className={[styles.statusChip,styles.statusChipOptional].join(" ")}>POLL 30S</span><span className={styles.statusChip}>{formatClock(clock)}</span><button type="button" className={styles.commandButton} onClick={()=>setPaletteOpen(true)}>⌘K COMMAND</button></div></header>
    <main className={styles.workspace}>{error?<div className={styles.errorBanner} role="alert">Telemetry link error: {error}</div>:null}
      <section className={styles.metricGrid} aria-label="Operational metrics"><MetricCard label="Operational posture" value={postureScore} suffix="%" meta={statusLabel(worst)} stagger={0} samples={[82,88,85,91,94,postureScore]}/><MetricCard label="Open items" value={totalOpen} meta="GOVERNED QUEUES" stagger={1} samples={[0,2,1,4,Math.max(1,totalOpen),totalOpen]}/><MetricCard label="Active buckets" value={activeEntries.length} meta={`${criticalCount} CRITICAL`} stagger={2} samples={[0,1,2,1,activeEntries.length,activeEntries.length]}/><MetricCard label="API round trip" value={currentLatency} suffix="ms" meta={loading?"SYNCING":"LAST POLL"} stagger={3} samples={latencySamples}/></section>
      <div className={styles.bentoGrid}>
        <SpotlightCard className={styles.topologyCard} stagger={4}><div className={styles.cardHeader}><div><h2>Governed Execution Topology</h2><p>Live read model · no worker mutations</p></div><span className={styles.microBadge}>4 nodes linked</span></div><div className={styles.topologyCanvas}><div className={[styles.hudCorner,styles.hudCornerTop].join(" ")}>MAP 600×456<br/>ORIGIN 300,228</div><div className={[styles.hudCorner,styles.hudCornerBottom].join(" ")}>REFRESH {loadedAt?formatLogTime(loadedAt):"PENDING"}<br/>SCOPE TENANT-BOUND</div><svg className={styles.topologySvg} viewBox="0 0 600 456" role="img" aria-labelledby="topology-title topology-desc"><title id="topology-title">EXPADIO governed execution topology</title><desc id="topology-desc">Four health domains connected to the governed action fabric.</desc><defs><radialGradient id="sweepGradient"><stop offset="0" stopColor="#06b6d4" stopOpacity=".2"/><stop offset=".6" stopColor="#06b6d4" stopOpacity=".035"/><stop offset="1" stopColor="#06b6d4" stopOpacity="0"/></radialGradient></defs><circle className={styles.sweep} cx="300" cy="228" r="190"/><circle className={styles.orbit} cx="300" cy="228" r="154"/><circle className={[styles.orbit,styles.orbitSecondary].join(" ")} cx="300" cy="228" r="196"/>{DOMAINS.map((domain)=><line key={`line-${domain.key}`} className={styles.connection} x1="300" y1="228" x2={domain.x} y2={domain.y}/>)}<polygon className={styles.centerHex} points="300,180 342,204 342,252 300,276 258,252 258,204"/><text className={styles.centerText} x="300" y="224">GOVERNED</text><text className={styles.centerText} x="300" y="238">ACTION FABRIC</text>{DOMAINS.map((domain)=>{const loaded=domains.find((item)=>item.key===domain.key),active=loaded?.entries.filter((entry)=>entry.itemCount>0)??[],status=loaded?.error?"CRITICAL":worstStatus(active);return <g key={domain.key}><circle className={nodeRingClass(status)} cx={domain.x} cy={domain.y} r="29"/><circle className={nodeCoreClass(status)} cx={domain.x} cy={domain.y} r="4"/><text className={styles.nodeLabel} x={domain.x} y={domain.y+47}>{domain.label.toUpperCase()}</text><text className={styles.nodeCount} x={domain.x} y={domain.y+60}>{loaded?.error??`${totalItems(active)} OPEN`}</text></g>;})}</svg></div></SpotlightCard>
        <SpotlightCard className={styles.gaugesCard} stagger={5}><div className={styles.cardHeader}><div><h2>Domain Integrity</h2><p>Derived from governed status buckets</p></div><span className={styles.microBadge}>HEALTH</span></div><div className={styles.gaugeGrid}>{DOMAINS.map((domain)=>{const loaded=domains.find((item)=>item.key===domain.key),score=healthScore(loaded);return <Gauge key={domain.key} label={domain.label} score={score} detail={loaded?.error??(score===100?"CLEAR":`${totalItems(loaded?.entries??[])} ITEMS`)}/>;})}</div></SpotlightCard>
        <SpotlightCard className={styles.latencyCard} stagger={6}><div className={styles.cardHeader}><div><h2>Telemetry Latency</h2><p>Client-observed API round trip</p></div><span className={styles.microBadge}>{latencyHistory.length} samples</span></div><div className={styles.latencyBody}><div className={styles.latencyValue}><strong>{currentLatency||"—"}</strong><span>milliseconds</span></div><svg className={styles.latencyChart} viewBox={`0 0 ${chartWidth} ${chartHeight}`} preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="latencyArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8b5cf6" stopOpacity=".65"/><stop offset="1" stopColor="#8b5cf6" stopOpacity="0"/></linearGradient></defs><line className={styles.chartGrid} x1="0" y1="18" x2={chartWidth} y2="18"/><line className={styles.chartGrid} x1="0" y1="45" x2={chartWidth} y2="45"/><path className={styles.latencyArea} d={chartArea}/><path className={styles.latencyPath} d={chartPath}/></svg></div></SpotlightCard>
        <SpotlightCard className={styles.feedCard} stagger={7}><div className={styles.cardHeader}><div><h2>Live Operational Feed</h2><p>Auto-refreshing governed snapshots</p></div><button type="button" className={styles.refreshButton} disabled={loading} onPointerMove={magnetic} onPointerLeave={resetMagnetic} onClick={()=>void refresh()}>{loading?"SYNCING…":"REFRESH NOW"}</button></div><div className={styles.feedLayout}><div ref={terminalRef} className={styles.terminal} role="log" aria-live="polite" aria-label="Operational telemetry feed">{logs.length?logs.map((log,index)=><div className={styles.logRow} key={log.id} style={{animationDelay:`${Math.min(index,8)*45}ms`}}><time className={styles.logTime}>{formatLogTime(log.at)}</time><span className={styles.logDomain}>{log.domain}</span><span className={styles.logMessage}>{log.key} · {log.count} item{log.count===1?"":"s"}</span><span className={[styles.severity,log.status==="CRITICAL"?styles.severityCritical:styles.severityWarning].join(" ")}>{statusLabel(log.status)}</span></div>):<div className={styles.emptyState}><span>NO ACTIVE HEALTH BUCKETS<br/>All governed health APIs currently report a clear snapshot.</span></div>}</div><aside className={styles.domainSummary} aria-label="Health domain links"><h3>Domain read models</h3>{DOMAINS.map((domain)=>{const loaded=domains.find((item)=>item.key===domain.key),active=loaded?.entries.filter((entry)=>entry.itemCount>0)??[];return <a key={domain.key} id={domain.key} className={styles.domainLink} href={appendQuery(domain.detailPath,queryString)}><span>{domain.label}</span><strong>{loaded?.error?"!":totalItems(active)}</strong></a>;})}</aside></div></SpotlightCard>
      </div>
    </main>
    {paletteOpen?<div className={styles.paletteBackdrop} role="presentation" onMouseDown={(event)=>{if(event.target===event.currentTarget)setPaletteOpen(false);}}><div className={styles.palette} role="dialog" aria-modal="true" aria-labelledby="command-title"><div className={styles.paletteHeader}><strong id="command-title">Quick command</strong><span>ESC TO CLOSE</span></div><div className={styles.paletteActions}><button ref={firstAction} type="button" className={styles.paletteAction} onClick={()=>{setPaletteOpen(false);void refresh();}}><span>Refresh governed telemetry</span><small>READ ONLY</small></button>{DOMAINS.map((domain)=><a key={domain.key} className={styles.paletteAction} href={appendQuery(domain.detailPath,queryString)}><span>Open {domain.label}</span><small>↗</small></a>)}</div></div></div>:null}
  </div>;
}
