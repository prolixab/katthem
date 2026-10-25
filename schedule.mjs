const dateKey=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const shifts=[['08:00','12:00','Morgonpass'],['16:00','18:00','Eftermiddagspass'],['18:00','20:00','Kvällspass']];
export function createSchedule(db,sundayRules){
 // Remember the original position even when an administrator moves a shift.
 const existingTable=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schedule_origins'").get();
 db.exec('CREATE TABLE IF NOT EXISTS schedule_origins(date TEXT NOT NULL,start TEXT NOT NULL,slot_id INTEGER NOT NULL REFERENCES slots(id),PRIMARY KEY(date,start))');
 if(!existingTable)db.exec("INSERT OR IGNORE INTO schedule_origins SELECT date,start,MIN(id) FROM slots WHERE kind='regular' AND start IN ('08:00','16:00','18:00') GROUP BY date,start");
 function ensure(now=new Date()){
  const first=new Date(now);first.setHours(12,0,0,0);
  db.exec('BEGIN IMMEDIATE');
  try{
   for(let day=0;day<42;day++){
    const d=new Date(first);d.setDate(d.getDate()+day);const date=dateKey(d);
    for(const [start,end,title] of shifts){
     if(db.prepare('SELECT 1 FROM schedule_origins WHERE date=? AND start=?').get(date,start))continue;
     const existing=db.prepare("SELECT id FROM slots WHERE date=? AND start=? AND kind='regular' AND id NOT IN (SELECT slot_id FROM schedule_origins) ORDER BY id LIMIT 1").get(date,start);
     let id=existing?.id;
     if(!id){const rule=sundayRules(date,start,end,title,start==='08:00'?'Mat, rent vatten och en lugn start för katterna.':'Mat, städning och en stunds sällskap.');id=db.prepare("INSERT INTO slots(date,start,end,title,capacity,note,cancelled,kind) VALUES(?,?,?,?,0,?,?,'regular')").run(date,start,end,rule.title,rule.note,rule.cancelled).lastInsertRowid}
     db.prepare('INSERT INTO schedule_origins(date,start,slot_id) VALUES(?,?,?)').run(date,start,id);
    }
   }
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e}
 }
 return {ensure};
}
