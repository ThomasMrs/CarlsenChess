import { chromium } from 'playwright';
import { mkdtemp, mkdir, rm, writeFile, cp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createDemoServer } from '../scripts/serve.mjs';
const root = path.resolve(import.meta.dirname,'..');
const extensionPath = path.join(root,'test-results/extension-fixture');
const profile = await mkdtemp(path.join(tmpdir(),'carlsenchess-test-'));
const server = await createDemoServer(0);
const port = server.address().port;
await mkdir(path.join(root,'test-results'),{recursive:true});
// Headless automation cannot click a real browser toolbar to grant activeTab.
// Grant only the local fixture origin in a disposable copy, leaving the shipped
// manifest unchanged. Module injection, messaging and WASM use production files.
await rm(extensionPath,{recursive:true,force:true});
await cp(path.join(root,'extension'),extensionPath,{recursive:true});
const testManifest=JSON.parse(await readFile(path.join(extensionPath,'manifest.json'),'utf8'));
testManifest.host_permissions=['http://127.0.0.1/*'];
await writeFile(path.join(extensionPath,'manifest.json'),JSON.stringify(testManifest));
let context;
const failures=[];
const steps=[];
try {
  context = await chromium.launchPersistentContext(profile, {
    channel:'chromium', headless:true, viewport:{width:1440,height:1100},
    args:[`--disable-extensions-except=${extensionPath}`,`--load-extension=${extensionPath}`],
  });
  const background=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page=await context.newPage();
  page.on('pageerror',error=>failures.push(error.message));
  page.on('console',message=>{ if(message.type()==='error') failures.push(message.text()); });
  await page.goto(`http://127.0.0.1:${port}/demo/`);
  await page.locator('#board button').first().waitFor();
  // Exercise the same browser scripting injection called by the toolbar action.
  await background.evaluate(async () => {
    const tabs=await chrome.tabs.query({});
    const tab=tabs.find(tab=>tab.url?.includes('/demo/'));
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content/bootstrap.js']});
  });
  const host=page.locator('#carlsenchess-root');
  await host.getByRole('button',{name:'Démarrer',exact:true}).waitFor();
  await page.locator('#load-puzzle').click();
  await host.getByRole('button',{name:'Démarrer',exact:true}).click();
  await host.locator('[data-ref="badge"]').filter({hasText:'Coup trouvé'}).waitFor({timeout:60000});
  const firstMove=await host.locator('[data-ref="move"]').innerText();
  assert.match(firstMove,/#$/,'full Stockfish should find a mate in one');
  assert.equal(await host.locator('.cc-overlay').evaluate(el=>getComputedStyle(el).display),'block');
  const arrow=host.locator('.cc-arrow');
  const x1=Number(await arrow.getAttribute('x1'));
  await page.locator('#flip-board').click();
  await host.locator('[data-ref="badge"]').filter({hasText:'Coup trouvé'}).waitFor({timeout:10000});
  await page.waitForFunction(previous=>{
    const arrow=document.querySelector('#carlsenchess-root').shadowRoot.querySelector('.cc-arrow');
    return Number(arrow.getAttribute('x1'))!==previous;
  },x1,{timeout:10000});
  steps.push('moteur complet réel, mat en un, flèche et orientation inversée');
  await page.evaluate(()=>{
    const board=document.querySelector('#board');
    window.__originalDemoBoard=board;
    board.replaceWith(board.cloneNode(true));
  });
  await host.locator('[data-ref="badge"]').filter({hasText:'Analyse…'}).waitFor();
  await host.locator('[data-ref="badge"]').filter({hasText:'Coup trouvé'}).waitFor({timeout:15000});
  assert.equal(await host.locator('.cc-overlay').evaluate(el=>getComputedStyle(el).display),'block');
  await page.evaluate(()=>{document.querySelector('#board').replaceWith(window.__originalDemoBoard);delete window.__originalDemoBoard;});
  await host.locator('[data-ref="badge"]').filter({hasText:'Analyse…'}).waitFor();
  await host.locator('[data-ref="badge"]').filter({hasText:'Coup trouvé'}).waitFor({timeout:15000});
  steps.push('remplacement du nœud plateau sans changement de FEN');
  await page.screenshot({path:path.join(root,'test-results/CarlsenChess-desktop.png'),fullPage:true});
  await host.getByRole('button',{name:'Mettre en pause',exact:true}).click();
  assert.equal(await host.locator('.cc-overlay').evaluate(el=>getComputedStyle(el).display),'none');
  await host.locator('#cc-strength-mode').selectOption('target');
  await host.locator('#cc-strength').fill('1500');
  await host.locator('#cc-strength').dispatchEvent('change');
  await host.locator('#cc-humanize').check();
  await page.locator('#new-game').click();
  await host.getByRole('button',{name:'Démarrer',exact:true}).click();
  await host.locator('[data-ref="badge"]').filter({hasText:'Coup trouvé'}).waitFor({timeout:15000});
  const before=await page.locator('#board').getAttribute('data-carlsenchess-fen');
  await page.locator('#board [data-square="e2"]').click();
  await page.locator('#board [data-square="e4"]').click();
  await host.locator('[data-ref="source"]').filter({hasText:'Trait aux Noirs'}).waitFor({timeout:10000});
  await host.locator('[data-ref="badge"]').filter({hasText:'Coup trouvé'}).waitFor({timeout:15000});
  assert.notEqual(await page.locator('#board').getAttribute('data-carlsenchess-fen'),before);
  steps.push('Elo1500, humanisation, nouvelle position après e2-e4, réponse noire');
  // Closing while a request is in flight must suppress all later drawing.
  await host.getByRole('button',{name:'Réanalyser la position',exact:true}).click();
  await host.getByRole('button',{name:'Fermer et arrêter l’analyse',exact:true}).click();
  assert.equal(await host.locator('.cc-overlay').evaluate(el=>getComputedStyle(el).display),'none');
  await background.evaluate(async()=>{
    const tabs=await chrome.tabs.query({});
    const tab=tabs.find(tab=>tab.url?.includes('/demo/'));
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content/bootstrap.js']});
  });
  await host.getByRole('button',{name:'Démarrer',exact:true}).waitFor();
  steps.push('pause/fermeture pendant calcul et réouverture via injection');
  // Reset the deliberately weakened engine before asserting a forced mate.
  await host.locator('#cc-strength-mode').selectOption('max');
  await host.locator('#cc-humanize').uncheck();
  await host.locator('summary').click();
  await host.getByLabel('Utiliser un FEN manuel').check();
  await host.locator('#cc-manual-fen').fill('6k1/5ppp/8/8/8/5Q2/6PP/6K1 w - - 0 1');
  await host.locator('#cc-manual-fen').dispatchEvent('change');
  await host.getByRole('button',{name:'Démarrer',exact:true}).click();
  await host.locator('[data-ref="badge"]').filter({hasText:'Coup trouvé'}).waitFor({timeout:15000});
  assert.match(await host.locator('[data-ref="move"]').innerText(),/#$/);
  await host.getByRole('button',{name:'Mettre en pause',exact:true}).click();
  await host.locator('#cc-manual-fen').fill('bad fen');
  await host.locator('#cc-manual-fen').dispatchEvent('change');
  await host.getByRole('button',{name:'Démarrer',exact:true}).click();
  await host.locator('[data-ref="badge"]').filter({hasText:'À vérifier'}).waitFor();
  assert.equal(await host.locator('.cc-overlay').evaluate(el=>getComputedStyle(el).display),'none');
  steps.push('FEN manuel prioritaire et FEN invalide sans flèche');
  for (const width of [320,768,1024,1440]) {
    await page.setViewportSize({width,height:1100});
    const panel=await host.locator('.cc-panel').boundingBox();
    assert.ok(panel.x>=0 && panel.x+panel.width<=width+1,`panel contained at ${width}px`);
  }
  steps.push('panneau contenu à320/768/1024/1440px');
  assert.deepEqual(failures,[]);
  console.log(JSON.stringify({ok:true,browser:context.browser()?.version(),steps},null,2));
  await writeFile(path.join(root,'test-results/e2e.json'),JSON.stringify({ok:true,steps},null,2));
} catch(error) {
  if(context?.pages().length) await context.pages().at(-1).screenshot({path:path.join(root,'test-results/failure.png'),fullPage:true}).catch(()=>{});
  console.error(error);
  process.exitCode=1;
} finally {
  await context?.close();
  await new Promise(resolve=>server.close(resolve));
  await rm(profile,{recursive:true,force:true});
  await rm(extensionPath,{recursive:true,force:true});
}
