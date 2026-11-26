import {parseVolunteersCsv} from './csv-import.mjs';
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
const normal=value=>String(value).normalize('NFKC').trim().toLocaleLowerCase('sv-SE').replace(/\s+/g,' ').replace(/\s*\/\s*/g,'/');
const quote=value=>'"'+String(value??'').replaceAll('"','""')+'"';
function csv(rows){return ['namn;e-post;lösenord;grön',...rows.map(e=>[e.name,e.email,e.password,e.green?'ja':'nej'].map(quote).join(';'))].join('\n')}
export function planShelterImport(p,{homes,selected,global=false}){
 if(!p||typeof p.green!=='boolean'||!['selected','distributed'].includes(p.mode??'selected'))fail('Kontrollera importens inställningar.');
 const mode=p.mode??'selected';if(mode==='distributed'&&!global)fail('Endast superadmin kan fördela import mellan katthem.',403);
 const choices=mode==='distributed'?homes:homes.filter(h=>h.id===selected);if(!choices.length)fail('Välj ett katthem.',403);
 const mapping=p.mapping??{};if(!mapping||Array.isArray(mapping)||typeof mapping!=='object'||Object.values(mapping).some(v=>v!=='skip'&&!choices.some(h=>h.id===v)))fail('Välj ett tillåtet katthem för varje okänt värde.',403);
 let entries;try{entries=parseVolunteersCsv(p.csv)}catch(error){fail(error.message)}
 const find=value=>{const n=normal(value);if(!n)return null;const exact=homes.filter(h=>normal(h.id)===n||normal(h.name)===n);if(exact.length===1)return exact[0];if(['jönköping','huskvarna','huskvarna/jönköping'].includes(n))return homes.find(h=>['huskvarna','huskvarna/jönköping','huskvarna katthem'].includes(normal(h.name)))||null;return null};
 const groups=new Map(),unresolved=new Map(),skipped=[],seen=new Set();
 entries.forEach((entry,index)=>{
  const row=index+2,label=(entry.shelter||'').trim(),known=find(label);let home=known;
  if(!known){if(Object.hasOwn(mapping,label)){if(mapping[label]==='skip'){skipped.push({row,name:entry.name,email:entry.email,reason:'user_skip',shelter_name:label});return}home=choices.find(h=>h.id===mapping[label])}else{const problem=unresolved.get(label)||{value:label,rows:[]};problem.rows.push(row);unresolved.set(label,problem);return}}
  if(mode==='selected'&&home.id!==selected){skipped.push({row,name:entry.name,email:entry.email,reason:'other_shelter',shelter_name:home.name});return}
  if(seen.has(entry.email)){skipped.push({row,name:entry.name,email:entry.email,reason:'duplicate',shelter_name:home.name});return}seen.add(entry.email);
  if(!groups.has(home.id))groups.set(home.id,{home,rows:[]});groups.get(home.id).rows.push({...entry,row,green:p.green||entry.green});
 });
 return {groups:[...groups.values()],skipped,unresolved:[...unresolved.values()],homes:choices,total:entries.length};
}
export async function previewShelterImport(p,context,request){
 const plan=planShelterImport(p,context),users=[],skipped=[...plan.skipped],batches=[];
 for(const group of plan.groups){const payload={csv:csv(group.rows),green:false},result=await request(group.home.id,'import-preview',payload),skipRows=new Set(result.skipped.map(e=>e.row));
  for(const e of result.skipped)skipped.push({...e,row:group.rows[e.row-2].row,shelter_id:group.home.id,shelter_name:group.home.name});
  group.rows.forEach((e,index)=>{if(!skipRows.has(index+2))users.push({row:e.row,name:e.name,email:e.email,green:e.green,shelter_id:group.home.id,shelter_name:group.home.name})});
  batches.push({...group,payload});
 }
 users.sort((a,b)=>a.row-b.row);skipped.sort((a,b)=>a.row-b.row);
 return {batches,preview:{users,skipped,unresolved:plan.unresolved,homes:plan.homes,total:plan.total}};
}
export async function executeShelterImport(p,context,request){
 const prepared=await previewShelterImport(p,context,request);if(prepared.preview.unresolved.length)fail('Välj katthem eller Hoppa över för rader med saknat eller okänt katthem innan import.',409);
 let imported=0;const skipped=prepared.preview.skipped.filter(e=>['other_shelter','user_skip','duplicate'].includes(e.reason)&&!e.shelter_id),results=[],errors=[];
 for(const batch of prepared.batches){try{const response=await request(batch.home.id,'import',batch.payload),result=response.import_result;imported+=result.imported;for(const e of result.skipped)skipped.push({...e,row:batch.rows[e.row-2].row,shelter_id:batch.home.id,shelter_name:batch.home.name});results.push({shelter_id:batch.home.id,shelter_name:batch.home.name,imported:result.imported})}catch(error){errors.push({shelter_id:batch.home.id,shelter_name:batch.home.name,error:error.message})}}
 skipped.sort((a,b)=>a.row-b.row);return {imported,skipped,total:prepared.preview.total,results,errors};
}
