// scripts/allow-3p-cookies.ts
import fs from 'fs';
import path from 'path';

const prefPath = '/var/www/acc1/Default/Preferences';

if (!fs.existsSync(prefPath)) {
  console.log('Preferences file does not exist at:', prefPath);
  process.exit(1);
}

const raw = fs.readFileSync(prefPath, 'utf-8');
const prefs = JSON.parse(raw);

if (!prefs.profile) prefs.profile = {};

// 1. Allow all cookies, including 3rd-party (0 = allow all, 1 = block in incognito, 2 = block all)
prefs.profile.cookie_controls_mode = 0;

// 2. Default content settings
if (!prefs.profile.default_content_setting_values) {
  prefs.profile.default_content_setting_values = {};
}
prefs.profile.default_content_setting_values.cookies = 1;
prefs.profile.default_content_setting_values.images = 1;
prefs.profile.default_content_setting_values.javascript = 1;

// 3. Content setting exceptions for GBF and Mobage
if (!prefs.profile.content_settings) prefs.profile.content_settings = {};
if (!prefs.profile.content_settings.exceptions) prefs.profile.content_settings.exceptions = {};
if (!prefs.profile.content_settings.exceptions.cookies) prefs.profile.content_settings.exceptions.cookies = {};

const sites = [
  'https://game.granbluefantasy.jp,*',
  'https://connect.mobage.jp,*',
  'https://sp.mbga.jp,*',
  'https://www.mbga.jp,*',
  'https://app.mobage.jp,*',
  '[*.]granbluefantasy.jp,*',
  '[*.]mobage.jp,*',
  '[*.]mbga.jp,*',
  '*'
];

for (const site of sites) {
  prefs.profile.content_settings.exceptions.cookies[site] = {
    expiration: '0',
    last_modified: Date.now().toString(),
    model: 0,
    setting: 1
  };
}

fs.writeFileSync(prefPath, JSON.stringify(prefs, null, 2), 'utf-8');
console.log('✅ Successfully configured Chrome Preferences to ALLOW ALL third-party cookies for Mobage and Granblue!');
