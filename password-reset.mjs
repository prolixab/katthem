import {setPasswordChange,isLocalAccount} from './password-policy.mjs';
import {randomBytes,createHash} from 'node:crypto';
const digest=token=>createHash('sha256').update(token).digest('hex');
// Swedish midnight at the start of 2027 (CET). Evaluate when sending, including retries.
const onboardingRolloutEnds=Date.parse('2027-01-01T00:00:00+01:00');
export function welcomeIntroduction(time=Date.now()){
 const introduction='Ditt nästa steg\n\nNär du har loggat in, börja med introduktionsstegen som visas på startsidan. Läs igenom rutinerna och gå igenom checklistan i din egen takt. Kryssa i varje punkt när du har genomfört den.\n\nDen praktiska introduktionen gör du på katthemmet tillsammans med en erfaren volontär. Fråga gärna en kontaktperson om du behöver hjälp.';
 const experienced='Även du som redan är erfaren behöver gå igenom introduktionsstegen i portalen. Syftet är att du ska känna igen upplägget, känna till aktuella rutiner och kunna stötta nya volontärer. Kryssa i checklistans punkter när du har gått igenom dem.\n\nHar du redan genomfört den praktiska introduktionen på katthemmet kan admin bekräfta den erfarenheten – du behöver inte göra om den enbart för att portalen är ny.';
 return introduction+(time<onboardingRolloutEnds?'\n\n'+experienced:'');
}

