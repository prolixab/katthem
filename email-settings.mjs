import nodemailer from 'nodemailer';
import {randomBytes,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import path from 'node:path';
const invalid=message=>{throw Object.assign(new Error(message),{status:400})};
const validEmail=value=>typeof value==='string'&&value.length<=254&&/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
export function createEmailSettings({dataDir,defaultUrl='',production=false,fallback={},createTransport=options=>nodemailer.createTransport(options),fetchImpl=fetch}){
 const file=path.join(dataDir,'email-settings.json'),keyFile=path.join(dataDir,'email-secret.key');
 let saved=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):null;
 function key(){if(!existsSync(keyFile))writeFileSync(keyFile,randomBytes(32),{flag:'wx',mode:0o600});const bytes=readFileSync(keyFile);if(bytes.length!==32)throw Error('Ogiltig e-postnyckel på servern.');return bytes}
 function encrypt(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return {iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')}}
 function decrypt(secret){const decipher=createDecipheriv('aes-256-gcm',key(),Buffer.from(secret.iv,'base64'));decipher.setAuthTag(Buffer.from(secret.tag,'base64'));return Buffer.concat([decipher.update(Buffer.from(secret.data,'base64')),decipher.final()]).toString('utf8')}
 function settings(){return {gmail_address:saved?.gmail_address||'',app_url:saved?.app_url||defaultUrl,enabled:saved?.enabled||false,password_saved:Boolean(saved?.secret),csv_interval:saved?.csv_interval||'weekly',csv_enabled:saved?.csv_enabled||false,provider:saved?'gmail':'resend'}}
 function status(){return {provider:saved?'gmail':'resend',configured:saved?Boolean(saved.enabled&&saved.secret&&saved.gmail_address&&saved.app_url):Boolean(fallback.apiKey&&fallback.from&&fallback.appUrl)}}
 function save(p){
  if(!p||typeof p.enabled!=='boolean'||!validEmail(p.gmail_address))invalid('Ange en giltig Gmail-adress och välj om påminnelser ska aktiveras.');
  let url;try{url=new URL(p.app_url)}catch{invalid('Ange sidans fullständiga webbadress.')}
  if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||!(url.protocol==='https:'||!production&&url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))invalid('Använd en HTTPS-adress utan sökväg, eller localhost för lokalt test.');
  if(typeof p.app_password!=='string')invalid('Ange applösenord eller lämna fältet tomt för att behålla det sparade.');
  const password=p.app_password.replace(/\s/g,''),address=p.gmail_address.trim().toLowerCase();
  if(password&&!/^[a-zA-Z0-9]{16}$/.test(password))invalid('Gmails applösenord ska ha 16 tecken.');
  if(saved?.gmail_address!==address&&!password)invalid('Ange ett nytt applösenord för den här Gmail-adressen.');
  const secret=password?encrypt(password):saved?.secret;
  if(!secret)invalid('Ange ett Gmail-applösenord.');
  const csvInterval=p.csv_interval===undefined?(saved?.csv_interval||'weekly'):p.csv_interval;if(!['daily','weekly','monthly'].includes(csvInterval))invalid('Välj dagligen, varje vecka eller varje månad för CSV.');
  const csvEnabled=p.csv_enabled===undefined?Boolean(saved?.csv_enabled):p.csv_enabled;if(typeof csvEnabled!=='boolean')invalid('Välj om automatiska CSV-utskick ska aktiveras.');if(csvEnabled&&!p.enabled)invalid('Aktivera Gmail för att skicka automatiska CSV-exporter.');
  const next={csv_enabled:csvEnabled,csv_interval:csvInterval,gmail_address:address,app_url:url.origin,enabled:p.enabled,secret};
  writeFileSync(file+'.tmp',JSON.stringify(next),{mode:0o600});renameSync(file+'.tmp',file);saved=next;return settings();
 }
 async function gmailSend(message){
  if(!saved?.secret)invalid('Spara Gmail-adress och applösenord innan du testar.');
  let transport;
  try{transport=createTransport({host:'smtp.gmail.com',port:465,secure:true,auth:{user:saved.gmail_address,pass:decrypt(saved.secret)},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:15000,logger:false,debug:false,disableFileAccess:true,disableUrlAccess:true});
   await transport.sendMail({from:{name:'Katthemmet',address:saved.gmail_address},to:message.to,subject:message.subject,text:message.text,...(message.attachments?{attachments:message.attachments.map(a=>({filename:a.filename,content:a.content,contentType:a.contentType}))}:{}),...(message.key?{messageId:'<'+createHash('sha256').update(message.key).digest('hex')+'@katthem.local>'}:{})});
  }catch(e){throw Object.assign(new Error(e.code==='EAUTH'?'Gmail nekade inloggningen. Kontrollera adress, tvåstegsverifiering och applösenord.':'Kunde inte skicka via Gmail. Kontrollera inställningarna och försök igen.'),{status:502})}
  finally{transport?.close?.()}
 }
 async function send(message){
  if(!status().configured)invalid('E-postpåminnelser är inte aktiverade.');
  if(saved)return gmailSend(message);
  const response=await fetchImpl('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+fallback.apiKey,'Content-Type':'application/json','Idempotency-Key':message.key},body:JSON.stringify({from:fallback.from,to:[message.to],subject:message.subject,text:message.text}),signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('E-posttjänsten svarade '+response.status);
 }
 async function test(to){if(!validEmail(to))invalid('Ange en giltig mottagaradress för testmejlet.');await gmailSend({to,subject:'Testmejl från Katthemmet',text:'E-postinställningarna fungerar. Detta är ett testmejl från Katthemmet.'});return {ok:true}}
 return {settings,status,save,send,test,appUrl:()=>saved?.app_url||fallback.appUrl||defaultUrl};
}
