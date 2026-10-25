import {randomUUID} from 'node:crypto';
export function createNotifications(db,mailProvider){
 db.exec(`CREATE TABLE IF NOT EXISTS change_notifications(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),subject TEXT NOT NULL,text TEXT NOT NULL,sent_at INTEGER,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT);`);
 function queue(before,after){
  if(['date','start','end','title','note','extra_info','cancelled'].every(k=>before[k]===after[k]))return;
  const action=after.cancelled?'Inställt':before.cancelled?'Bokningsbart igen':'Ändrat';
  const when=s=>`${s.date} kl. ${s.start}–${s.end}`;
  for(const u of db.prepare('SELECT u.id,u.name FROM bookings b JOIN users u ON u.id=b.user_id WHERE b.slot_id=? AND u.active=1').all(after.id)){
   const text=`Hej ${u.name}!\n\n${action}: ${after.title}\n${when(after)}\n${before.date!==after.date||before.start!==after.start||before.end!==after.end?'Tidigare tid: '+when(before)+'\n':''}\n${after.note}\n${after.extra_info||''}\n\n${after.cancelled?'Passet är inställt. Din anmälan finns kvar i historiken.':'Din bokning finns kvar.'}\nSe aktuell information i volontärportalen: ${mailProvider.appUrl()}`;
   db.prepare('INSERT INTO change_notifications(id,user_id,subject,text) VALUES(?,?,?,?)').run(randomUUID(),u.id,`${action}: ${after.title} ${after.date}`,text);
  }
 }
 let inFlight=null;
 async function execute(){
  if(!mailProvider.status().configured)return;
  for(const row of db.prepare('SELECT n.*,u.email FROM change_notifications n JOIN users u ON u.id=n.user_id WHERE n.sent_at IS NULL AND u.active=1 ORDER BY n.rowid').all()){
   try{await mailProvider.send({to:row.email,subject:row.subject,text:row.text,key:'katthem-change/'+row.id});db.prepare('UPDATE change_notifications SET sent_at=?,last_error=NULL,attempts=attempts+1 WHERE id=?').run(Date.now(),row.id)}
   catch{db.prepare('UPDATE change_notifications SET attempts=attempts+1,last_error=? WHERE id=?').run('Kunde inte skicka ändringsmejlet. Nytt försök görs automatiskt.',row.id)}
  }
 }
 function run(){if(!inFlight)inFlight=execute().finally(()=>{inFlight=null});return inFlight}
 function status(){return {pending:db.prepare('SELECT COUNT(*) n FROM change_notifications n JOIN users u ON u.id=n.user_id WHERE sent_at IS NULL AND u.active=1').get().n,failed:db.prepare('SELECT COUNT(*) n FROM change_notifications n JOIN users u ON u.id=n.user_id WHERE sent_at IS NULL AND last_error IS NOT NULL AND u.active=1').get().n}}
 return {queue,run,status,drain:()=>inFlight||Promise.resolve()};
}
