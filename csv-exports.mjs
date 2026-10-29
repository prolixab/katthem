import {randomUUID} from 'node:crypto';
const cell=value=>{let text=String(value??'');if(/^\s*[=+@-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"'};
export function exportAttachments(db){
 db.exec('BEGIN');try{
 const definitions=[
 ['volontarer.csv','member_profiles',['id','user_id','name','email','phone','address','member_number','member_since','status','board_role','board_title','responsibilities','note','revision','updated_at','birth_date','is_member','shelter','animal_care_trained','messenger_url']],
 ['konton.csv','users',['id','name','email','role','active','green_manual','created_at']],
 ['schema.csv','slots',['id','date','start','end','title','capacity','note','cancelled','kind','extra_info']],
 ['bokningar.csv','bookings',['id','user_id','slot_id']],
 ['praktisk-info.csv','volunteer_info',['id','location']],
 ['schema-ursprung.csv','schedule_origins',['date','start','slot_id']],
 ['volontarstraff-ursprung.csv','volunteer_meeting_origins',['date','slot_id']],
 ['introduktion.csv','checklist_progress',['user_id','item_id']]
 ];
 const files=definitions.map(([filename,table,columns])=>{const rows=db.prepare('SELECT '+columns.join(',')+' FROM '+table).all();return {filename,content:'\uFEFF'+[columns,...rows.map(row=>columns.map(c=>row[c]))].map(row=>row.map(cell).join(';')).join('\r\n')+'\r\n',contentType:'text/csv; charset=utf-8'}});
 db.exec('COMMIT');if(files.reduce((total,f)=>total+Buffer.byteLength(f.content),0)>15*1024*1024)throw Error('CSV-exporten är för stor för e-post.');return files;
 }catch(e){try{db.exec('ROLLBACK')}catch{}throw e}
}
export function nextExportAt(now,interval){if(interval==='daily')return now+86400000;if(interval==='weekly')return now+7*86400000;if(interval!=='monthly')throw Error('Ogiltigt CSV-intervall.');const d=new Date(now),y=d.getUTCFullYear(),m=d.getUTCMonth()+1,last=new Date(Date.UTC(y,m+1,0)).getUTCDate();return Date.UTC(y,m,Math.min(d.getUTCDate(),last),d.getUTCHours(),d.getUTCMinutes(),d.getUTCSeconds(),d.getUTCMilliseconds())}
export function createCsvExports(db,mailProvider,{now=()=>Date.now(),attachments=()=>exportAttachments(db)}={}){
 db.exec("CREATE TABLE IF NOT EXISTS csv_export_state(id INTEGER PRIMARY KEY CHECK(id=1),signature TEXT NOT NULL DEFAULT '',next_at INTEGER,last_sent INTEGER,last_attempt INTEGER,last_error TEXT,delivery_key TEXT,retry_at INTEGER);INSERT OR IGNORE INTO csv_export_state(id) VALUES(1)");
 let inFlight=null;
 const config=()=>{const s=mailProvider.settings();return {enabled:Boolean(s.csv_enabled),recipient:s.gmail_address,interval:s.csv_interval||'weekly'}};
 function configure(){const c=config(),signature=JSON.stringify(c),previous=db.prepare('SELECT * FROM csv_export_state WHERE id=1').get();if(previous.signature!==signature)db.prepare('UPDATE csv_export_state SET signature=?,next_at=?,delivery_key=NULL,retry_at=NULL,last_error=NULL WHERE id=1').run(signature,c.enabled?nextExportAt(now(),c.interval):null);return c}
 function status(){const c=configure(),s=db.prepare('SELECT next_at,last_sent,last_attempt,last_error FROM csv_export_state WHERE id=1').get();return {...c,...s,configured:mailProvider.status().configured}}
 async function execute(force){const c=configure(),s=db.prepare('SELECT * FROM csv_export_state WHERE id=1').get(),time=now();if(!force&&(!c.enabled||!mailProvider.status().configured||time<s.next_at||s.retry_at&&time<s.retry_at))return {sent:false};if(!mailProvider.status().configured||!c.recipient)throw Object.assign(Error('Aktivera och spara Gmail innan CSV skickas.'),{status:503});
 const signature=s.signature,key=s.delivery_key||randomUUID();db.prepare('UPDATE csv_export_state SET delivery_key=?,last_attempt=? WHERE id=1').run(key,time);
 try{await mailProvider.send({to:c.recipient,subject:'Katthemmet – CSV-export '+new Date(time).toISOString().slice(0,10),text:'Bifogat finns CSV-underlag för att återskapa volontärprofiler, kontouppgifter, schema, bokningar, praktisk information och introduktionskryss. UTF-8, semikolon och kolumnnamn från databasen används; id-kolumner kopplar samman filerna. Profilerna innehåller personuppgifter. Lösenord, dörrkod, e-postnycklar och privata kalenderlänkar ingår inte. Kontolösenord måste återställas vid återuppbyggnad. Ingen automatisk import finns och detta ersätter inte fullständig databasbackup. Exporten skickas bara till samma Gmail-adress som avsändaren.',key:'katthem-csv/'+key,attachments:attachments()});
 db.prepare('UPDATE csv_export_state SET last_sent=?,next_at=?,last_error=NULL,delivery_key=NULL,retry_at=NULL WHERE id=1 AND signature=?').run(time,c.enabled?nextExportAt(time,c.interval):null,signature);return {sent:true};
 }catch(e){db.prepare('UPDATE csv_export_state SET last_error=?,retry_at=? WHERE id=1 AND signature=?').run('CSV-utskicket misslyckades. Kontrollera e-postinställningarna och exportens storlek. Nytt försök görs tidigast om en timme.',now()+3600000,signature);if(force)throw Object.assign(Error('Kunde inte skicka CSV. Kontrollera e-postinställningarna och försök igen.'),{status:502});return {sent:false,failed:true}}
 }
 function run({force=false}={}){if(inFlight){if(force)return Promise.reject(Object.assign(Error('Ett CSV-utskick pågår redan.'),{status:409}));return inFlight}inFlight=execute(force).finally(()=>{inFlight=null});return inFlight}
 configure();return {configure,status,run,drain:()=>inFlight||Promise.resolve()};
}
