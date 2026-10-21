import { HOVER_CLOSE_MS } from "./hover-timing";

/** Acrobat-compatible ES5. Native close/navigation also work without timers. */
export function pdfHoverRuntime(config: {
  rects?: Record<string, number[]>;
  groups: {
    hover: string[][];
    pinned: string[][];
    exits?: string[];
    transit?: string[];
    nav?: Record<string, number | undefined>[];
    hit: string;
    page: number;
  }[];
}) {
  return `if(typeof HC_ready==='undefined'){
var HC_ready=true,HC_doc=this,HC_timer=null,HC_interval=null,HC_generation=0,HC_active=-1,HC_frame=0,HC_pinned=false,HC_inside=false,HC_rects=${JSON.stringify(config.rects ?? {})},HC_rectHidden={},HC_groups=${JSON.stringify(config.groups)};
function HC_keep(){HC_generation++;if(HC_timer!==null){try{app.clearTimeOut(HC_timer);}catch(e){}HC_timer=null;}if(HC_interval!==null){try{app.clearInterval(HC_interval);}catch(e){}HC_interval=null;}}
function HC_display(names,value){for(var i=0;i<names.length;i++){try{var name=names[i],f=HC_doc.getField(name);if(!f)continue;var hidden=value===display.hidden;try{var readonly=hidden||name.indexOf("_keep_")>=0;if(f.readonly!==readonly)f.readonly=readonly;}catch(e){}try{if(!HC_rects[name]){var r=f.rect;if(r&&r.length===4&&r[2]>r[0]&&r[1]>r[3])HC_rects[name]=r;}if(HC_rects[name]&&HC_rectHidden[name]!==hidden){f.rect=hidden?[0,1,1,0]:HC_rects[name];HC_rectHidden[name]=hidden;}}catch(e){}if(f.display!==value)f.display=value;}catch(e){}}}
function HC_hits(page,except){for(var i=0;i<HC_groups.length;i++){var g=HC_groups[i];if(g.page===page)HC_display([g.hit],i===except?display.noPrint:display.hidden);}}
function HC_hide(guardId){HC_keep();for(var i=0;i<HC_groups.length;i++){var g=HC_groups[i];for(var j=0;j<g.hover.length;j++){HC_display(g.hover[j],display.hidden);HC_display(g.pinned[j],display.hidden);}HC_display(g.exits||[],i===guardId?display.noPrint:display.hidden);HC_display(g.transit||[],display.hidden);HC_display([g.hit],display.noPrint);}HC_active=-1;HC_pinned=false;}
function HC_open(id,frame,pinned,inside){HC_keep();HC_active=id;HC_frame=frame;HC_pinned=pinned;HC_inside=inside!==false;var g=HC_groups[id];for(var i=0;i<HC_groups.length;i++){var other=HC_groups[i];if(other.page!==g.page)continue;for(var j=0;j<other.hover.length;j++){HC_display(other.hover[j],i===id&&j===frame&&!pinned?display.noPrint:display.hidden);HC_display(other.pinned[j],i===id&&j===frame&&pinned?display.noPrint:display.hidden);}HC_display(other.transit||[],i===id&&inside===false?display.noPrint:display.hidden);HC_display(other.exits||[],i===id&&inside!==false?display.noPrint:display.hidden);}HC_hits(g.page,id);HC_keep();}
function HC_touch(id){if(HC_active<0){HC_hide();return;}HC_open(HC_active,HC_frame,HC_pinned,true);}
function HC_nav(id,direction){if(HC_active!==id)return;var targets=HC_groups[id].nav||[],target=(targets[HC_frame]||{})[direction];if(typeof target==='number')HC_open(id,target,HC_pinned,true);}
function HC_enter(id){if(HC_active!==id)return;HC_inside=true;HC_keep();HC_display(HC_groups[id].transit||[],display.hidden);HC_display(HC_groups[id].exits||[],display.noPrint);HC_hits(HC_groups[id].page,id);HC_keep();}
function HC_transfer(id){if(HC_active!==id)return;if(HC_inside)HC_hide();else HC_keep();}
function HC_expire(generation){if(generation===HC_generation)HC_hide();}
function HC_schedule(){HC_keep();var ready=false,script="HC_expire("+HC_generation+");";try{var timer=app.setTimeOut(script,${HOVER_CLOSE_MS});if(timer!==null&&typeof timer!=='undefined'){HC_timer=timer;ready=true;}}catch(e){}try{var interval=app.setInterval(script,${HOVER_CLOSE_MS});if(interval!==null&&typeof interval!=='undefined'){HC_interval=interval;ready=true;}}catch(e){}return ready;}
function HC_leave(id,frame){
if(HC_active!==id||HC_frame!==frame)return;
// Keep an independent interval fallback for readers with a broken timeout.
HC_schedule();
}
function HC_outside(id){
if(HC_active!==id&&HC_active!==-1)return;
// Never restore a natively closed card here. Some readers return a timer
// handle without running its callback; restoring would leave it stuck open.
// Native closing is immediate (within the requested 250 ms upper bound).
HC_hide(id);
}
HC_hide();
}`;
}
