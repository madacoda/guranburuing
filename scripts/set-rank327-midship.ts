import fs from 'fs';
import path from 'path';

function main() {
  const acc1File = path.resolve('data/acc1-cookies.json');
  const cookies: any[] = JSON.parse(fs.readFileSync(acc1File, 'utf-8'));

  const midshipValue = "S%3AWMNT0hkryDpGUt9d5YCRTx5DOpRFZ27fJWGJN3WBOf3kDy9lnfj-OSyz6LeqX8ruPiQIFqfWTr3Y6g-NgZnSSLdnDt0t_gUGbkcScjFE3XNomA7T2tWhyie52b8txQW012k-8Kd6szS_QgNa971NVVkgYmyb3RsmQ802g15qjpA7qpvhLvPYretPNg5x_0cim-x5g4Vgm5IBXXYKxACthpQEneFlnXvuTjtyiqd7WsX8jQ%3D%3D";

  // Filter out any existing midship
  const withoutMidship = cookies.filter(c => c.name !== 'midship');

  // Add midship for game.granbluefantasy.jp, .game.granbluefantasy.jp, and .granbluefantasy.jp
  withoutMidship.push({
    name: 'midship',
    value: midshipValue,
    domain: 'game.granbluefantasy.jp',
    path: '/',
    secure: false,
    httpOnly: false,
    expires: 1793802170
  });
  withoutMidship.push({
    name: 'midship',
    value: midshipValue,
    domain: '.game.granbluefantasy.jp',
    path: '/',
    secure: false,
    httpOnly: false,
    expires: 1793802170
  });
  withoutMidship.push({
    name: 'midship',
    value: midshipValue,
    domain: '.granbluefantasy.jp',
    path: '/',
    secure: false,
    httpOnly: false,
    expires: 1793802170
  });

  fs.writeFileSync(acc1File, JSON.stringify(withoutMidship, null, 2), 'utf-8');
  console.log(`Saved ${withoutMidship.length} cookies to ${acc1File} with Rank 327 midship.`);
}

main();
