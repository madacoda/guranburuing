import { Database } from 'bun:sqlite';
import path from 'path';
import crypto from 'crypto';

const masterKey = Buffer.from('aeUJ1wwgyrwfpR3CJCOJu/21rlxcBvBB0+AzDU/2NRU=', 'base64');
const db = new Database(path.join(process.env.LOCALAPPDATA || '', 'Chromium/User Data/Default/Network/Cookies'));
const row = db.query('SELECT name, encrypted_value FROM cookies WHERE name = "midship" LIMIT 1').get() as any;
const enc = Buffer.from(row.encrypted_value);
const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, enc.subarray(3, 15));
decipher.setAuthTag(enc.subarray(enc.length - 16));
const out = Buffer.concat([decipher.update(enc.subarray(15, enc.length - 16)), decipher.final()]);
console.log(row.name, 'Length:', out.length);
console.log('Hex:', out.toString('hex'));
console.log('Utf8:', out.toString('utf-8'));
