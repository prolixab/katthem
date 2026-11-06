import {randomBytes} from 'node:crypto';
export const isLocalAccount=email=>String(email||'').trim().toLowerCase().endsWith('.local');
export const requiresPasswordChange=user=>Boolean(user?.must_change_password)&&!isLocalAccount(user?.email);
export const temporaryPassword=()=>randomBytes(18).toString('base64url')+'aA1!';
export function initPasswordPolicy(db){if(!db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='must_change_password'))db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 1')}
export function setPasswordChange(db,id,required){if(db.prepare('PRAGMA table_info(users)').all().some(c=>c.name==='must_change_password'))db.prepare('UPDATE users SET must_change_password=? WHERE id=?').run(Number(required),id)}
