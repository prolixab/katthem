// Upgrade only the original generated shifts. Existing IDs and bookings are retained.
export function upgradeDefaultShifts(db,rules){
 const migration='default-shifts-08-12-16-18-18-20-v1';
 if(db.prepare('SELECT name FROM migrations WHERE name=?').get(migration))return false;
 db.exec('BEGIN IMMEDIATE');
 try{
  const old=db.prepare("SELECT * FROM slots WHERE kind='regular' AND ((start='08:00' AND end='10:00' AND title='Morgonpass' AND note='Mat, rent vatten och en lugn start för katterna.') OR (start='17:00' AND end='19:00' AND ((title='Kvällspass' AND note='Mat, städning och en stunds sällskap.') OR (title='Inställt – öppet hus' AND note='Öppet hus första söndagen i månaden. Passet 16–18 är inställt.'))))").all();
  const update=db.prepare('UPDATE slots SET start=?,end=?,title=?,note=?,cancelled=?,capacity=0 WHERE id=?');
  for(const slot of old){const morning=slot.start==='08:00',start=morning?'08:00':'18:00',end=morning?'12:00':'20:00';const rule=rules(slot.date,start,end,morning?'Morgonpass':'Kvällspass',morning?'Mat, rent vatten och en lugn start för katterna.':'Mat, städning och en stunds sällskap.');update.run(start,end,rule.title,rule.note,rule.cancelled,slot.id)}
  const insert=db.prepare("INSERT INTO slots(date,start,end,title,capacity,note,cancelled,kind) SELECT ?,'16:00','18:00',?,0,?,?,'regular' WHERE NOT EXISTS(SELECT 1 FROM slots WHERE date=? AND start='16:00' AND end='18:00')");
  for(const date of new Set(old.map(s=>s.date))){const rule=rules(date,'16:00','18:00','Eftermiddagspass','Mat, städning och en stunds sällskap.');insert.run(date,rule.title,rule.note,rule.cancelled,date)}
  db.prepare('INSERT INTO migrations VALUES(?)').run(migration);db.exec('COMMIT');return old.length>0;
 }catch(error){db.exec('ROLLBACK');throw error}
}
