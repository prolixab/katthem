export function createMembers(db){
 db.exec("CREATE TABLE IF NOT EXISTS member_profiles(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL DEFAULT '',phone TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',member_number TEXT NOT NULL DEFAULT '',member_since TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'active',board_role TEXT NOT NULL DEFAULT 'none',board_title TEXT NOT NULL DEFAULT '',responsibilities TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL);CREATE UNIQUE INDEX IF NOT EXISTS member_number_unique ON member_profiles(member_number) WHERE member_number<>'';");
 if(!db.prepare('PRAGMA table_info(member_profiles)').all().some(c=>c.name==='user_id'))db.exec('ALTER TABLE member_profiles ADD COLUMN user_id INTEGER REFERENCES users(id)');
 if(!db.prepare('PRAGMA table_info(member_profiles)').all().some(c=>c.name==='birth_date'))db.exec("ALTER TABLE member_profiles ADD COLUMN birth_date TEXT NOT NULL DEFAULT ''");
 if(!db.prepare('PRAGMA table_info(member_profiles)').all().some(c=>c.name==='is_member')){db.exec("ALTER TABLE member_profiles ADD COLUMN is_member INTEGER NOT NULL DEFAULT 0");db.exec("UPDATE member_profiles SET is_member=1 WHERE member_number<>'' OR member_since<>'' OR status='supporting' OR board_role<>'none'")}
 db.exec('CREATE UNIQUE INDEX IF NOT EXISTS member_account_unique ON member_profiles(user_id) WHERE user_id IS NOT NULL');
 function syncAccounts(){
  db.exec('BEGIN IMMEDIATE');try{
   for(const u of db.prepare('SELECT id,name,email FROM users').all()){
    const linked=db.prepare('SELECT id,name,email FROM member_profiles WHERE user_id=?').get(u.id);
    if(linked){if(linked.name!==u.name||linked.email!==u.email)db.prepare('UPDATE member_profiles SET name=?,email=?,revision=revision+1,updated_at=? WHERE id=?').run(u.name,u.email,Date.now(),linked.id);continue}
    const matches=db.prepare('SELECT id,user_id FROM member_profiles WHERE lower(trim(email))=lower(trim(?))').all(u.email);
    if(matches.length===1&&matches[0].user_id===null)db.prepare('UPDATE member_profiles SET user_id=?,name=?,email=?,revision=revision+1,updated_at=? WHERE id=?').run(u.id,u.name,u.email,Date.now(),matches[0].id);
    else if(!matches.length)db.prepare('INSERT INTO member_profiles(name,email,user_id,updated_at) VALUES(?,?,?,?)').run(u.name,u.email,u.id,Date.now());
   }
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e}
 }
 const list=()=>db.prepare('SELECT * FROM member_profiles ORDER BY name COLLATE NOCASE,id').all().map(m=>({...m,is_member:Boolean(m.is_member)}));
 function save(id,p){
  const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
  if(!p||typeof p!=='object')fail('Kontrollera medlemsuppgifterna.');
  const limits={name:100,email:254,phone:100,address:500,member_number:50,member_since:10,status:30,board_role:30,board_title:100,responsibilities:2000,note:3000,birth_date:10},data={};
  for(const [key,limit] of Object.entries(limits)){if(key==='birth_date'&&p[key]===undefined)p={...p,birth_date:''};if(typeof p[key]!=='string'||p[key].length>limit)fail('Kontrollera medlemsuppgifterna och textlängderna.');data[key]=p[key].trim()}
  if(!data.name)fail('Ange medlemmens namn.');
  if(data.email&&!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(data.email))fail('Ange giltig e-postadress eller lämna fältet tomt.');
  if(!['active','supporting','paused','ended'].includes(data.status)||!['none','chair','vice_chair','treasurer','secretary','member','deputy','other'].includes(data.board_role))fail('Kontrollera medlemsstatus och styrelseroll.');
  if(data.board_role==='other'&&!data.board_title)fail('Ange den övriga styrelserollens namn.');
  if(data.board_role!=='other')data.board_title='';
  if(data.member_since&&(!/^\d{4}-\d{2}-\d{2}$/.test(data.member_since)||!Number.isFinite(new Date(data.member_since+'T12:00:00Z').getTime())||new Date(data.member_since+'T12:00:00Z').toISOString().slice(0,10)!==data.member_since))fail('Ange ett giltigt medlemsdatum.');
  if(id!==null&&(!Number.isInteger(id)||!db.prepare('SELECT id FROM member_profiles WHERE id=?').get(id)))fail('Medlemmen finns inte.',404);
  if(id!==null&&!Number.isInteger(p.revision))fail('Ladda om medlemsprofilen innan du sparar.');
  if(data.member_number&&db.prepare('SELECT id FROM member_profiles WHERE member_number=? AND id<>?').get(data.member_number,id??-1))fail('Medlemsnumret används redan.');
  if(data.birth_date&&(!/^\d{4}-\d{2}-\d{2}$/.test(data.birth_date)||!Number.isFinite(new Date(data.birth_date+'T12:00:00Z').getTime())||new Date(data.birth_date+'T12:00:00Z').toISOString().slice(0,10)!==data.birth_date||data.birth_date>new Date().toISOString().slice(0,10)))fail('Ange ett giltigt födelsedatum som inte ligger i framtiden.');
  const previous=id===null?null:db.prepare('SELECT user_id FROM member_profiles WHERE id=?').get(id);
  if(previous?.user_id&&p.user_id!==undefined&&p.user_id!==previous.user_id)fail('En befintlig kontokoppling kan inte bytas eller tas bort här.');
  if(id===null&&data.email&&db.prepare('SELECT id FROM member_profiles WHERE lower(trim(email))=lower(trim(?))').get(data.email))fail('En medlemsprofil med denna e-post finns redan. Öppna den befintliga profilen.');
  data.user_id=p.user_id===undefined?(previous?.user_id??null):p.user_id;
  if(data.user_id!==null){
   if(!Number.isInteger(data.user_id)||!db.prepare('SELECT id FROM users WHERE id=?').get(data.user_id))fail('Välj ett befintligt konto.');
   if(db.prepare('SELECT id FROM member_profiles WHERE user_id=? AND id<>?').get(data.user_id,id??-1))fail('Kontot är redan kopplat till en annan medlemsprofil.');
   if(!data.email)fail('E-post krävs för en medlem med inloggningskonto.');
   if(db.prepare('SELECT id FROM users WHERE lower(email)=lower(?) AND id<>?').get(data.email,data.user_id))fail('E-postadressen används av ett annat konto.');
  }
  const priorMembership=id===null?null:db.prepare('SELECT is_member FROM member_profiles WHERE id=?').get(id);if(p.is_member!==undefined&&typeof p.is_member!=='boolean')fail('Välj om volontären är medlem.');data.is_member=p.is_member===undefined?(priorMembership?.is_member||0):Number(p.is_member);
  const fields=[...Object.keys(limits),'user_id','is_member'],values=fields.map(key=>data[key]);
  db.exec('BEGIN IMMEDIATE');try{
  if(data.user_id!==null)db.prepare('UPDATE users SET name=?,email=? WHERE id=?').run(data.name,data.email.toLowerCase(),data.user_id);
  if(id===null){const result=db.prepare('INSERT INTO member_profiles('+fields.join(',')+',updated_at) VALUES('+fields.map(()=>'?').join(',')+',?)').run(...values,Date.now());db.exec('COMMIT');return Number(result.lastInsertRowid)}
  const result=db.prepare('UPDATE member_profiles SET '+fields.map(key=>key+'=?').join(',')+',revision=revision+1,updated_at=? WHERE id=? AND revision=?').run(...values,Date.now(),id,p.revision);
  if(!result.changes)fail('Profilen har ändrats. Öppna den igen innan du sparar.',409);db.exec('COMMIT');return id;
  }catch(e){db.exec('ROLLBACK');throw e}
 }
 return {list,save,syncAccounts};
}
