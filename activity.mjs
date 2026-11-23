import {createHash,randomUUID} from 'node:crypto';

export function monthAgo(now=new Date()){
 const date=new Date(now),day=date.getDate();date.setDate(1);date.setMonth(date.getMonth()-1);
 const lastDay=new Date(date.getFullYear(),date.getMonth()+1,0).getDate();date.setDate(Math.min(day,lastDay));return date.getTime();
}
export function isInactive(user,lastCompleted,now=new Date(),days=30){
 return user.role==='volunteer'&&Boolean(user.active)&&(lastCompleted??user.created_at)<=new Date(now).getTime()-days*86400000;
}

export function createActivitySettings(db){
 db.exec('CREATE TABLE IF NOT EXISTS activity_settings(id INTEGER PRIMARY KEY CHECK(id=1),inactive_days INTEGER NOT NULL DEFAULT 30 CHECK(inactive_days BETWEEN 1 AND 365),revision INTEGER NOT NULL DEFAULT 0);INSERT OR IGNORE INTO activity_settings(id) VALUES(1)');
 db.exec('UPDATE activity_settings SET inactive_days=CASE WHEN inactive_days<=30 THEN 30 WHEN inactive_days<=60 THEN 60 ELSE 90 END,revision=revision+1 WHERE inactive_days NOT IN (30,60,90)');
 const get=()=>db.prepare('SELECT inactive_days,revision FROM activity_settings WHERE id=1').get();
 function save(p){
  if(!p||Object.keys(p).some(k=>!['inactive_days','revision'].includes(k))||![30,60,90].includes(p.inactive_days)||!Number.isInteger(p.revision))throw Object.assign(Error('Välj 30, 60 eller 90 dagar.'),{status:400});
  const result=db.prepare('UPDATE activity_settings SET inactive_days=?,revision=revision+1 WHERE id=1 AND revision=?').run(p.inactive_days,p.revision);
  if(!result.changes)throw Object.assign(Error('Uppföljningsgränsen har ändrats av någon annan. Uppdatera sidan innan du sparar.'),{status:409});return get();
 }
 return {get,save};
}

