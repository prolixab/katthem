import { randomUUID } from 'node:crypto';
export function createReminders(db,{apiKey,from,appUrl,fetchImpl=fetch,now=()=>Date.now(),mailProvider}={}){
 db.exec('CREATE TABLE IF NOT EXISTS reminder_delivery(booking_id INTEGER PRIMARY KEY REFERENCES bookings(id) ON DELETE CASCADE,delivery_key TEXT NOT NULL,sent_at INTEGER);');
 let busy=false,lastError=null;
 const configured=()=>mailProvider?mailProvider.status().configured:Boolean(apiKey&&from&&appUrl);
 function status(){return {configured:configured(),provider:mailProvider?.status().provider||'resend',last_error:lastError,sent_count:db.prepare('SELECT COUNT(*) n FROM reminder_delivery WHERE sent_at IS NOT NULL').get().n}}
 async function execute(){
  if(busy||!configured())return {sent:0,failed:0};busy=true;lastError=null;let sent=0,failed=0;
  try{
   const rows=db.prepare('SELECT b.id,s.date,s.start FROM bookings b JOIN slots s ON s.id=b.slot_id JOIN users u ON u.id=b.user_id WHERE s.cancelled=0 AND u.active=1').all();
   for(const row of rows){
    const starts=new Date(row.date+'T'+row.start+':00').getTime();if(starts<=now()||starts-now()>86400000)continue;
    // Re-read after any awaited send so cancelled bookings are excluded.
    const booking=db.prepare('SELECT b.id,s.date,s.start,s.end,s.title,u.name,u.email FROM bookings b JOIN slots s ON s.id=b.slot_id JOIN users u ON u.id=b.user_id WHERE b.id=? AND s.cancelled=0 AND u.active=1').get(row.id);if(!booking)continue;
    let delivery=db.prepare('SELECT * FROM reminder_delivery WHERE booking_id=?').get(row.id);if(delivery?.sent_at)continue;
    if(!delivery){db.prepare('INSERT INTO reminder_delivery(booking_id,delivery_key) VALUES(?,?)').run(row.id,randomUUID());delivery=db.prepare('SELECT * FROM reminder_delivery WHERE booking_id=?').get(row.id)}
    try{
     if(mailProvider){await mailProvider.send({to:booking.email,subject:'Påminnelse: '+booking.title+' '+booking.date+' '+booking.start,text:'Hej '+booking.name+'!\n\nDu är bokad på '+booking.title+' den '+booking.date+' kl. '+booking.start+'–'+booking.end+'.\nSe din bokning: '+mailProvider.appUrl()+'\nVid förhinder nära passet, kontakta administratören.',key:'katthem-reminder/'+delivery.delivery_key})}else{
     const response=await fetchImpl('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json','Idempotency-Key':'katthem-reminder/'+delivery.delivery_key},body:JSON.stringify({from,to:[booking.email],subject:'Påminnelse: '+booking.title+' '+booking.date+' '+booking.start,text:'Hej '+booking.name+'!\n\nDu är bokad på '+booking.title+' den '+booking.date+' kl. '+booking.start+'–'+booking.end+'.\nSe din bokning: '+appUrl+'\nVid förhinder nära passet, kontakta administratören.'}),signal:AbortSignal.timeout(10000)});
     if(!response.ok)throw Error('E-posttjänsten svarade '+response.status);}
     db.prepare('UPDATE reminder_delivery SET sent_at=? WHERE booking_id=?').run(now(),row.id);sent++;
    }catch(e){failed++;lastError=e.name==='TimeoutError'?'E-posttjänsten svarade inte i tid.':e.message}
   }
  }finally{busy=false}
  return {sent,failed};
 }
 let inFlight=null;
 function run(){if(inFlight)return inFlight;inFlight=execute().finally(()=>{inFlight=null});return inFlight}
 return {status,run,drain:()=>inFlight||Promise.resolve()};
}
