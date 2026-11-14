// Age is evaluated on the shift's calendar date. Missing birth dates never count as adult cover.
export function ageOnDay(birth,day){
 if(!birth)return 'unknown';
 const birthday=new Date(birth+'T12:00:00Z');
 if(!Number.isFinite(birthday.getTime()))return 'unknown';
 birthday.setUTCFullYear(birthday.getUTCFullYear()+18);
 return day>=birthday.toISOString().slice(0,10)?'adult':'minor';
}
export function createAgePolicy(db,{now=()=>new Date(),getBirth=null}={}){
 const fail=(message,code)=>{throw Object.assign(Error(message),{status:409,code})};
 const localBirth=uid=>db.prepare('SELECT birth_date FROM member_profiles WHERE user_id=?').get(uid)?.birth_date||'';
 const age=(uid,day)=>ageOnDay(getBirth?getBirth(uid):localBirth(uid),day);
 function people(slot){return db.prepare("SELECT b.id,b.user_id,m.birth_date FROM bookings b JOIN users u ON u.id=b.user_id LEFT JOIN member_profiles m ON m.user_id=u.id LEFT JOIN engagements e ON e.user_id=u.id WHERE b.slot_id=? AND u.active=1 AND (e.status IS NULL OR e.status='active')").all(slot.id)}
 const hasAdult=(slot,exclude=null)=>people(slot).some(p=>p.user_id!==exclude&&age(p.user_id,slot.date)==='adult');
 function assertBook(uid,slot){if(age(uid,slot.date)==='minor'&&!hasAdult(slot))fail('Du är under 18 år på passets datum. En myndig person med registrerat födelsedatum behöver vara bokad på samma pass först. Kontakta admin för hjälp. ('+slot.date+' '+slot.start+')','ADULT_REQUIRED')}
 function assertSupported(slot){if(!slot.cancelled&&people(slot).some(p=>age(p.user_id,slot.date)==='minor')&&!hasAdult(slot))fail('Passet har minderåriga bokade men saknar en myndig person med registrerat födelsedatum. Boka en myndig person eller boka om de minderåriga först.','ADULT_REQUIRED')}
 function assertRemove(uid,slot){if(slot.cancelled||new Date(slot.date+'T'+slot.end)<=now()||age(uid,slot.date)!=='adult')return;if(people(slot).some(p=>p.user_id!==uid&&age(p.user_id,slot.date)==='minor')&&!hasAdult(slot,uid))fail('Du kan inte avboka den sista myndiga personen medan minderåriga är bokade på passet. Kontakta admin för ombokning eller boka en annan myndig person först.','LAST_ADULT_REQUIRED')}
 function issues(){return db.prepare('SELECT * FROM slots WHERE cancelled=0 ORDER BY date,start').all().filter(slot=>new Date(slot.date+'T'+slot.end)>now()&&people(slot).some(p=>age(p.user_id,slot.date)==='minor')&&!hasAdult(slot)).map(s=>({id:s.id,date:s.date,start:s.start,title:s.title}))}
 return {age,assertBook,assertRemove,assertSupported,issues};
}