export function createActivityFollowup(db,{mailProvider,lastCompleted,shelterName,now=Date.now}){
 db.exec(`CREATE TABLE IF NOT EXISTS activity_followup_settings(id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 0);
 INSERT OR IGNORE INTO activity_followup_settings(id) VALUES(1);
 CREATE TABLE IF NOT EXISTS activity_followup_delivery(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,anchor INTEGER NOT NULL,
 delivery_key TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0,sent_at INTEGER,confirmed_at INTEGER)`);
 const settings=()=>db.prepare('SELECT enabled,revision FROM activity_followup_settings WHERE id=1').get();
 const getDelivery=id=>db.prepare('SELECT * FROM activity_followup_delivery WHERE user_id=?').get(id);
 function people(){
  const counts=lastCompleted(),time=now();
  return db.prepare(`SELECT u.id,u.name,u.email,u.active,u.role,u.created_at,e.status
   FROM users u JOIN engagements e ON e.user_id=u.id WHERE e.status<>'purged' ORDER BY u.name COLLATE NOCASE,u.id`).all().map(user=>{
   const anchor=counts.get(user.id)??user.created_at,delivery=getDelivery(user.id);
   const eligible=user.status==='active'&&isInactive(user,anchor,time,60)&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)&&!/(?:\.local|\.invalid)$/i.test(user.email);
   return {user,anchor,delivery,eligible};
  });
 }
 function preview(){
  const rows=people();
  const recipients=rows.filter(({eligible,anchor,delivery})=>eligible&&(!delivery||anchor>delivery.anchor||(!delivery.sent_at&&delivery.attempts<6)));
  return {recipients,signature:createHash('sha256').update(JSON.stringify(recipients.map(({user,anchor})=>[user.id,user.email,anchor]))).digest('hex'),rows};
 }
 function status(){
  const {recipients,signature,rows}=preview();
  return {...settings(),signature,email_ready:mailProvider.status().configured,
   recipients:recipients.map(({user})=>({id:user.id,name:user.name,email:user.email})),
   history:rows.filter(({delivery})=>delivery?.attempts).map(({user,delivery})=>({
    id:user.id,name:user.name,sent_at:delivery.sent_at,confirmed_at:delivery.confirmed_at,failed:!delivery.sent_at&&delivery.attempts>=6,
    engagement_status:user.status
   }))};
 }
 function fail(message,status=400){throw Object.assign(Error(message),{status})}
 function save(p){
  if(typeof p?.enabled!=='boolean'||!Number.isInteger(p.revision))fail('Välj om 60-dagarsmejl ska aktiveras.');
  const current=settings();
  if(p.revision!==current.revision)fail('Inställningen har ändrats. Hämta uppföljningen igen.',409);
  if(p.enabled&&!current.enabled){
   if(!mailProvider.status().configured)fail('Aktivera katthemmets e-post innan du slår på 60-dagarsmejl.');
   if(p.signature!==preview().signature)fail('Mottagarlistan har ändrats. Hämta förhandsgranskningen igen.',409);
  }
  db.prepare('UPDATE activity_followup_settings SET enabled=?,revision=revision+1 WHERE id=1').run(Number(p.enabled));
  return status();
 }
 function own(id){
  const row=getDelivery(id);
  return row?.sent_at?{sent_at:row.sent_at,confirmed_at:row.confirmed_at}:null;
 }
 function confirm(id,sentAt){
  const result=db.prepare(`UPDATE activity_followup_delivery SET confirmed_at=COALESCE(confirmed_at,?)
   WHERE user_id=? AND sent_at=? AND EXISTS(SELECT 1 FROM users u JOIN engagements e ON e.user_id=u.id
   WHERE u.id=? AND u.active=1 AND u.role='volunteer' AND e.status='active')`).run(now(),id,sentAt??null,id);
  if(!result.changes)fail('Uppföljningen har ändrats. Ladda om Mitt konto.',409);
  return own(id);
 }
 let inFlight=null;
 async function execute(){
  if(!settings().enabled||!mailProvider.status().configured)return;
  const link=new URL(mailProvider.appUrl());
  link.hash='engagemang';
  let attempted=0;
  for(const {user,anchor} of preview().recipients){
   if(attempted>=10||!settings().enabled||!mailProvider.status().configured)break;
   const current=db.prepare('SELECT u.name,u.email,u.active,u.role,e.status FROM users u JOIN engagements e ON e.user_id=u.id WHERE u.id=?').get(user.id);
   if(!current?.active||current.role!=='volunteer'||current.status!=='active'||current.email!==user.email)continue;
   const time=now();
   db.prepare(`INSERT INTO activity_followup_delivery(user_id,anchor,delivery_key) VALUES(?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET anchor=excluded.anchor,delivery_key=excluded.delivery_key,attempts=0,next_attempt=0,sent_at=NULL,confirmed_at=NULL
    WHERE excluded.anchor>activity_followup_delivery.anchor`).run(user.id,anchor,randomUUID());
   const delivery=getDelivery(user.id);
   if(delivery.sent_at||delivery.attempts>=6||delivery.next_attempt>time)continue;
   const claim=db.prepare('UPDATE activity_followup_delivery SET attempts=attempts+1,next_attempt=? WHERE user_id=? AND delivery_key=? AND sent_at IS NULL AND next_attempt<=? AND attempts<6').run(time+300000,user.id,delivery.delivery_key,time);
   if(!claim.changes)continue;
   attempted++;
   try{
    await mailProvider.send({
     to:current.email,subject:'Vill du fortsätta som volontär på '+shelterName()+'?',
     text:`Hej ${current.name}!\n\nDet har gått ett tag utan ett avslutat bokat pass. Vill du fortsätta som volontär på ${shelterName()}?\n\nLogga in i Tassportalen och svara under Mitt engagemang. Där kan du också välja att pausa eller avsluta ditt engagemang.\n${link.href}\n\nHälsningar\nKatthemmets volontärsamordning`,
     key:'tassportalen-activity/'+delivery.delivery_key
    });
    db.prepare('UPDATE activity_followup_delivery SET sent_at=? WHERE user_id=? AND delivery_key=?').run(now(),user.id,delivery.delivery_key);
   }catch{} // Fel visas i uppföljningen efter sista försöket.
  }
 }
 function run(){if(!inFlight)inFlight=execute().finally(()=>{inFlight=null});return inFlight}
 return {status,save,own,confirm,run,drain:()=>inFlight||Promise.resolve()};
}