export function createPasswordReset(db,mailProvider,hashPassword,{now=()=>Date.now(),verifyPassword,shelterId}={}){
 db.exec('CREATE TABLE IF NOT EXISTS password_resets(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL,expires INTEGER NOT NULL)');
 db.exec("CREATE TABLE IF NOT EXISTS welcome_emails(user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,sent_at INTEGER,activated_at INTEGER,attempts INTEGER NOT NULL DEFAULT 0,next_attempt INTEGER NOT NULL DEFAULT 0)");
 const hasPasswordPolicy=db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='must_change_password');
 let welcomeRunning=null;
 const message='Om adressen hör till ett aktivt konto och e-post är aktiverad skickas en återställningslänk. Kontrollera även skräpposten. Annars behöver du hjälp av administratören.';
 async function request(email){
  const user=db.prepare('SELECT id FROM users WHERE email=? AND active=1').get(String(email).trim().toLowerCase());
  if(!user||!mailProvider.status().configured)return {message};
  const time=now();db.prepare('DELETE FROM password_resets WHERE expires<=?').run(time);
  if(db.prepare('SELECT COUNT(*) n FROM password_resets WHERE user_id=? AND created_at>?').get(user.id,time-1800000).n>=3)return {message};
  const token=randomBytes(32).toString('hex'),tokenHash=digest(token);
  db.prepare('INSERT INTO password_resets VALUES(?,?,?,?)').run(tokenHash,user.id,time,time+1800000);
  try{await mailProvider.send({to:String(email).trim().toLowerCase(),subject:'Återställ ditt lösenord – Katthemmet',text:`Du har begärt ett nytt lösenord till volontärportalen.\n\nÖppna länken inom 30 minuter:\n${(()=>{const u=new URL(mailProvider.appUrl());if(shelterId)u.searchParams.set('shelter',shelterId);u.hash='reset='+token;return u.href})()}\n\nLänken kan användas en gång. Om du inte begärt detta kan du bortse från mejlet. Ditt lösenord har inte ändrats.`,key:'katthem-reset/'+tokenHash})}
  catch{db.prepare('DELETE FROM password_resets WHERE token_hash=?').run(tokenHash)}
  return {message};
 }
 function reset(token,password){
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||typeof password!=='string'||password.length<10||password.length>200)throw Object.assign(Error('Använd en giltig länk och ett lösenord med 10–200 tecken.'),{status:400});
  db.exec('BEGIN IMMEDIATE');
  try{
   const entry=db.prepare('SELECT p.user_id,u.password FROM password_resets p JOIN users u ON u.id=p.user_id WHERE token_hash=? AND expires>? AND u.active=1').get(digest(token),now());
   if(!entry)throw Object.assign(Error('Länken är ogiltig eller har gått ut. Begär en ny återställningslänk.'),{status:400});
   if(verifyPassword&&verifyPassword(password,entry.password))throw Object.assign(Error('Välj ett nytt lösenord som skiljer sig från det nuvarande.'),{status:400});
   db.prepare('UPDATE users SET password=? WHERE id=?').run(hashPassword(password),entry.user_id);
   setPasswordChange(db,entry.user_id,false);
   db.prepare('UPDATE welcome_emails SET activated_at=? WHERE user_id=?').run(now(),entry.user_id);
   db.prepare('DELETE FROM sessions WHERE user_id=?').run(entry.user_id);
   db.prepare('DELETE FROM password_resets WHERE user_id=?').run(entry.user_id);
   db.exec('COMMIT');return {ok:true};
  }catch(e){db.exec('ROLLBACK');throw e}
 }
 function enqueueWelcome(userId){const user=db.prepare('SELECT id,email FROM users WHERE id=?').get(userId);if(!user||isLocalAccount(user.email)||user.email.endsWith('@access.invalid'))return;db.prepare('INSERT OR IGNORE INTO welcome_emails(user_id,created_at) VALUES(?,?)').run(userId,now())}
 function welcomeStatus(userId){const row=db.prepare('SELECT * FROM welcome_emails WHERE user_id=?').get(userId);if(!row)return null;const changed=hasPasswordPolicy&&!db.prepare('SELECT must_change_password FROM users WHERE id=?').get(userId)?.must_change_password;return {state:row.activated_at||changed?'completed':row.sent_at?'sent':row.attempts>=6?'failed':'pending',sent_at:row.sent_at,email_enabled:mailProvider.status().configured}}
 function retryWelcome(userId){const status=welcomeStatus(userId);if(!status||status.state==='completed')throw Object.assign(Error('Välkomstmejl kan bara skickas för nya konton som inte valt sitt lösenord.'),{status:400});const row=db.prepare('SELECT sent_at,next_attempt,attempts FROM welcome_emails WHERE user_id=?').get(userId);if(row.sent_at&&now()-row.sent_at<60000||row.attempts&&row.next_attempt-300000>now()-60000)throw Object.assign(Error('Vänta en minut innan du skickar en ny inbjudan.'),{status:429});db.prepare('UPDATE welcome_emails SET sent_at=NULL,attempts=0,next_attempt=0 WHERE user_id=?').run(userId)}
 function runWelcome(){if(welcomeRunning)return welcomeRunning;welcomeRunning=(async()=>{
  if(!mailProvider.status().configured)return;
  const rows=db.prepare('SELECT w.user_id,u.name,u.email FROM welcome_emails w JOIN users u ON u.id=w.user_id WHERE w.sent_at IS NULL AND w.activated_at IS NULL AND w.attempts<6 AND w.next_attempt<=? AND u.active=1'+(hasPasswordPolicy?' AND u.must_change_password=1':'')+' ORDER BY w.created_at,w.user_id LIMIT 10').all(now());
  for(const u of rows){const token=randomBytes(32).toString('hex'),tokenHash=digest(token),time=now();let link;try{const url=new URL(mailProvider.appUrl());if(shelterId)url.searchParams.set('shelter',shelterId);url.hash='reset='+token;link=url.href}catch{continue}
   db.prepare('INSERT INTO password_resets VALUES(?,?,?,?)').run(tokenHash,u.user_id,time,time+86400000);
   db.prepare('UPDATE welcome_emails SET attempts=attempts+1,next_attempt=? WHERE user_id=?').run(time+300000,u.user_id);
   try{await mailProvider.send({to:u.email,subject:'Välkommen till Tassportalen – välj ditt lösenord',text:`Hej ${u.name}!\n\nEtt konto har skapats åt dig i Tassportalen. Här kan du boka pass och hitta information från din verksamhet.\n\nVälj ditt eget lösenord genom att öppna länken inom 24 timmar:\n${link}\n\nLänken kan användas en gång. Logga sedan in med din e-postadress och ditt valda lösenord.\n\n${welcomeIntroduction(time)}\n\nOm länken har gått ut kan du välja Glömt lösenord på inloggningssidan eller be en administratör skicka en ny inbjudan.\n\nOm du inte väntade dig ett konto, kontakta verksamhetens administratör. Dela inte länken med någon annan.`,key:'tassportalen-welcome/'+tokenHash});db.prepare('UPDATE welcome_emails SET sent_at=? WHERE user_id=?').run(now(),u.user_id)}catch{db.prepare('DELETE FROM password_resets WHERE token_hash=?').run(tokenHash)}
  }
 })().finally(()=>{welcomeRunning=null});return welcomeRunning}
 return {request,reset,enqueueWelcome,welcomeStatus,retryWelcome,runWelcome,drainWelcome:()=>welcomeRunning||Promise.resolve()};
}
