const dateKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const shifts=[['08:00','12:00','Morgonpass'],['16:00','18:00','Eftermiddagspass'],['18:00','20:00','Kvällspass']];
export function createSchedule(db,sundayRules){
 // Remember the original position even when an administrator moves a shift.
 const existingTable=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schedule_origins'").get();
 db.exec('CREATE TABLE IF NOT EXISTS schedule_origins(date TEXT NOT NULL,start TEXT NOT NULL,slot_id INTEGER NOT NULL REFERENCES slots(id),PRIMARY KEY(date,start))');
 if(!existingTable)db.exec("INSERT OR IGNORE INTO schedule_origins SELECT date,start,MIN(id) FROM slots WHERE kind='regular' AND start IN ('08:00','16:00','18:00') GROUP BY date,start");
 function ensure(now=new Date()){
  const first=new Date(now);first.setHours(12,0,0,0);
  upgradeSundayShifts(db,first);
  db.exec('BEGIN IMMEDIATE');
  try{
   for(let day=0;day<42;day++){
    const d=new Date(first);d.setDate(d.getDate()+day);const date=dateKey(d);
    const social=sundayRules(date,'16:00','18:00','Eftermiddagspass','');
    for(const [start,end,title] of shifts){
     if(start==='18:00'&&social.end==='20:00')continue;
     if(db.prepare('SELECT 1 FROM schedule_origins WHERE date=? AND start=?').get(date,start))continue;
     const existing=db.prepare("SELECT id FROM slots WHERE date=? AND start=? AND kind='regular' AND id NOT IN (SELECT slot_id FROM schedule_origins) ORDER BY id LIMIT 1").get(date,start);
     let id=existing?.id;
     if(!id){const rule=sundayRules(date,start,end,title,start==='08:00'?'Mat, rent vatten och en lugn start för katterna.':'Mat, städning och en stunds sällskap.');id=db.prepare("INSERT INTO slots(date,start,end,title,capacity,note,cancelled,kind) VALUES(?,?,?,?,0,?,?,'regular')").run(date,rule.start||start,rule.end||end,rule.title,rule.note,rule.cancelled).lastInsertRowid}
     db.prepare('INSERT INTO schedule_origins(date,start,slot_id) VALUES(?,?,?)').run(date,start,id);
    }
   }
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e}
 }
 return {ensure};
}

// Future generated Sunday shifts become a single 16–20 shift. Keep past/custom shifts intact.
export function upgradeSundayShifts(db,now=new Date()){
 const today=dateKey(now);
 const candidates=db.prepare("SELECT s.* FROM slots s JOIN schedule_origins o ON o.slot_id=s.id AND o.date=s.date AND o.start=s.start WHERE s.kind='regular' AND s.date>=? AND s.start='18:00' AND s.end='20:00' AND s.title='Socialiseringsgruppen' AND s.cancelled=0").all(today).filter(s=>new Date(s.date+'T12:00').getDay()===0);
 for(const evening of candidates){
  const afternoon=db.prepare("SELECT s.* FROM slots s JOIN schedule_origins o ON o.slot_id=s.id AND o.date=s.date AND o.start=s.start WHERE s.date=? AND s.start='16:00' AND s.end='18:00' AND s.kind='regular' AND s.title IN ('Eftermiddagspass','Inställt – öppet hus')").get(evening.date);
  if(!afternoon||(afternoon.cancelled&&afternoon.title!=='Inställt – öppet hus')||new Date(evening.date+'T16:00')<=now)continue;
  db.exec('BEGIN IMMEDIATE');try{
   // Preserve booking IDs except duplicate participation by the same volunteer.
   for(const b of db.prepare('SELECT * FROM bookings WHERE slot_id=?').all(afternoon.id)){
    if(db.prepare('SELECT id FROM bookings WHERE slot_id=? AND user_id=?').get(evening.id,b.user_id))db.prepare('DELETE FROM bookings WHERE id=?').run(b.id);
    else db.prepare('UPDATE bookings SET slot_id=? WHERE id=?').run(evening.id,b.id);
   }
   if(afternoon.note&&!['Mat, städning och en stunds sällskap.','Öppet hus första söndagen i månaden. Passet 16–18 är inställt.','Öppet hus'].includes(afternoon.note)&&afternoon.note!==evening.note)db.prepare('UPDATE slots SET note=? WHERE id=?').run([evening.note,afternoon.note].filter(Boolean).join('\n'),evening.id);
   const extra=db.prepare('PRAGMA table_info(slots)').all().some(c=>c.name==='extra_info');
   if(extra&&afternoon.extra_info)db.prepare('UPDATE slots SET extra_info=? WHERE id=?').run([evening.extra_info,afternoon.extra_info].filter(Boolean).join('\n'),evening.id);
   db.prepare('UPDATE schedule_origins SET slot_id=? WHERE slot_id=?').run(evening.id,afternoon.id);
   db.prepare('DELETE FROM slots WHERE id=?').run(afternoon.id);
   db.prepare("UPDATE slots SET start='16:00',end='20:00' WHERE id=?").run(evening.id);
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e}
 }
}
