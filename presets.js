import { loadPresets } from './local-api.js';
const labels = {1:'仅 CET4',2:'仅 CET6',3:'CET4 ∩ CET6',4:'仅 IELTS',5:'CET4 ∩ IELTS',6:'CET6 ∩ IELTS',7:'三者共有'};
const points = {1:[100,112],2:[260,112],3:[180,92],4:[180,256],5:[123,193],6:[237,193],7:[180,160]};
const circles = [[135,125],[225,125],[180,203]];
export async function mountPresets(container, request) {
  if (!document.querySelector('link[data-presets]')) {
    const link=document.createElement('link'); link.rel='stylesheet'; link.href='./presets.css'; link.dataset.presets=''; document.head.append(link);
  }
  container.classList.add('preset-panel'); container.textContent='正在加载考试词库…';
  try {
    const [rows,settings]=await Promise.all([loadPresets(),request('/api/settings')]);
    let active=Array.isArray(settings.englishRegions), selected=new Set(settings.englishRegions || []);
    const counts=Object.fromEntries(Object.keys(labels).map(n=>[n,rows.filter(r=>r.mask===Number(n)).length]));
    container.replaceChildren();
    const title=document.createElement('h2');title.textContent='英语词汇范围';container.append(title);
    const note=document.createElement('p');note.textContent='点选多个区域，合并为下一轮英语抽词范围。当前冰面与熟练度历史保留。';container.append(note);
    const ns='http://www.w3.org/2000/svg';const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 360 310');svg.classList.add('preset-venn');svg.setAttribute('aria-label','CET4、CET6 与 IELTS 词表交集');
    const defs=document.createElementNS(ns,'defs');svg.append(defs);
    const uid='venn-'+Math.random().toString(36).slice(2); const controls=[];
    for(let mask=1;mask<=7;mask++) {
      const group=document.createElementNS(ns,'g'); let current=group;
      circles.forEach(([cx,cy],i)=>{
        const clip=document.createElementNS(ns,'mask'); const id=`${uid}-${mask}-${i}`;clip.id=id;clip.setAttribute('maskUnits','userSpaceOnUse');clip.setAttribute('x','0');clip.setAttribute('y','0');clip.setAttribute('width','360');clip.setAttribute('height','310');
        const rect=document.createElementNS(ns,'rect');rect.setAttribute('width','360');rect.setAttribute('height','310');rect.setAttribute('fill',mask&(1<<i)?'black':'white');clip.append(rect);
        const c=document.createElementNS(ns,'circle');c.setAttribute('cx',cx);c.setAttribute('cy',cy);c.setAttribute('r','95');c.setAttribute('fill',mask&(1<<i)?'white':'black');clip.append(c);defs.append(clip);
        const inner=document.createElementNS(ns,'g');inner.setAttribute('mask',`url(#${id})`);current.append(inner);current=inner;
      });
      const shape=document.createElementNS(ns,'rect');shape.setAttribute('width','360');shape.setAttribute('height','310');shape.classList.add('preset-region');current.append(shape);svg.append(group);
      // The mask shapes paint exact disjoint regions; hit testing uses the same geometry below.
      controls.push({mask,shape});
    }
    svg.addEventListener('click',event=>{const p=svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;const v=p.matrixTransform(svg.getScreenCTM().inverse());const mask=circles.reduce((m,[x,y],i)=>m|(Math.hypot(v.x-x,v.y-y)<=95?1<<i:0),0);if(mask)toggle(mask);});
    for(const [mask,[x,y]] of Object.entries(points)){const text=document.createElementNS(ns,'text');text.setAttribute('x',x);text.setAttribute('y',y);text.textContent=counts[mask];text.classList.add('preset-count');svg.append(text);}
    [[60,25,'CET4'],[270,25,'CET6'],[180,307,'IELTS']].forEach(([x,y,t])=>{const text=document.createElementNS(ns,'text');text.setAttribute('x',x);text.setAttribute('y',y);text.textContent=t;text.classList.add('preset-count');svg.append(text);});container.append(svg);
    const buttons=document.createElement('div');buttons.className='preset-regions';container.append(buttons);
    controls.forEach(c=>{const b=document.createElement('button');b.type='button';b.textContent=`${labels[c.mask]} · ${counts[c.mask]}`;b.onclick=()=>toggle(c.mask);c.button=b;buttons.append(b);});
    const summary=document.createElement('p');summary.setAttribute('aria-live','polite');container.append(summary);
    const save=document.createElement('button');save.type='button';save.textContent='应用范围';save.onclick=async()=>{save.disabled=true;try{await request('/api/settings',{englishRegions:[...selected]},'PUT');active=true;render();summary.textContent+=' · 已保存，下一轮生效';}catch(e){summary.textContent=e.message;}finally{save.disabled=false;}};container.append(save);
    const clear=document.createElement('button');clear.type='button';clear.textContent='使用个人词本';clear.onclick=async()=>{await request('/api/settings',{englishRegions:null},'PUT');active=false;selected.clear();render();};container.append(clear);
    const source=document.createElement('p');source.className='preset-source';source.textContent='按 ECDICT 考试标签整理，并非官方大纲逐版核验；IELTS 为备考词表。';const a=document.createElement('a');a.href='./presets-SOURCES.txt';a.target='_blank';a.textContent=' 来源与许可';source.append(a);container.append(source);
    function toggle(mask){selected.has(mask)?selected.delete(mask):selected.add(mask);render();}
    function render(){controls.forEach(c=>{const on=selected.has(c.mask);c.shape.classList.toggle('selected',on);c.button.setAttribute('aria-pressed',String(on));});summary.textContent=`已选 ${rows.filter(r=>selected.has(r.mask)).length} 词${active?'':' · 当前使用个人词本'}`;}
    render();
  } catch(e){container.textContent=e.message;}
}
