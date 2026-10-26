export function createMembers(db){
 db.exec("CREATE TABLE IF NOT EXISTS member_profiles(id INTEGER PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL DEFAULT '',phone TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',member_number TEXT NOT NULL DEFAULT '',member_since TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'active',board_role TEXT NOT NULL DEFAULT 'none',board_title TEXT NOT NULL DEFAULT '',responsibilities TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL);CREATE UNIQUE INDEX IF NOT EXISTS member_number_unique ON member_profiles(member_number) WHERE member_number<>'';");
 const list=()=>db.prepare('SELECT * FROM member_profiles ORDER BY name COLLATE NOCASE,id').all();
 function save(id,p){
  const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
  if(!p||typeof p!=='object')fail('Kontrollera medlemsuppgifterna.');
  const limits={name:100,email:254,phone:100,address:500,member_number:50,member_since:10,status:30,board_role:30,board_title:100,responsibilities:2000,note:3000},data={};
  for(const [key,limit] of Object.entries(limits)){if(typeof p[key]!=='string'||p[key].length>limit)fail('Kontrollera medlemsuppgifterna och textlängderna.');data[key]=p[key].trim()}
  if(!data.name)fail('Ange medlemmens namn.');
  if(data.email&&!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(data.email))fail('Ange giltig e-postadress eller lämna fältet tomt.');
  if(!['active','supporting','paused','ended'].includes(data.status)||!['none','chair','vice_chair','treasurer','secretary','member','deputy','other'].includes(data.board_role))fail('Kontrollera medlemsstatus och styrelseroll.');
  if(data.board_role==='other'&&!data.board_title)fail('Ange den övriga styrelserollens namn.');
  if(data.board_role!=='other')data.board_title='';
  if(data.member_since&&(!/^\d{4}-\d{2}-\d{2}$/.test(data.member_since)||!Number.isFinite(new Date(data.member_since+'T12:00:00Z').getTime())||new Date(data.member_since+'T12:00:00Z').toISOString().slice(0,10)!==data.member_since))fail('Ange ett giltigt medlemsdatum.');
  if(id!==null&&(!Number.isInteger(id)||!db.prepare('SELECT id FROM member_profiles WHERE id=?').get(id)))fail('Medlemmen finns inte.',404);
  if(id!==null&&!Number.isInteger(p.revision))fail('Ladda om medlemsprofilen innan du sparar.');
  if(data.member_number&&db.prepare('SELECT id FROM member_profiles WHERE member_number=? AND id<>?').get(data.member_number,id??-1))fail('Medlemsnumret används redan.');
  const fields=Object.keys(limits),values=fields.map(key=>data[key]);
  if(id===null){const result=db.prepare('INSERT INTO member_profiles('+fields.join(',')+',updated_at) VALUES('+fields.map(()=>'?').join(',')+',?)').run(...values,Date.now());return Number(result.lastInsertRowid)}
  const result=db.prepare('UPDATE member_profiles SET '+fields.map(key=>key+'=?').join(',')+',revision=revision+1,updated_at=? WHERE id=? AND revision=?').run(...values,Date.now(),id,p.revision);
  if(!result.changes)fail('Profilen har ändrats. Öppna den igen innan du sparar.',409);return id;
 }
 return {list,save};
}
