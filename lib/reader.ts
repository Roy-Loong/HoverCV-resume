import type { Project, Rect } from "./schema";
import { imagePresentation } from "./media-layout";
import { HOVER_CARD_WIDTH, HOVER_CARD_HEIGHT } from "./card-layout";
export const HOVER_OPEN_MS = 180,
  HOVER_CLOSE_MS = 150,
  SLIDESHOW_MS = 3500;
export function imagePercent(rect: Rect, page: Project["pages"][number]): Rect {
  const [x0, y0, x1, y1] = page.view;
  const points = [
    [rect[0], rect[1]],
    [rect[2], rect[3]],
  ].map(([x, y]) => {
    const u = (x - x0) / (x1 - x0),
      v = (y - y0) / (y1 - y0);
    switch (((page.rotation % 360) + 360) % 360) {
      case 90:
        return [v, u];
      case 180:
        return [1 - u, v];
      case 270:
        return [1 - v, 1 - u];
      default:
        return [u, 1 - v];
    }
  });
  const [a, b] = points;
  return [
    Math.min(a[0], b[0]) * 100,
    Math.min(a[1], b[1]) * 100,
    Math.abs(a[0] - b[0]) * 100,
    Math.abs(a[1] - b[1]) * 100,
  ];
}
export function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function jsonForScript(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
// Public snapshots and offline exports intentionally use this same self-contained reader.
export function readerHtml(project: Project) {
  const data = {
    name: project.name,
    annotations: project.annotations.map((a) => ({
      ...a,
      media: a.media.map((m) =>
        m.type === "image" ? { ...m, presentation: imagePresentation(m) } : m,
      ),
    })),
  };
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHtml(project.name)} · HoverCV</title><style>
*{box-sizing:border-box}body{margin:0;background:#f6f5f2;color:#292831;font:14px/1.65 system-ui,sans-serif}header{padding:18px 28px;border-bottom:1px solid #e8e6e2;display:flex;justify-content:space-between;background:white}header b{font-size:19px;letter-spacing:-.5px}header span{color:#77747e}main{max-width:850px;margin:30px auto;padding:0 16px}.page{position:relative;margin-bottom:24px;box-shadow:0 6px 30px #29283112}.page>img{display:block;width:100%}.hotspot{position:absolute;cursor:pointer;border:0;background:transparent;padding:0}.hotspot.area{border:2px solid var(--accent);border-radius:3px;background:transparent}.hotspot:focus-visible{outline:3px solid #292831;outline-offset:3px}#card{position:fixed;width:${HOVER_CARD_WIDTH}px;height:${HOVER_CARD_HEIGHT}px;max-width:90vw;max-height:70dvh;background:#fff;border:1px solid #e8e6e2;border-radius:14px;box-shadow:0 16px 60px #29283125;z-index:5;overflow:auto;overscroll-behavior:contain}#card[hidden]{display:none}.inner{padding:22px}.eyebrow{font-size:10px;color:#77747e;letter-spacing:2px}h2{font-size:22px;margin:8px 0 12px}p{white-space:pre-wrap;word-break:break-word}a{color:#6958d5}#card video{width:100%;max-height:215px;object-fit:cover;border-radius:8px}.image-frame{width:100%;overflow:hidden;background:#f0eaf6;border-radius:7px}.image-frame>img{display:block;width:100%;max-width:none}button{font:inherit;cursor:pointer}nav{display:flex;justify-content:space-between;align-items:center;margin:8px 0}nav button,#close{border:1px solid #e8e6e2;background:#faf9f7;border-radius:6px;padding:3px 10px}#close{float:right}.source{font-size:11px;color:#77747e}footer{text-align:center;color:#77747e;padding:16px 0 40px;font-size:12px}@media(max-width:640px){#card{bottom:12px!important;left:5vw!important;top:auto!important;width:90vw}header{padding:14px}header span{font-size:11px}main{margin:16px auto}}
</style><header><b>Hover<span style="color:#6958d5">CV</span></b><span>悬停或点击彩色标记，展开更多故事</span></header><main>${project.pages
    .map(
      (page, i) =>
        `<section class="page"><img src="${page.image}" alt="简历第 ${i + 1} 页">${project.annotations
          .filter((a) => a.page === i + 1)
          .flatMap((a) =>
            a.rects.map((rect) => {
              const [l, t, w, h] = imagePercent(rect, page);
              return `<button class="hotspot ${a.kind === "area" ? "area" : ""}" style="left:${l}%;top:${t}%;width:${w}%;height:${h}%;--accent:${a.color}" data-id="${escapeHtml(a.id)}" aria-label="${escapeHtml(a.title)}"></button>`;
            }),
          )
          .join("")}</section>`,
    )
    .join(
      "",
    )}</main><aside id="card" hidden role="dialog" aria-label="注释详情"></aside><footer>Made with HoverCV · 内容由简历作者提供</footer><script type="application/json" id="payload">${jsonForScript(data)}</script><script>
(()=>{
const data=JSON.parse(document.getElementById('payload').textContent),card=document.getElementById('card');let active=null,anchor=null,openTimer,closeTimer,slides,index=0,hoverControls=false,hoverCard=false,touchPinned=false;
const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text)e.textContent=text;if(cls)e.className=cls;return e};
function cancelClose(){clearTimeout(closeTimer);closeTimer=undefined}
function clear(){clearTimeout(openTimer);cancelClose();clearInterval(slides);card.querySelectorAll('video').forEach(v=>v.pause())}
function hide(){if(document.fullscreenElement)return;clear();card.hidden=true;active=null;hoverCard=false;touchPinned=false}
function position(){if(!anchor||innerWidth<=640)return;const r=anchor.getBoundingClientRect();let x=r.right+14;if(x+${HOVER_CARD_WIDTH}>innerWidth-10)x=r.left-${HOVER_CARD_WIDTH + 14};card.style.left=Math.max(10,Math.min(x,innerWidth-${HOVER_CARD_WIDTH + 10}))+'px';card.style.top=Math.max(10,Math.min(r.top-20,innerHeight-card.offsetHeight-10))+'px'}
function render(){card.replaceChildren();const a=active,wrap=el('div',null,'inner');const close=el('button','×');close.id='close';close.setAttribute('aria-label','关闭');close.onclick=hide;wrap.append(close,el('div','BEYOND THE RESUME','eyebrow'),el('h2',a.title));
const media=()=>{if(!a.media.length)return;const m=a.media[index],item=el(m.type==='image'?'img':'video');item.src=m.src;if(m.type==='image')item.alt=m.caption;else{item.controls=true;item.preload='metadata';item.playsInline=true;}if(m.type==='image'){const frame=el('div',null,'image-frame');Object.assign(frame.style,m.presentation.frame);Object.assign(item.style,m.presentation.image);frame.append(item);wrap.append(frame)}else wrap.append(item);if(m.caption)wrap.append(el('div',m.caption,'source'));const nav=el('nav'),prev=el('button','←'),next=el('button','→');prev.setAttribute('aria-label','上一张');next.setAttribute('aria-label','下一张');const change=d=>{clearInterval(slides);card.querySelectorAll('video').forEach(v=>v.pause());index=(index+d+a.media.length)%a.media.length;render()};prev.onclick=()=>change(-1);next.onclick=()=>change(1);nav.append(prev,el('span',(index+1)+' / '+a.media.length),next);wrap.append(nav)};
if(a.template!=='intro')media();wrap.append(el('p',a.body||'作者尚未填写补充说明。'));if(a.template==='intro')media();a.links.forEach(l=>{const link=el('a',l.label||l.url);link.href=l.url;link.target='_blank';link.rel='noopener noreferrer';wrap.append(link,el('br'))});if(a.citations.length){wrap.append(el('p','资料来源 · '+(a.searchedAt||''),'source'));a.citations.forEach(l=>{const link=el('a',l.title);link.href=l.url;link.target='_blank';link.rel='noopener noreferrer';wrap.append(link,el('br'))})}card.append(wrap);clearInterval(slides);if(a.autoplay&&a.media.length>1&&!hoverControls&&!card.contains(document.activeElement))slides=setInterval(()=>{if(!active)return;card.querySelectorAll('video').forEach(v=>v.pause());index=(index+1)%a.media.length;render()},${SLIDESHOW_MS});position()}
function show(button){clear();const a=data.annotations.find(a=>a.id===button.dataset.id);if(!a)return;anchor=button;active=a;index=0;card.hidden=false;render()}
function delayedClose(){if(touchPinned||closeTimer!==undefined)return;closeTimer=setTimeout(()=>{closeTimer=undefined;hide()},${HOVER_CLOSE_MS})}
document.querySelectorAll('.hotspot').forEach(b=>{b.onpointerdown=e=>{touchPinned=e.pointerType==='touch'};b.onpointerenter=e=>{if(e.pointerType==='touch')return;touchPinned=false;cancelClose();clearTimeout(openTimer);openTimer=setTimeout(()=>show(b),${HOVER_OPEN_MS})};b.onpointerleave=e=>{if(e.pointerType==='touch'||touchPinned)return;clearTimeout(openTimer);delayedClose()};b.onfocus=()=>show(b);b.onclick=()=>show(b)});
card.onpointerenter=e=>{if(e.pointerType==='touch')return;hoverCard=true;cancelClose()};card.onpointerleave=e=>{if(e.pointerType==='touch')return;hoverCard=false;delayedClose()};card.addEventListener('pointerover',e=>{if(e.target.closest('button,a,video')){hoverControls=true;clearInterval(slides)}});card.addEventListener('pointerout',e=>{if(e.target.closest('button,a,video')){hoverControls=false;if(active) {clearInterval(slides);if(active.autoplay&&active.media.length>1)slides=setInterval(()=>{index=(index+1)%active.media.length;render()},${SLIDESHOW_MS})}}});card.addEventListener('focusin',()=>clearInterval(slides));card.addEventListener('focusout',()=>{if(active)render()});
// Safe corridor is the convex triangle between the pointer's hotspot exit and the card's near edge.
let exitPoint=null;document.addEventListener('pointermove',e=>{if(e.pointerType==='touch'||touchPinned||!active||!anchor||hoverCard)return;const a=anchor.getBoundingClientRect(),c=card.getBoundingClientRect();if(e.clientX>=a.left&&e.clientX<=a.right&&e.clientY>=a.top&&e.clientY<=a.bottom){exitPoint={x:e.clientX,y:e.clientY};cancelClose();return}if(!exitPoint)return;const edge=c.left>=a.right?c.left:c.right;const p=exitPoint,q={x:edge,y:c.top-8},r={x:edge,y:c.bottom+8},s={x:e.clientX,y:e.clientY};const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);const x=cross(p,q,s),y=cross(q,r,s),z=cross(r,p,s);if((x>=0&&y>=0&&z>=0)||(x<=0&&y<=0&&z<=0))cancelClose();else if(!card.contains(document.activeElement))delayedClose()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')hide()});document.addEventListener('pointerdown',e=>{if(!card.contains(e.target)&&!e.target.closest('.hotspot'))hide()});document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement&&!hoverCard)delayedClose()});addEventListener('resize',position);addEventListener('scroll',position,{passive:true});
})();</script></html>`;
}
