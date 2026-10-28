/* Startskript des Publikumsfensters. */
(function () {
  'use strict';
  const T = window.JudoTransport;
  const board = window.JudoBoard.mount(document.getElementById('board'), { sound: true });
  const wait = document.getElementById('wait');
  const hint = document.getElementById('hint');

  T.boardListen((view) => {
    wait.style.display = 'none';
    board.update(view);
  });

  document.addEventListener('dblclick', () => T.toggleFullscreen());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F' || e.key === 'F11') {
      e.preventDefault();
      T.toggleFullscreen();
    }
    if (e.key === 'Escape' && T.isElectron) T.bridge.setBoardFullscreen(false);
  });

  // Mauszeiger und Hinweis nach kurzer Zeit ausblenden
  let t = 0;
  function poke() {
    document.body.classList.remove('hide-cursor');
    hint.classList.add('on');
    clearTimeout(t);
    t = setTimeout(() => {
      document.body.classList.add('hide-cursor');
      hint.classList.remove('on');
    }, 2500);
  }
  document.addEventListener('mousemove', poke);
  poke();

  // Browser: Ton darf erst nach einem Klick ins Anzeigefenster starten
  if (T.isElectron) {
    document.addEventListener('click', () => window.JudoSound.unlock(), { once: true });
  } else {
    const soundHint = document.getElementById('soundHint');
    const check = () => soundHint.classList.toggle('on', window.JudoSound.locked());
    window.JudoSound.unlock();
    setTimeout(check, 500);
    setInterval(check, 2000);
    document.addEventListener('click', () => {
      window.JudoSound.unlock();
      setTimeout(check, 200);
    });
  }
})();
