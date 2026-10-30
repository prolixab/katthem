import {isAdmin,isSuperAdmin,canManageAccount} from './roles.mjs';
export function createVolunteers(db,members,hash){
 const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
 function save(id,p,actor){
  if(!isAdmin(actor))fail('Du saknar administratörsbehörighet.',403);
  if(!p||typeof p!=='object'||!p.account||typeof p.account!=='object')fail('Kontrollera volontärens uppgifter.');
  const previous=id===null?null:db.prepare('SELECT * FROM member_profiles WHERE id=?').get(id);if(id!==null&&!previous)fail('Volontären finns inte.',404);
  const target=previous?.user_id?db.prepare('SELECT * FROM users WHERE id=?').get(previous.user_id):null;
  if(typeof p.name!=='string'||!p.name.trim()||typeof p.email!=='string')fail('Ange namn och kontrollera e-post.');
  const name=p.name.trim(),email=p.email.trim().toLowerCase(),password=p.account.password??'',role=p.account.role??target?.role??'volunteer',active=p.account.active??Boolean(target?.active??true),green=p.account.green??Boolean(target?.green_manual);
  if(typeof password!=='string'||password&& (password.length<10||password.length>200)||!['volunteer','admin','superadmin'].includes(role)||typeof active!=='boolean'||typeof green!=='boolean')fail('Kontrollera lösenord, behörighet och aktivering.');
  if(id===null&&!password)fail('Ange ett tillfälligt lösenord med 10–200 tecken för den nya volontären.');
  const createsLogin=!target&&Boolean(password);
  if((target||createsLogin)&&!/^\S+@\S+\.\S+$/.test(email))fail('Ange en giltig e-postadress för inloggning.');
  if(!isSuperAdmin(actor)&&(role!==(target?.role||'volunteer')))fail('Endast superadmin får ändra administratörsbehörigheter.',403);
  if(target&&!canManageAccount(actor,target)&&(name!==target.name||email!==target.email.toLowerCase()||password||role!==target.role||active!==Boolean(target.active)||green!==Boolean(target.green_manual)))fail('Endast superadmin får ändra administratörers inloggningsuppgifter.',403);
  if(target?.id===actor.id&&(role!==target.role||active!==Boolean(target.active)))fail('Du kan inte ändra din egen behörighet eller aktivering.',403);
  if(target?.id===actor.id&&password)fail('Byt ditt eget lösenord under Mitt konto.');
  if(p.user_id!==undefined&&p.user_id!==(previous?.user_id??null))fail('Volontärens inloggning kopplas automatiskt.');
  if((target||createsLogin)&&db.prepare('SELECT id FROM users WHERE lower(email)=? AND id<>?').get(email,target?.id??-1))fail('En volontär med e-postadressen finns redan. Öppna den befintliga volontären.');
  const passwordHash=password?hash(password):null;
  db.exec('BEGIN IMMEDIATE');try{
   let uid=target?.id??null;
   if(createsLogin)uid=Number(db.prepare('INSERT INTO users(name,email,password,role,active,green_manual,created_at) VALUES(?,?,?,?,?,?,?)').run(name,email,passwordHash,role,Number(active),role==='volunteer'?Number(green):0,Date.now()).lastInsertRowid);
   const profileId=members.save(id,{...p,name,email,user_id:uid},{transaction:false});
   if(target){db.prepare('UPDATE users SET role=?,active=?,green_manual=?,password=? WHERE id=?').run(role,Number(active),role==='volunteer'?Number(green):target.green_manual,passwordHash||target.password,target.id);
    if(passwordHash||role!==target.role||active!==Boolean(target.active)){db.prepare('DELETE FROM sessions WHERE user_id=?').run(target.id);db.prepare('DELETE FROM password_resets WHERE user_id=?').run(target.id)}
   }
   db.exec('COMMIT');return profileId;
  }catch(e){db.exec('ROLLBACK');throw e}
 }
 return {save};
}
