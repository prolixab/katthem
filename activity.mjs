export function monthAgo(now=new Date()){
 const date=new Date(now),day=date.getDate();date.setDate(1);date.setMonth(date.getMonth()-1);
 const lastDay=new Date(date.getFullYear(),date.getMonth()+1,0).getDate();date.setDate(Math.min(day,lastDay));return date.getTime();
}
export function isInactive(user,lastCompleted,now=new Date(),days=30){
 return user.role==='volunteer'&&Boolean(user.active)&&(lastCompleted??user.created_at)<=new Date(now).getTime()-days*86400000;
}

export function createActivitySettings(db){
 db.exec('CREATE TABLE IF NOT EXISTS activity_settings(id INTEGER PRIMARY KEY CHECK(id=1),inactive_days INTEGER NOT NULL DEFAULT 30 CHECK(inactive_days BETWEEN 1 AND 365),revision INTEGER NOT NULL DEFAULT 0);INSERT OR IGNORE INTO activity_settings(id) VALUES(1)');
 const get=()=>db.prepare('SELECT inactive_days,revision FROM activity_settings WHERE id=1').get();
 function save(p){
  if(!p||Object.keys(p).some(k=>!['inactive_days','revision'].includes(k))||!Number.isInteger(p.inactive_days)||p.inactive_days<1||p.inactive_days>365||!Number.isInteger(p.revision))throw Object.assign(Error('Ange ett heltal mellan 1 och 365 dagar.'),{status:400});
  const result=db.prepare('UPDATE activity_settings SET inactive_days=?,revision=revision+1 WHERE id=1 AND revision=?').run(p.inactive_days,p.revision);
  if(!result.changes)throw Object.assign(Error('Uppföljningsgränsen har ändrats av någon annan. Uppdatera sidan innan du sparar.'),{status:409});return get();
 }
 return {get,save};
}
