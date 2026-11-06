const $ = (id) => document.getElementById(id);
const sections = ['Programs','Setup','Ingredients','Manual modes','Recipes','Troubleshooting','Care','Manual pages'];
const pdf = (page) => '/bistro/sources/manual.pdf#page=' + page;
function element(tag, text, cls) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}
function link(title, url) {
  const node = element('a', title);
  node.href = url;
  return node;
}
async function start() {
  const response = await fetch('manual.json');
  if (!response.ok) throw Error('load');
  const entries = await response.json();
  let category = 'Programs', active = null;
  const input = $('search'), list = $('list'), panel = $('detail');
  function select(item, focus) {
    active = item;
    for (const row of list.children) row.setAttribute('aria-current', String(entries[row.dataset.index] === item));
    panel.replaceChildren();
    if (!item) { panel.append(element('p','Search for another program, ingredient or symptom.')); return; }
    const back = element('button','← Results'); back.id = 'back';
    back.onclick = () => { document.body.classList.remove('reading'); list.querySelector('[aria-current=true]')?.focus(); };
    panel.append(back,element('small',item.program ? 'Program ' + item.program : item.category),element('h2',item.title));
    if (item.time) panel.append(element('p','Approx. ' + item.time,'time'));
    if (item.img) { const img = element('img'); img.src = '../images/'+item.img+'.webp'; img.alt=item.title+' from the translated manual'; panel.append(img); }
    if (item.body.length) {
      const lines = element(item.guide ? 'ol' : 'ul');
      for (const line of item.body) lines.append(element('li',line));
      panel.append(lines);
    }
    if (item.sourcePage) panel.append(element('p','Read this spread in its original layout to see the instructions, diagrams and table columns together.'));
    if (item.recipes?.length) {
      panel.append(element('h3',item.recipe?'Recipe instructions':'Recipes and operating guides'));
      for (const [name,id] of item.recipes) { const row=element('div'); row.append(link(name+' →','/bistro?view=recipes&recipe='+encodeURIComponent(id))); panel.append(row); }
    }
    const citation = element('div',null,'citation');
    citation.append(link('Instruction manual · PDF p. '+item.page+' ↗',pdf(item.page)));
    if(item.program && item.body.some(line=>line.startsWith('Timer finish'))) citation.append(document.createElement('br'),link('Timer conditions · PDF p. 13 ↗',pdf(13)),document.createElement('br'),link('Ingredient restrictions · PDF p. 11 ↗',pdf(11)));
    panel.append(citation);
    if (focus) { document.body.classList.add('reading'); panel.focus(); }
  }
  function render() {
    const query=input.value.trim().toLowerCase();
    const effective=category;
    const results=entries.filter(item=>{
      if(effective!=='All' && item.category!==effective) return false;
      if (!query) return true;
      if (/^h\d{2}$/.test(query) && query!=='h00' && item.title.startsWith('H01–H99')) return true;
      const hay=[item.title,item.program?'program '+item.program:'',item.time,...item.body,item.index||''].join(' ').toLowerCase();
      return query.split(/\s+/).every(word=>hay.includes(word));
    });
    results.sort((a,b)=> Number(!!a.sourcePage)-Number(!!b.sourcePage) || Number(!a.title.toLowerCase().includes(query))-Number(!b.title.toLowerCase().includes(query)));
    $('listTitle').textContent=query?'Search results':effective;
    $('count').textContent=results.length+' '+(results.length===1?'entry':'entries');
    list.replaceChildren(); document.body.classList.remove('reading');
    for(const item of results) {
      const button=element('button',null,'row'); button.dataset.index=String(entries.indexOf(item));
      const name=element('span');name.append(element('small',item.program?'Program '+item.program:item.category),document.createTextNode(item.title));
      button.append(name,element('span','›')); button.onclick=()=>select(item,true);list.append(button);
    }
    if(!results.length) list.append(element('p','No matches. Try a shorter search or select All.'));
    select(results.includes(active)?active:results[0],false);
    for(const tab of $('filters').children)tab.setAttribute('aria-pressed',String(tab.textContent===category));
  }
  for(const name of ['All',...sections]) { const tab=element('button',name);tab.onclick=()=>{category=name;active=null;render();};$('filters').append(tab); }
  input.oninput=()=>{category=input.value.trim()?'All':'Programs';active=null;render();};
  const program = new URLSearchParams(location.search).get('program');
  if (program === 'Manual') category = 'Manual modes';
  else if (program) active = entries.find(item => item.program === program);
  render();
  if (program && active) select(active, true);
}
start().catch(()=>{$('count').textContent='The handbook could not load. Reload this page to try again.';});
