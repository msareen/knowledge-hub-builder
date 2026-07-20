// bkr visualize — scan bundles + refs, emit visualizer/graph.html (self-contained)
import { HUB, BUNDLES, listBundles, read, refTargets, join, existsSync, mkdirSync } from "./lib/util";
import { readdirSync, writeFileSync } from "node:fs";

type Node = { id: string; notes: number; scope: string };
type Edge = { from: string; to: string; why: string };

const bundles = listBundles();
const nodes: Node[] = [];
const edges: Edge[] = [];

// scope lines from outer.index.md table
const scopes: Record<string, string> = {};
for (const line of read(join(HUB, "outer.index.md")).split("\n")) {
  const m = line.match(/^\|\s*\[([a-z0-9-]+)\][^|]*\|\s*([^|]+)\|/);
  if (m) scopes[m[1]] = m[2].trim();
}

for (const b of bundles) {
  // concepts = non-reserved .md files anywhere in the bundle (excluding raw/)
  const count = (d: string): number =>
    readdirSync(d, { withFileTypes: true }).reduce((n, e) => {
      if (e.isDirectory()) return e.name === "raw" ? n : n + count(join(d, e.name));
      return n + (e.name.endsWith(".md") && !["index.md", "log.md", "refs.md"].includes(e.name) ? 1 : 0);
    }, 0);
  const notes = count(join(BUNDLES, b));
  nodes.push({ id: b, notes, scope: scopes[b] ?? "" });
  const refsPath = join(BUNDLES, b, "refs.md");
  if (existsSync(refsPath)) {
    const refs = read(refsPath);
    for (const line of refs.split("\n")) {
      const m = line.match(/^\|\s*\[?([a-z0-9][a-z0-9-]*)\]?[^|]*\|\s*([^|]*)\|/);
      if (m && !["bundle", "---"].includes(m[1]) && bundles.includes(m[1]))
        edges.push({ from: b, to: m[1], why: m[2].trim() });
    }
  }
}

const data = JSON.stringify({ nodes, edges });
const html = `<!doctype html>
<meta charset="utf-8"><title>BKR — bundle graph</title>
<style>
  body{margin:0;font:14px system-ui;background:#111;color:#ddd}
  #hud{position:fixed;top:10px;left:12px}
  #hud b{color:#7cc}
  canvas{display:block}
</style>
<div id="hud"><b>BKR</b> — ${nodes.length} bundles, ${edges.length} refs. Drag nodes; hover for scope.</div>
<canvas id="c"></canvas>
<script>
const G=${data};
const cv=document.getElementById('c'),cx=cv.getContext('2d');
let W,H;function rs(){W=cv.width=innerWidth;H=cv.height=innerHeight}rs();onresize=rs;
const N=G.nodes.map((n,i)=>({...n,x:W/2+Math.cos(i/G.nodes.length*6.283)*Math.min(W,H)/3.2,
  y:H/2+Math.sin(i/G.nodes.length*6.283)*Math.min(W,H)/3.2,vx:0,vy:0,
  r:14+Math.sqrt(n.notes)*5}));
const idx=Object.fromEntries(N.map((n,i)=>[n.id,i]));
const E=G.edges.map(e=>({a:idx[e.from],b:idx[e.to],why:e.why}));
let drag=null,hover=null;
function step(){
  for(let i=0;i<N.length;i++)for(let j=i+1;j<N.length;j++){
    const a=N[i],b=N[j];let dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1;
    const f=Math.min(3000/(d*d),5);dx/=d;dy/=d;
    a.vx-=dx*f;a.vy-=dy*f;b.vx+=dx*f;b.vy+=dy*f;}
  for(const e of E){const a=N[e.a],b=N[e.b];let dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1;
    const f=(d-180)*0.003;a.vx+=dx/d*f;a.vy+=dy/d*f;b.vx-=dx/d*f;b.vy-=dy/d*f;}
  for(const n of N){n.vx+=(W/2-n.x)*0.0005;n.vy+=(H/2-n.y)*0.0005;
    if(n!==drag){n.x+=n.vx*=0.85;n.y+=n.vy*=0.85;}}
}
function draw(){
  cx.clearRect(0,0,W,H);
  cx.strokeStyle='#3a6';cx.fillStyle='#3a6';
  for(const e of E){const a=N[e.a],b=N[e.b];
    cx.globalAlpha=.6;cx.beginPath();cx.moveTo(a.x,a.y);cx.lineTo(b.x,b.y);cx.stroke();
    const t=.72,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t,ang=Math.atan2(b.y-a.y,b.x-a.x);
    cx.beginPath();cx.moveTo(x,y);cx.lineTo(x-9*Math.cos(ang-.4),y-9*Math.sin(ang-.4));
    cx.lineTo(x-9*Math.cos(ang+.4),y-9*Math.sin(ang+.4));cx.fill();}
  cx.globalAlpha=1;
  for(const n of N){
    cx.beginPath();cx.arc(n.x,n.y,n.r,0,7);
    cx.fillStyle=n===hover?'#7cc':'#245';cx.fill();
    cx.strokeStyle='#7cc';cx.stroke();
    cx.fillStyle='#eee';cx.textAlign='center';
    cx.fillText(n.id,n.x,n.y-n.r-6);
    cx.fillStyle='#9ab';cx.fillText(n.notes+' concepts',n.x,n.y+4);}
  if(hover&&hover.scope){cx.fillStyle='#7cc';cx.textAlign='left';
    cx.fillText(hover.id+': '+hover.scope,12,H-16);}
}
function at(x,y){return N.find(n=>Math.hypot(n.x-x,n.y-y)<n.r+4)}
cv.onmousedown=e=>drag=at(e.clientX,e.clientY);
cv.onmouseup=()=>drag=null;
cv.onmousemove=e=>{hover=at(e.clientX,e.clientY);
  if(drag){drag.x=e.clientX;drag.y=e.clientY;drag.vx=drag.vy=0;}};
(function loop(){step();draw();requestAnimationFrame(loop)})();
</script>`;

const outDir = join(HUB, "visualizer");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "graph.html"), html);
console.log(`visualizer/graph.html — ${nodes.length} bundles, ${edges.length} refs`);
