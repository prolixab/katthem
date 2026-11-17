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
    for(const [start,end,title] of shifts){
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

// Split future generated 16–20 Sunday shifts once. Keep historical/custom shifts intact.
export function upgradeSundayShifts(db,now=new Date()){
 db.exec('CREATE TABLE IF NOT EXISTS schedule_migrations(name TEXT PRIMARY KEY)');const migration='split-social-sunday-16-18-18-20-v1';if(db.prepare('SELECT 1 FROM schedule_migrations WHERE name=?').get(migration))return;
 db.exec('BEGIN IMMEDIATE');try{
  const extra=db.prepare('PRAGMA table_info(slots)').all().some(c=>c.name==='extra_info');
  const candidates=db.prepare("SELECT DISTINCT s.* FROM slots s JOIN schedule_origins o ON o.slot_id=s.id AND o.date=s.date AND o.start='16:00' WHERE s.kind='regular' AND s.date>=? AND s.start='16:00' AND s.end='20:00' AND s.title='Socialiseringsgruppen'").all(dateKey(now)).filter(s=>new Date(s.date+'T12:00').getDay()===0&&new Date(s.date+'T16:00')>now);
  for(const slot of candidates){
   let evening=db.prepare("SELECT s.id FROM schedule_origins o JOIN slots s ON s.id=o.slot_id WHERE o.date=? AND o.start='18:00' AND s.id<>? AND s.date=? AND s.start='18:00' AND s.end='20:00' AND s.title='Socialiseringsgruppen'").get(slot.date,slot.id,slot.date)?.id;
   if(!evening){const fields=['date','start','end','title','capacity','note','cancelled','kind',...(extra?['extra_info']:[])],values=[slot.date,'18:00','20:00',slot.title,0,slot.note,slot.cancelled,'regular',...(extra?[slot.extra_info]:[])];evening=Number(db.prepare('INSERT INTO slots('+fields.join(',')+') VALUES('+fields.map(()=>'?').join(',')+')').run(...values).lastInsertRowid)}
   db.prepare("UPDATE slots SET end='18:00' WHERE id=?").run(slot.id);
   db.prepare('INSERT INTO schedule_origins(date,start,slot_id) VALUES(?,?,?) ON CONFLICT(date,start) DO UPDATE SET slot_id=excluded.slot_id').run(slot.date,'18:00',evening);
   for(const booking of db.prepare('SELECT user_id FROM bookings WHERE slot_id=?').all(slot.id))if(!db.prepare('SELECT 1 FROM bookings WHERE user_id=? AND slot_id=?').get(booking.user_id,evening))db.prepare('INSERT INTO bookings(user_id,slot_id) VALUES(?,?)').run(booking.user_id,evening);
  }
  db.prepare('INSERT INTO schedule_migrations(name) VALUES(?)').run(migration);db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error}
}
