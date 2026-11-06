const defaults={primary:'#244e43',background:'#f7f7f0',text:'#263c35',accent:'#a24d31',logo:''};
const luminance=color=>{const a=color.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return .2126*a[0]+.7152*a[1]+.0722*a[2]};
export function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05)}
export function createBranding(db){
 db.exec(`CREATE TABLE IF NOT EXISTS branding(id INTEGER PRIMARY KEY CHECK(id=1),primary_color TEXT NOT NULL DEFAULT '#244e43',background_color TEXT NOT NULL DEFAULT '#f7f7f0',text_color TEXT NOT NULL DEFAULT '#263c35',accent_color TEXT NOT NULL DEFAULT '#a24d31',logo TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 0);INSERT OR IGNORE INTO branding(id) VALUES(1)`);
 const get=()=>{const r=db.prepare('SELECT * FROM branding WHERE id=1').get();return {primary:r.primary_color,background:r.background_color,text:r.text_color,accent:r.accent_color,logo:r.logo,revision:r.revision}};
 function save(p){const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};if(!p||!Number.isInteger(p.revision)||Object.keys(p).some(k=>!['primary','background','text','accent','logo','revision'].includes(k)))fail('Kontrollera färger och logotyp.');const values=p;
  for(const k of ['primary','background','text','accent'])if(typeof values[k]!=='string'||!/^#[0-9a-f]{6}$/i.test(values[k]))fail('Välj giltiga färger.');
  if(contrast(values.text,values.background)<4.5)fail('Text och sidbakgrund behöver tydligare kontrast. Välj en mörkare text eller ljusare bakgrund.');
  if(typeof values.logo!=='string'||values.logo.length>300000)fail('Logotypen är för stor. Välj PNG, JPEG eller WebP på högst 200 kB.');
  if(values.logo){const match=values.logo.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);if(!match)fail('Välj en PNG-, JPEG- eller WebP-bild.');const b=Buffer.from(match[2],'base64');if(b.length>200000||b.toString('base64')!==match[2])fail('Logotypen är för stor eller har felaktigt bildformat.');const kind=match[1],valid=kind==='png'?b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):kind==='jpeg'?b[0]===255&&b[1]===216&&b[2]===255:b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP';if(!valid)fail('Bildens innehåll motsvarar inte dess filformat.');}
  const r=db.prepare('UPDATE branding SET primary_color=?,background_color=?,text_color=?,accent_color=?,logo=?,revision=revision+1 WHERE id=1 AND revision=?').run(values.primary,values.background,values.text,values.accent,values.logo,p.revision);if(!r.changes)fail('Den grafiska profilen har ändrats. Öppna inställningarna igen.',409);return get();
 }
 return {get,save,defaults};
}
