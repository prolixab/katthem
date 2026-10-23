// CSV supports comma or semicolon separators, quoted fields, escaped quotes and UTF-8 BOM.
export function parseVolunteersCsv(text){
 if(typeof text!=='string'||text.length>500000)throw Error('Välj en CSV-fil på högst 500 kB.');
 text=text.replace(/^\uFEFF/,'');
 const first=text.split(/\r?\n/,1)[0],separator=first.includes(';')?';':',';
 const rows=[];let row=[],field='',quoted=false,closed=false;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){field+='"';i++}else{quoted=false;closed=true}}else field+=c;continue}
  if(c===separator||c==='\n'||c==='\r'){
   row.push(field);field='';closed=false;
   if(c!==separator){if(row.some(v=>v.trim()))rows.push(row);row=[];if(c==='\r'&&text[i+1]==='\n')i++}
  }else if(c==='"'){if(field||closed)throw Error('Ogiltiga citattecken i CSV-filen.');quoted=true}
  else{if(closed)throw Error('Ogiltig text efter citattecken i CSV-filen.');field+=c}
 }
 if(quoted)throw Error('Ett citerat fält saknar avslutande citattecken.');
 row.push(field);if(row.some(v=>v.trim()))rows.push(row);
 if(rows.length<2)throw Error('CSV-filen behöver en rubrikrad och minst en volontär.');
 if(rows.length>501)throw Error('Importera högst 500 volontärer åt gången.');
 const aliases={namn:'name',name:'name','e-post':'email',email:'email',lösenord:'password',password:'password',grön:'green',green:'green'};
 const headers=rows.shift().map(v=>aliases[v.trim().toLowerCase()]);
 if(headers.some(h=>!h)||new Set(headers).size!==headers.length||!['name','email','password'].every(h=>headers.includes(h)))throw Error('Använd rubrikerna namn, e-post, lösenord och valfritt grön.');
 return rows.map((values,index)=>{
  if(values.length!==headers.length)throw Error('Rad '+(index+2)+': fel antal kolumner.');
  const entry=Object.fromEntries(headers.map((h,i)=>[h,values[i]]));entry.name=entry.name.trim();entry.email=entry.email.trim().toLowerCase();
  if(!entry.name||entry.name.length>100||!/^\S+@\S+\.\S+$/.test(entry.email)||entry.password.length<10||entry.password.length>200)throw Error('Rad '+(index+2)+': ange namn, giltig e-post och lösenord med 10–200 tecken.');
  const green=(entry.green||'').trim().toLowerCase();
  if(!['','ja','nej','true','false','1','0'].includes(green))throw Error('Rad '+(index+2)+': grön ska vara ja eller nej.');
  entry.green=['ja','true','1'].includes(green);return entry;
 });
}
