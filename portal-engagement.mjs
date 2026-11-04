import {createEngagement} from './engagement.mjs';
// The registry joins only proven account links. Matching e-mail addresses never establish identity.
export function createPortalEngagement(registry,{workers,houses,now=()=>Date.now()}){
 registry.exec('PRAGMA secure_delete=ON;CREATE TABLE IF NOT EXISTS volunteer_credits(person TEXT PRIMARY KEY,completed INTEGER NOT NULL DEFAULT 0)');
 const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
 const service=home=>createEngagement(workers.get(home).db,{now});
 function cluster(home,id){const found=new Map([[home+':'+id,{home,id}]]);let changed=true;while(changed){changed=false;for(const x of [...found.values()]){const person=registry.prepare('SELECT person FROM volunteer_lineage WHERE home=? AND user_id=?').get(x.home,x.id)?.person;const links=[...registry.prepare('SELECT target home,local_id id FROM shadows WHERE source=? AND user_id=?').all(x.home,x.id),...registry.prepare('SELECT source home,user_id id FROM shadows WHERE target=? AND local_id=?').all(x.home,x.id),...(person?registry.prepare('SELECT home,user_id id FROM volunteer_lineage WHERE person=?').all(person):[])];for(const y of links)if(!found.has(y.home+':'+y.id)){found.set(y.home+':'+y.id,y);changed=true}}}return [...found.values()].filter(x=>workers.has(x.home))}
 function update(home,id,p,{self=false}={}){
  const entries=p.scope==='all'?cluster(home,id).filter(x=>!registry.prepare('SELECT 1 FROM retired_accounts WHERE home=? AND user_id=?').get(x.home,x.id)&&service(x.home).get(x.id)?.status!=='purged'):[{home,id}];
  if(!['one','all',undefined].includes(p.scope))fail('Välj ett katthem eller hela föreningen.');
  // Validate every home before any write; no awaited operations occur between validation and writes.
  for(const x of entries){const e=service(x.home),s=e.get(x.id);if(!s||s.status==='purged')fail('Engagemanget finns inte.',404);if(self&&(p.status==='inactive'||s.status==='inactive'&&p.status==='active'))fail('Kontakta admin för återaktivering.',403);if(['paused','ended'].includes(p.status)&&e.pending([x.id]).length)fail('Kontrollera och avboka kommande och pågående pass i samtliga berörda katthem först.',409)}
  // Attach up to SQLite's supported transaction limit. Larger organizations can change one home at a time.
  if(entries.length>10)fail('Ändra ett katthem i taget när fler än tio katthem berörs.');
  const plans=entries.map(x=>{const e=service(x.home),s=e.get(x.id);if(x.home===home&&x.id===id&&s.revision!==p.revision)fail('Status har ändrats. Öppna formuläret igen.',409);return {...validatedStatus(e,s,p,self),revision:s.revision,returning:s.status==='ended'&&p.status==='active'}});
  for(const [i,x] of entries.entries())registry.prepare('ATTACH DATABASE ? AS life'+i).run(workers.get(x.home).db.location());
  try{registry.exec('BEGIN IMMEDIATE');try{for(const [i,x] of entries.entries()){
   const r=plans[i],a='life'+i;
   const actual=registry.prepare('SELECT status,revision FROM '+a+'.engagements WHERE user_id=?').get(x.id);if(actual.revision!==r.revision||actual.status==='purged')fail('Engagemanget har ändrats. Öppna formuläret igen.',409);
   if(['paused','ended'].includes(p.status)&&registry.prepare('SELECT s.date,s.end FROM '+a+'.bookings b JOIN '+a+'.slots s ON s.id=b.slot_id WHERE b.user_id=? AND s.cancelled=0').all(x.id).some(s=>new Date(s.date+'T'+s.end)>now()))fail('Nya bokningar har tillkommit. Kontrollera samtliga pass först.',409);
   registry.prepare('UPDATE '+a+'.engagements SET status=?,review_at=?,ended_at=?,purge_after=?,warning_at=?,changed_at=?,revision=revision+1 WHERE user_id=?').run(r.status,r.review_at,r.ended_at,r.purge_after,r.warning_at,now(),x.id);
   registry.prepare('UPDATE '+a+'.member_profiles SET status=?,revision=revision+1,updated_at=? WHERE user_id=?').run(p.status==='inactive'?'paused':p.status,now(),x.id);
   if(p.status!=='active')registry.prepare('DELETE FROM '+a+'.calendar_subscriptions WHERE user_id=?').run(x.id);
   if(r.returning){registry.prepare('UPDATE '+a+'.engagements SET needs_intro=1,practical_completed=0,independent_approved=0,routine_version=0,routine_accepted_at=NULL WHERE user_id=?').run(x.id);registry.prepare('DELETE FROM '+a+'.checklist_progress WHERE user_id=?').run(x.id);}
  }registry.exec('COMMIT')}catch(e){registry.exec('ROLLBACK');throw e}}finally{for(const [i] of entries.entries())registry.exec('DETACH DATABASE life'+i)}
  return {ok:true};
 }
 function validatedStatus(e,s,p,self){
  if(!['active','paused','inactive','ended'].includes(p.status)||!Number.isInteger(p.revision))fail('Välj status och öppna formuläret igen.');
  let review_at=null;if(p.status==='paused'){if(typeof p.review_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(p.review_date))fail('Välj datum för uppföljning.');review_at=Date.parse(p.review_date+'T12:00:00Z');if(!Number.isFinite(review_at)||new Date(review_at).toISOString().slice(0,10)!==p.review_date||review_at<=now())fail('Välj ett giltigt framtida uppföljningsdatum.');}
  const ended_at=p.status==='ended'?(s.status==='ended'?s.ended_at:now()):null;
  return {status:p.status,review_at,ended_at,purge_after:ended_at===null?null:addMonths(ended_at,3),warning_at:ended_at===null?null:Math.min(addMonths(ended_at,2)+14*86400000,addMonths(ended_at,3))};
 }
 function purge(){
  for(const h of houses())for(const row of service(h.id).due()){
   const db=workers.get(h.id).db,e=service(h.id),links=cluster(h.id,row.user_id);
   const others=links.filter(x=>x.home!==h.id||x.id!==row.user_id).filter(x=>{const s=service(x.home).get(x.id);return s&&s.status!=='purged'});
   const anchor=!registry.prepare('SELECT 1 FROM shadows WHERE target=? AND local_id=?').get(h.id,row.user_id)&&!registry.prepare('SELECT 1 FROM retired_accounts WHERE home=? AND user_id=?').get(h.id,row.user_id);
   const keepIdentity=new Set(anchor&&others.length?[row.user_id]:[]);
   // Retain only anonymous totals when a continuing volunteer still needs their experience count.
   const person=registry.prepare('SELECT person FROM volunteer_lineage WHERE home=? AND user_id=?').get(h.id,row.user_id)?.person;
   const completed=db.prepare('SELECT s.date,s.end FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.user_id=? AND s.cancelled=0').all(row.user_id).filter(s=>new Date(s.date+'T'+s.end)<=now()).length;
   db.prepare('ATTACH DATABASE ? AS lifecycle_registry').run(registry.location());
   try{db.exec('PRAGMA secure_delete=ON;PRAGMA lifecycle_registry.secure_delete=ON;BEGIN IMMEDIATE');try{
    const fresh=e.get(row.user_id);if(fresh.status!=='ended'||fresh.purge_after>now()||fresh.held){db.exec('COMMIT');continue}
    e.erase([row.user_id],{keepIdentity});
    if(person&&others.length)db.prepare('INSERT INTO lifecycle_registry.volunteer_credits VALUES(?,?) ON CONFLICT(person) DO UPDATE SET completed=completed+excluded.completed').run(person,completed);
    db.prepare('DELETE FROM lifecycle_registry.shadow_profile_sync WHERE (source=? AND user_id=?) OR (target=? AND user_id IN (SELECT user_id FROM lifecycle_registry.shadows WHERE target=? AND local_id=?))').run(h.id,row.user_id,h.id,h.id,row.user_id);
    db.exec('COMMIT');
   }catch(error){db.exec('ROLLBACK');throw error}}finally{db.exec('DETACH DATABASE lifecycle_registry')}
  }
  // Sweep on every run as well: an interruption after the per-home commit must not leave an auth anchor behind.
  const visited=new Set();
  for(const h of houses())for(const r of workers.get(h.id).db.prepare("SELECT user_id FROM engagements WHERE status='purged'").all()){
   const links=cluster(h.id,r.user_id);if(links.some(x=>service(x.home).get(x.id)?.status!=='purged'))continue;
   for(const x of links){const key=x.home+':'+x.id;if(visited.has(key))continue;visited.add(key);
    const wd=workers.get(x.home).db,u=wd.prepare('SELECT active,name FROM users WHERE id=?').get(x.id);
    if(u&&(u.active||u.name!=='Raderad volontär')){const erasing=service(x.home);wd.exec('PRAGMA secure_delete=ON;BEGIN IMMEDIATE');try{erasing.erase([x.id]);wd.exec('COMMIT')}catch(error){wd.exec('ROLLBACK');throw error}}
    const person=registry.prepare('SELECT person FROM volunteer_lineage WHERE home=? AND user_id=?').get(x.home,x.id)?.person;
    registry.prepare('DELETE FROM portal_sessions WHERE source=? AND user_id=?').run(x.home,x.id);
    registry.prepare('DELETE FROM grants WHERE (source=? AND user_id=?) OR (target=? AND source IN (SELECT source FROM shadows WHERE target=? AND local_id=?) AND user_id IN (SELECT user_id FROM shadows WHERE target=? AND local_id=?))').run(x.home,x.id,x.home,x.home,x.id,x.home,x.id);
    registry.prepare('DELETE FROM portal_news_dismissals WHERE source=? AND user_id=?').run(x.home,x.id);
    registry.prepare('DELETE FROM shadow_profile_sync WHERE (source=? AND user_id=?) OR (target=? AND source IN (SELECT source FROM shadows WHERE target=? AND local_id=?) AND user_id IN (SELECT user_id FROM shadows WHERE target=? AND local_id=?))').run(x.home,x.id,x.home,x.home,x.id,x.home,x.id);
    registry.prepare('DELETE FROM volunteer_transfers WHERE (source=? AND source_id=?) OR (target=? AND target_id=?)').run(x.home,x.id,x.home,x.id);
    if(person)registry.prepare('DELETE FROM volunteer_credits WHERE person=?').run(person);
   }
   for(const x of links){registry.prepare('DELETE FROM shadows WHERE (source=? AND user_id=?) OR (target=? AND local_id=?)').run(x.home,x.id,x.home,x.id);registry.prepare('DELETE FROM volunteer_lineage WHERE home=? AND user_id=?').run(x.home,x.id);registry.prepare('DELETE FROM retired_accounts WHERE home=? AND user_id=?').run(x.home,x.id);}
  }
 }

 return {update,purge,cluster};
}
import {addMonths} from './engagement.mjs';
