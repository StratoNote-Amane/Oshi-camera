import { JSDOM } from 'jsdom';
import { CHARACTERS } from './js/characters-data.js';

const dom = new JSDOM(`<!DOCTYPE html><body>
<div id="select-screen" style="display:flex">
  <div id="character-list" class="char-carousel"></div>
  <div id="select-dots"></div>
</div>
</body>`);
global.document = dom.window.document;
const document = dom.window.document;

const selectScreen = document.getElementById('select-screen');
const characterList = document.getElementById('character-list');
const selectDots = document.getElementById('select-dots');
let currentCharacterIndex = 0;

// main.js の initCharacterSelect() 内、カード生成部分を忠実に再現(挙動検証のため)。
function initCharacterSelect() {
  if (CHARACTERS.length <= 1) {
    selectScreen.style.display = 'none';
    currentCharacterIndex = 0;
    return;
  }
  selectScreen.style.display = 'flex';
  characterList.innerHTML = '';
  if (selectDots) selectDots.innerHTML = '';

  CHARACTERS.forEach((def, i) => {
    const slide = document.createElement('div');
    slide.className = 'char-slide' + (i === 0 ? ' in-view' : '');
    slide.style.setProperty('--theme', def.themeColor || 'var(--gold)');
    slide.innerHTML = `
      <div class="badge-orbit">
        <div class="badge-ring"></div>
        <div class="badge-core"><span class="badge-emoji">${def.thumb || '⭐'}</span></div>
      </div>
      <h2 class="char-name">${def.name}</h2>
      <p class="char-tagline">${def.tagline || '一緒に、素敵な瞬間を。'}</p>
      <button type="button" class="char-pick-btn">この娘とはじめる</button>
    `;
    slide.querySelector('.char-pick-btn').addEventListener('click', () => {
      currentCharacterIndex = i;
      selectScreen.style.display = 'none';
    });
    characterList.appendChild(slide);

    if (selectDots) {
      const dot = document.createElement('span');
      if (i === 0) dot.classList.add('active');
      selectDots.appendChild(dot);
    }
  });
}

let pass = 0, total = 0;
function check(name, cond) { total++; console.log(`${cond ? 'PASS' : 'FAIL'} - ${name}`); if (cond) pass++; }

initCharacterSelect();

check('CHARACTERS has 2 entries (kanata, kanade)', CHARACTERS.length === 2);
check('generates 1 slide per character', characterList.querySelectorAll('.char-slide').length === CHARACTERS.length);
check('generates 1 dot per character', selectDots.children.length === CHARACTERS.length);
check('first slide has in-view class', characterList.children[0].classList.contains('in-view'));
check('first dot has active class', selectDots.children[0].classList.contains('active'));

const kanataSlide = characterList.children[0];
check('kanata themeColor applied as --theme', kanataSlide.style.getPropertyValue('--theme') === '#7dd8ff');
check('kanata tagline rendered', kanataSlide.querySelector('.char-tagline').textContent === '一緒に、素敵な瞬間を。');
check('kanata name rendered', kanataSlide.querySelector('.char-name').textContent === '天音かなた');

const kanadeSlide = characterList.children[1];
check('kanade themeColor applied as --theme', kanadeSlide.style.getPropertyValue('--theme') === '#ff8fc0');
check('kanade tagline rendered', kanadeSlide.querySelector('.char-tagline').textContent === 'その音色に、寄り添って。');

// カードをタップして選択 → currentCharacterIndexが更新され、画面が閉じるか
kanadeSlide.querySelector('.char-pick-btn').click();
check('picking kanade sets currentCharacterIndex=1', currentCharacterIndex === 1);
check('picking a card hides the select screen', selectScreen.style.display === 'none');

console.log(`\n${pass}/${total} checks passed`);
process.exitCode = pass === total ? 0 : 1;
