/*
 * Dictation: a liquid-key driving a speech engine. This is the whole
 * contract between them. The key's events become the engine's calls, and the
 * engine's state becomes the key's properties; any engine with these calls
 * plugs in the same way.
 *
 *   Object.assign(key, connectDictation.config);
 *   const disconnect = connectDictation(key, new SpeechEngine());
 */
(() => {
  'use strict';

  // How the engine is taking speech, as the aura shows it.
  const MODES = {
    ready: 'color(srgb 0.42 0.66 0.52)',
    command: 'color(srgb 0.71 0.54 0.94)',
    dictation: 'color(srgb 0.82 0.6 0.26)',
  };

  /** Connects the key to the engine, and returns a function that parts them. */
  function connectDictation(key, engine) {
    const handlers = {
      // The microphone opens on touch-down, so the first words are kept.
      press: () => engine.open(),
      hold: (press) => {
        engine.key('hold');
        // A press ending hands-free dictation may be aiming Fix already.
        if (press.aim === 'fix') engine.key('fixPrompt');
      },
      // While dictating, speech with Fix armed is its prompt; backing off,
      // it is dictation again.
      aim: (press) => {
        if (!press.held && press.ending !== 'lock') return;
        if (press.previous === 'fix') engine.key('dictate');
        if (press.action === 'fix') engine.key('fixPrompt');
      },
      // A slide hears nothing, but one ending a command still ends it, as
      // its tap would.
      slide: (press) => (press.ending ? engine.key('tap') : engine.cancel()),
      tap: () => engine.key('tap'),
      singletap: (press) => press.ending || engine.openCommands(),
      doubletap: () => engine.key('doubleTap'),
      release: (press) => press.held && engine.finish(),
      action: (press) => {
        if (press.action === 'undo') {
          engine.cancel();
          engine.undo();
        } else if (press.action === 'fix') {
          if (engine.stream === 'idle') engine.fix();
          else engine.finish({ fix: true });
        } else if (press.slid) {
          // Nothing was heard, so the field goes as it is.
          engine.send();
        } else {
          engine.finish({ send: true });
        }
      },
      presscancel: (press) => press.slid || engine.cancel(),
    };
    const listeners = Object.entries(handlers).map(([type, handle]) => [type, (event) => handle(event.detail)]);
    const reflect = () => {
      key.disabled = !engine.connected;
      key.live = engine.live;
      key.armed = engine.commandArmed;
      // The aura shows how speech is being taken, while the key is live.
      key.aura = engine.live ? MODES[engine.mode] ?? '' : '';
    };
    for (const [type, listener] of listeners) key.addEventListener(type, listener);
    engine.addEventListener('change', reflect);
    reflect();
    return () => {
      for (const [type, listener] of listeners) key.removeEventListener(type, listener);
      engine.removeEventListener('change', reflect);
    };
  }

  connectDictation.modes = MODES;
  // The key this adapter expects: the key's own defaults, spelled out so a
  // key set up for something else can be set back.
  connectDictation.config = {
    symbol: 'mic',
    liveSymbol: 'waveform',
    armedSymbol: 'command',
    noLatch: false,
    label: null,
    lockedLabel: null,
    pulls: {
      up: { action: 'send', symbol: 'arrow-up', label: 'Send' },
      left: { action: 'undo', symbol: 'undo', label: 'Undo' },
      right: { action: 'fix', symbol: 'wand', label: 'Fix' },
    },
  };
  window.connectDictation = connectDictation;
})();
