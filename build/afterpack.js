// Mac: firma "ad hoc" l'app (senza account Apple a pagamento). Sui Mac con chip Apple (M1, M2…) un'app senza alcuna firma
// spesso non si apre ("è danneggiata"); con questa firma gratuita si apre dopo il clic destro > Apri.
const { execFileSync } = require('child_process');
const path = require('path');
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
  try {
    execFileSync('xattr', ['-cr', app], { stdio: 'inherit' });
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
    console.log('firma ad hoc applicata a', app);
  } catch (e) {
    console.warn('firma ad hoc non riuscita (la build continua):', e.message);
  }
};
