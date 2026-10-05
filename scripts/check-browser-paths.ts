import fs from 'fs';
import path from 'path';

function checkPaths() {
  const localAppData = process.env.LOCALAPPDATA || '';
  const paths = [
    path.join(localAppData, 'Google/Chrome/User Data/Default/Network/Cookies'),
    path.join(localAppData, 'Chromium/User Data/Default/Network/Cookies'),
    path.join(localAppData, 'SRWare Iron/User Data/Default/Network/Cookies'),
    path.join(localAppData, 'BraveSoftware/Brave-Browser/User Data/Default/Network/Cookies'),
    path.join(localAppData, 'Microsoft/Edge/User Data/Default/Network/Cookies')
  ];

  for (const p of paths) {
    if (fs.existsSync(p)) {
      const stat = fs.statSync(p);
      console.log(`Found: ${p} (Size: ${stat.size}, Modified: ${stat.mtime.toISOString()})`);
    }
  }
}

checkPaths();
