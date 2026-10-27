export function createNews(db){
 db.exec('CREATE TABLE IF NOT EXISTS news(id INTEGER PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,expires_at INTEGER,published INTEGER NOT NULL DEFAULT 1,revision INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS news_dismissals(user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,news_id INTEGER NOT NULL REFERENCES news(id) ON DELETE CASCADE,revision INTEGER NOT NULL,PRIMARY KEY(user_id,news_id))');
 const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
 const all=()=>db.prepare('SELECT * FROM news ORDER BY updated_at DESC,id DESC').all();
 const visible=(uid,now=Date.now())=>db.prepare('SELECT n.* FROM news n WHERE n.published=1 AND (n.expires_at IS NULL OR n.expires_at>?) AND NOT EXISTS(SELECT 1 FROM news_dismissals d WHERE d.user_id=? AND d.news_id=n.id AND d.revision=n.revision) ORDER BY n.updated_at DESC,n.id DESC').all(now,uid);
 function save(id,p,now=Date.now()){
  if(!p||typeof p.title!=='string'||!p.title.trim()||p.title.length>150||typeof p.body!=='string'||!p.body.trim()||p.body.length>4000||typeof p.published!=='boolean')fail('Ange rubrik, text och om nyheten ska publiceras.');
  if(p.expires_at!==null&&(!Number.isSafeInteger(p.expires_at)||p.expires_at<=now&&p.published))fail('Välj en sluttid i framtiden eller ingen tidsgräns.');
  if(id===null)return Number(db.prepare('INSERT INTO news(title,body,expires_at,published,updated_at) VALUES(?,?,?,?,?)').run(p.title.trim(),p.body.trim(),p.expires_at,Number(p.published),now).lastInsertRowid);
  if(!db.prepare('SELECT id FROM news WHERE id=?').get(id))fail('Nyheten finns inte.',404);
  if(!Number.isInteger(p.revision))fail('Öppna nyheten igen.');
  const result=db.prepare('UPDATE news SET title=?,body=?,expires_at=?,published=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=?').run(p.title.trim(),p.body.trim(),p.expires_at,Number(p.published),now,id,p.revision);
  if(!result.changes)fail('Nyheten har ändrats. Öppna den igen innan du sparar.',409);return id;
 }
 function dismiss(uid,id,revision,now=Date.now()){
  const item=db.prepare('SELECT * FROM news WHERE id=? AND published=1 AND (expires_at IS NULL OR expires_at>?)').get(id,now);if(!item)fail('Nyheten visas inte längre.',404);
  if(!Number.isInteger(revision)||revision!==item.revision)fail('Nyheten har uppdaterats. Läs den nya versionen.',409);
  db.prepare('INSERT INTO news_dismissals(user_id,news_id,revision) VALUES(?,?,?) ON CONFLICT(user_id,news_id) DO UPDATE SET revision=excluded.revision').run(uid,id,revision);
 }
 return {all,visible,save,dismiss};
}
