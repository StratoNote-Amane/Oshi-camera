import { JSDOM } from 'jsdom';
import fs from 'fs';

const fullHtml = fs.readFileSync('./index.html', 'utf8');
const dom = new JSDOM(fullHtml, { url: 'https://example.com/' });
global.window = dom.window;
global.document = dom.window.document;

const { initShadowControlsUI } = await import('./js/shadow-controls-ui.js');

const calls = [];
const stubRig = {
  setShadowDirection: (d) => calls.push(['dir', d]),
  setShadowLength: (l) => calls.push(['len', l]),
  resetShadowManualOverride: () => calls.push(['reset']),
  getShadowManualState: () => ({ azimuthDeg: null, lengthPercent: null }),
};

const api = initShadowControlsUI(stubRig);
let pass = 0, total = 0;
function check(name, cond) {
  total++;
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}`);
  if (cond) pass++;
}

check('initShadowControlsUI returns an API object (required DOM elements found)', api && typeof api.open === 'function');

const panel = document.getElementById('shadow-panel');
const openBtn = document.getElementById('shadow-adjust-btn');
const closeBtn = document.getElementById('shadow-panel-close');
const toggle = document.getElementById('shadow-manual-toggle');
const dial = document.getElementById('shadow-dial');
const resetBtn = document.getElementById('shadow-reset-btn');

check('panel initially closed (no .show)', !panel.classList.contains('show'));
openBtn.click();
check('panel opens on shadow-adjust-btn click', panel.classList.contains('show'));
closeBtn.click();
check('panel closes on close button click', !panel.classList.contains('show'));

check('dial starts disabled (auto mode)', dial.classList.contains('disabled'));
check('toggle label starts as オフ(自動)', toggle.textContent === 'オフ(自動)');

toggle.click();
check('dial becomes enabled after toggling manual ON', !dial.classList.contains('disabled'));
check('toggle label becomes オン(手動)', toggle.textContent === 'オン(手動)');
check('turning manual ON immediately applies current values to rig', calls.some(c => c[0] === 'dir') && calls.some(c => c[0] === 'len'));

calls.length = 0;
toggle.click();
check('dial becomes disabled again after toggling OFF', dial.classList.contains('disabled'));
check('turning manual OFF calls resetShadowManualOverride()', calls.some(c => c[0] === 'reset'));

// もう一度ONにしてからリセットボタン
toggle.click();
calls.length = 0;
resetBtn.click();
check('reset button turns manual back OFF', dial.classList.contains('disabled'));
check('reset button calls resetShadowManualOverride()', calls.some(c => c[0] === 'reset'));

console.log(`\n${pass}/${total} checks passed`);
process.exitCode = pass === total ? 0 : 1;
