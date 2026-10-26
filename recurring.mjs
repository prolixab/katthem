import {createHash} from 'node:crypto';
export function createRecurringBookings(db){
 const fail=(message,status=400,code)=>{throw Object.assign(new Error(message),{status,code})};
 function preview(uid,p,now=new Date()){
  if(!Number.isInteger(p.slotId)||![1,2,4].includes(p.interval)||typeof p.until!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(p.until))fail('Välj startpass, intervall och slutdatum.');
  const anchor=db.prepare('SELECT * FROM slots WHERE id=?').get(p.slotId);
  if(!anchor||anchor.kind!=='regular'||anchor.cancelled)fail('Välj ett ordinarie pass som inte är inställt.');
  if(new Date(anchor.date+'T'+anchor.start+':00')<=now)fail('Startpasset har redan börjat.');
  const last=new Date(anchor.date+'T12:00:00Z');last.setUTCDate(last.getUTCDate()+41);
  const endDate=new Date(p.until+'T12:00:00Z');if(!Number.isFinite(endDate.getTime()))fail('Ange ett giltigt slutdatum.');
  if(p.until<anchor.date||p.until>last.toISOString().slice(0,10)||new Date(p.until+'T12:00:00Z').toISOString().slice(0,10)!==p.until)fail('Slutdatum får vara högst sex veckor efter startpasset.');
  if(!db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(uid))fail('Kontot är inte aktivt.');
  const rows=[];
  for(let d=new Date(anchor.date+'T12:00:00Z');d.toISOString().slice(0,10)<=p.until;d.setUTCDate(d.getUTCDate()+7*p.interval)){
   const date=d.toISOString().slice(0,10),slot=db.prepare("SELECT * FROM slots WHERE date=? AND start=? AND end=? AND kind='regular' ORDER BY cancelled,id LIMIT 1").get(date,anchor.start,anchor.end);
   const row={date,start:anchor.start,end:anchor.end,slot_id:slot?.id||null,status:!slot?'missing':slot.cancelled?'cancelled':'new',over_limit:false,overlap:false};
   if(row.status==='new'){
    if(db.prepare('SELECT id FROM bookings WHERE user_id=? AND slot_id=?').get(uid,slot.id))row.status='already';
    else{row.over_limit=db.prepare('SELECT COUNT(*) n FROM bookings WHERE slot_id=?').get(slot.id).n>=7;row.overlap=Boolean(db.prepare('SELECT b.id FROM bookings b JOIN slots s ON s.id=b.slot_id WHERE b.user_id=? AND s.cancelled=0 AND s.date=? AND s.start<? AND s.end>? LIMIT 1').get(uid,date,slot.end,slot.start))}
   }
   rows.push(row);
  }
  const key=createHash('sha256').update(JSON.stringify({uid,rows})).digest('hex');
  return {rows,key};
 }
 function book(uid,p){
  db.exec('BEGIN IMMEDIATE');try{
   const plan=preview(uid,p);
   if(p.key!==plan.key)fail('Schemat har ändrats. Förhandsgranska bokningarna igen.',409,'STALE_RECURRING');
   const pending=plan.rows.filter(r=>r.status==='new');if(!pending.length)fail('Inga nya pass att boka.');
   if(pending.some(r=>r.over_limit)&&p.confirmOverLimit!==true)fail('Bekräfta att du vill boka trots minst 7 anmälda.',409,'RECOMMENDED_LIMIT');
   if(pending.some(r=>r.overlap)&&p.confirmOverlap!==true)fail('Bekräfta att du vill boka överlappande pass.',409,'OVERLAPPING_BOOKING');
   for(const row of pending)db.prepare('INSERT INTO bookings(user_id,slot_id) VALUES(?,?)').run(uid,row.slot_id);
   db.exec('COMMIT');return pending.length;
  }catch(e){db.exec('ROLLBACK');throw e}
 }
 return {preview,book};
}
