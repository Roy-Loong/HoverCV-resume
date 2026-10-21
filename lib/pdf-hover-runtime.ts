import { HOVER_CLOSE_MS } from "./hover-timing";

/** Acrobat-compatible ES5. Native close/navigation also work without timers. */
export function pdfHoverRuntime(config: {
  groups: {
    hover: string[][];
    pinned: string[][];
    exits?: string[];
    hit: string;
    page: number;
  }[];
}) {
  return `if(typeof HC_ready==='undefined'){
var HC_ready=true,HC_doc=this,HC_timer=null,HC_generation=0,HC_active=-1,HC_frame=0,HC_pinned=false,HC_groups=${JSON.stringify(config.groups)};
function HC_keep(){HC_generation++;if(HC_timer!==null){try{app.clearTimeOut(HC_timer);}catch(e){}HC_timer=null;}}
function HC_display(names,value){for(var i=0;i<names.length;i++){try{var f=HC_doc.getField(names[i]);if(f)f.display=value;}catch(e){}}}
function HC_hits(page,except){for(var i=0;i<HC_groups.length;i++){var g=HC_groups[i];if(g.page===page)HC_display([g.hit],i===except?display.noPrint:display.hidden);}}
function HC_hide(){HC_keep();for(var i=0;i<HC_groups.length;i++){var g=HC_groups[i];for(var j=0;j<g.hover.length;j++){HC_display(g.hover[j],display.hidden);HC_display(g.pinned[j],display.hidden);}HC_display(g.exits||[],display.hidden);HC_display([g.hit],display.noPrint);}HC_active=-1;HC_pinned=false;}
function HC_open(id,frame,pinned){HC_keep();HC_active=id;HC_frame=frame;HC_pinned=pinned;HC_display(HC_groups[id].exits||[],display.noPrint);HC_hits(HC_groups[id].page,id);}
function HC_enter(id){if(HC_active!==id)return;HC_keep();HC_display(HC_groups[id].exits||[],display.noPrint);HC_hits(HC_groups[id].page,id);}
function HC_expire(generation){if(generation===HC_generation)HC_hide();}
function HC_schedule(){HC_keep();try{var timer=app.setTimeOut("HC_expire("+HC_generation+");",${HOVER_CLOSE_MS});if(timer===null||typeof timer==='undefined')return false;HC_timer=timer;return true;}catch(e){return false;}}
function HC_leave(id,frame){
if(HC_active!==id||HC_frame!==frame)return;
if(HC_pinned){HC_hits(HC_groups[id].page,id);return;}
// Crossings between the word, bridge and card must never hide anything.
// Native outside guards handle automatic closing when timers are unsupported.
HC_schedule();
}
function HC_outside(id){
if(HC_active!==id)return;
var g=HC_groups[id],names=(HC_pinned?g.pinned:g.hover)[HC_frame];
// The guard already closed natively. Only a working timer may restore the
// content for 250 ms; guards stay hidden until the pointer enters the card.
if(!HC_schedule()){HC_hide();return;}
HC_display(names,display.noPrint);HC_hits(g.page,id);
}
}`;
}
