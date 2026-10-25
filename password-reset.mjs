import {randomBytes,createHash} from 'node:crypto';
const digest=token=>createHash('sha256').update(token).digest('hex');
export function createPasswordReset(db,mailProvider,hashPassword,{now=()=>Date.now()}={}){
 db.exec('CREATE TABLE IF NOT EXISTS password_resets(token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL,expires INTEGER NOT NULL)');
 const message='Om adressen hör till ett aktivt konto och e-post är aktiverad skickas en återställningslänk. Kontrollera även skräpposten. Annars behöver du hjälp av administratören.';
 async function request(email){
  const user=db.prepare('SELECT id FROM users WHERE email=? AND active=1').get(String(email).trim().toLowerCase());
  if(!user||!mailProvider.status().configured)return {message};
  const time=now();db.prepare('DELETE FROM password_resets WHERE expires<=?').run(time);
  if(db.prepare('SELECT COUNT(*) n FROM password_resets WHERE user_id=? AND created_at>?').get(user.id,time-1800000).n>=3)return {message};
  const token=randomBytes(32).toString('hex'),tokenHash=digest(token);
  db.prepare('INSERT INTO password_resets VALUES(?,?,?,?)').run(tokenHash,user.id,time,time+1800000);
  try{await mailProvider.send({to:String(email).trim().toLowerCase(),subject:'Återställ ditt lösenord – Katthemmet',text:`Du har begärt ett nytt lösenord till volontärportalen.\n\nÖppna länken inom 30 minuter:\n${mailProvider.appUrl()}/#reset=${token}\n\nLänken kan användas en gång. Om du inte begärt detta kan du bortse från mejlet. Ditt lösenord har inte ändrats.`,key:'katthem-reset/'+tokenHash})}
  catch{db.prepare('DELETE FROM password_resets WHERE token_hash=?').run(tokenHash)}
  return {message};
 }
 function reset(token,password){
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||typeof password!=='string'||password.length<10||password.length>200)throw Object.assign(Error('Använd en giltig länk och ett lösenord med 10–200 tecken.'),{status:400});
  db.exec('BEGIN IMMEDIATE');
  try{
   const entry=db.prepare('SELECT p.user_id FROM password_resets p JOIN users u ON u.id=p.user_id WHERE token_hash=? AND expires>? AND u.active=1').get(digest(token),now());
   if(!entry)throw Object.assign(Error('Länken är ogiltig eller har gått ut. Begär en ny återställningslänk.'),{status:400});
   db.prepare('UPDATE users SET password=? WHERE id=?').run(hashPassword(password),entry.user_id);
   db.prepare('DELETE FROM sessions WHERE user_id=?').run(entry.user_id);
   db.prepare('DELETE FROM password_resets WHERE user_id=?').run(entry.user_id);
   db.exec('COMMIT');return {ok:true};
  }catch(e){db.exec('ROLLBACK');throw e}
 }
 return {request,reset};
}
