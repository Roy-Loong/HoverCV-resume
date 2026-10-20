/** Acrobat-compatible ES5. Native Hide actions remain usable without scripting. */
export function pdfHoverRuntime(config: {
  groups: {
    hover: string[][];
    pinned: string[][];
    hit: string;
    page: number;
  }[];
}) {
  return `if(typeof HC_ready==='undefined'){
var HC_ready=true,HC_doc=this,HC_timer=null,HC_active=-1,HC_frame=0,HC_pinned=false,HC_groups=${JSON.stringify(config.groups)};
function HC_keep(){if(HC_timer!==null){try{app.clearTimeOut(HC_timer);}catch(e){}HC_timer=null;}}
function HC_display(names,value){for(var i=0;i<names.length;i++){try{var f=HC_doc.getField(names[i]);if(f)f.display=value;}catch(e){}}}
function HC_hits(page,except){for(var i=0;i<HC_groups.length;i++){var g=HC_groups[i];if(g.page===page)HC_display([g.hit],i===except?display.noPrint:display.hidden);}}
function HC_hide(){HC_keep();for(var i=0;i<HC_groups.length;i++){var g=HC_groups[i];for(var j=0;j<g.hover.length;j++){HC_display(g.hover[j],display.hidden);HC_display(g.pinned[j],display.hidden);}HC_display([g.hit],display.noPrint);}HC_active=-1;HC_pinned=false;}
function HC_open(id,frame,pinned){HC_keep();HC_active=id;HC_frame=frame;HC_pinned=pinned;}
function HC_leave(id,frame){
if(HC_active!==id)return;
if(HC_pinned){HC_hits(HC_groups[id].page,id);return;}
HC_keep();var g=HC_groups[id];
// The preceding native action already hid hover fields. Restore only when a
// timer really exists; readers without timers get immediate native closing.
try{HC_timer=app.setTimeOut("HC_hide();",150);if(HC_timer===null||typeof HC_timer==='undefined'){HC_hide();return;}HC_display(g.hover[HC_frame],display.noPrint);HC_hits(g.page,id);}catch(e){HC_hide();}
}
}`;
}
