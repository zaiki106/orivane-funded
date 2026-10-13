// Presentation only. No network requests, price interpolation or trading logic.
export function installAppleMotion(){
 const root=document.documentElement,view=document.querySelector('#view'),holder=document.querySelector('.header-actions');
 if(!view||!holder||typeof MutationObserver!=='function')return;
 root.classList.add('apple-pro');
 const reduced=window.matchMedia('(prefers-reduced-motion: reduce)'),fine=window.matchMedia('(hover: hover) and (pointer: fine)'),running=new Set(),tracks=new Map(),prices=new Map();
 let mode='auto',queued=false,hoverFrame=0,pointer=null,scene=null;
 try{mode=localStorage.getItem('orivane.apple.motion.v1')??'auto';}catch{}
 const enabled=()=>mode==='on'||mode!=='off'&&!reduced.matches,allowed=()=>enabled()&&!document.hidden;
 const toggle=document.createElement('button');toggle.className='apple-motion-toggle';toggle.dataset.appleMotion='';toggle.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M3 12h2l3-6 4 12 4-12 3 6h2"/></svg>';holder.prepend(toggle);
 const atmosphere=document.createElement('div');atmosphere.className='apple-atmosphere';atmosphere.setAttribute('aria-hidden','true');atmosphere.innerHTML='<i></i><i></i>';document.body.prepend(atmosphere);
 function animate(element,frames,options={}){
  if(!allowed()||!element?.isConnected||typeof element.animate!=='function')return null;
  if(running.size>=24)running.values().next().value.cancel();
  const a=element.animate(frames,{duration:420,easing:'cubic-bezier(.22,1,.36,1)',...options});running.add(a);
  const clear=()=>running.delete(a);a.addEventListener('finish',clear,{once:true});a.addEventListener('cancel',clear,{once:true});return a;
 }
 function stop(){for(const a of running)a.cancel();running.clear();}
 function sync(){root.classList.toggle('apple-motion-off',!enabled());root.classList.toggle('apple-motion-forced',mode==='on');root.classList.toggle('apple-motion-paused',document.hidden);toggle.setAttribute('aria-pressed',String(enabled()));toggle.setAttribute('aria-label',enabled()?'Réduire les animations':'Activer les animations');toggle.title=enabled()?'Motion activé':reduced.matches?'Animations réduites · activer manuellement':'Motion désactivé';}
 function selection(selector){
  const track=document.querySelector(selector),active=track?.querySelector('button.active');if(!active)return;
  let pill=track.querySelector(':scope > .apple-selection');if(!pill){pill=document.createElement('span');pill.className='apple-selection';pill.setAttribute('aria-hidden','true');track.prepend(pill);}
  const next={x:active.offsetLeft,y:active.offsetTop,w:active.offsetWidth,h:active.offsetHeight},previous=tracks.get(selector);
  pill.style.left=next.x+'px';pill.style.top=next.y+'px';pill.style.width=next.w+'px';pill.style.height=next.h+'px';
  if(previous&&(previous.x!==next.x||previous.y!==next.y))animate(pill,[{transform:'translate('+(previous.x-next.x)+'px,'+(previous.y-next.y)+'px) scale('+previous.w/next.w+','+previous.h/next.h+')'},{transform:'translate(0,0) scale(1,1)'}],{duration:460});
  tracks.set(selector,next);
 }
 function refresh(){
  queued=false;sync();selection('.app-header nav');selection('.workspace-switch');
  const key=document.querySelector('.app-header nav button.active')?.dataset.tab,desk=view.querySelector('#desk'),next=key+'|'+(desk?view.querySelector('.quote-name h1')?.textContent:'');
  if(next!==scene){scene=next;animate(view,[{opacity:.45,transform:'translateY(10px)'},{opacity:1,transform:'translateY(0)'}],{duration:540});}
  const quote=view.querySelector('.quote-value b'),market=view.querySelector('.quote-name h1')?.textContent;
  if(quote&&market){const value=quote.textContent,old=prices.get(market);prices.set(market,value);if(old!==undefined&&old!==value)animate(quote,[{opacity:.72,textShadow:'0 0 18px #91b5ff70'},{opacity:1,textShadow:'0 0 0px #91b5ff00'}],{duration:280});}
 }
 function schedule(){if(!queued){queued=true;requestAnimationFrame(refresh);}}
 new MutationObserver(schedule).observe(view,{childList:true,subtree:true});
 document.addEventListener('click',event=>{
  if(event.target.closest('[data-apple-motion]')){mode=enabled()?'off':'on';try{localStorage.setItem('orivane.apple.motion.v1',mode);}catch{}stop();sync();schedule();return;}
  if(event.target.closest('[data-workspace-tab]'))requestAnimationFrame(()=>{const desk=view.querySelector('#desk'),pane=desk?.querySelector('[data-workspace-pane="'+desk.dataset.workspace+'"]');animate(pane,[{opacity:.3,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],{duration:340});schedule();});
 });
 document.addEventListener('pointerdown',event=>{const button=event.target.closest('button');if(button&&!button.disabled)animate(button,[{scale:'.97'},{scale:'1'}],{duration:240});},{passive:true});
 document.addEventListener('pointermove',event=>{if(!allowed()||!fine.matches)return;const card=event.target.closest('.execution-panel,.desk-sidebar,.pulse-panel,.insight-panel');if(!card)return;pointer={card,x:event.clientX,y:event.clientY};if(!hoverFrame)hoverFrame=requestAnimationFrame(()=>{hoverFrame=0;if(!pointer?.card.isConnected)return;const r=pointer.card.getBoundingClientRect();pointer.card.style.setProperty('--glow-x',(pointer.x-r.left)+'px');pointer.card.style.setProperty('--glow-y',(pointer.y-r.top)+'px');});},{passive:true});
 document.addEventListener('toggle',event=>{if(event.target.matches?.('details')&&event.target.open)for(const child of event.target.children)if(child.tagName!=='SUMMARY')animate(child,[{opacity:.4,transform:'translateY(-5px)'},{opacity:1,transform:'translateY(0)'}],{duration:260});},true);
 document.addEventListener('visibilitychange',()=>{stop();sync();});reduced.addEventListener('change',()=>{stop();sync();});window.addEventListener('resize',schedule,{passive:true});
 sync();schedule();
}
