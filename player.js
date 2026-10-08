/*
 * A simulated media player, and the adapter that lets a liquid-key drive it:
 * the same key and the same gestures as dictation, with no speech at all.
 *
 *   tap          play or pause, once the tap can't become a double tap
 *   double tap   like the track
 *   hold         double speed until the finger lifts
 *   pull left    the track before, or back to the start of this one
 *   pull right   the next track
 *   pull up      add the track to the queue
 *
 * The key is live while a track plays, and its aura takes the track's color.
 *
 *   Object.assign(key, connectPlayer.config);
 *   const disconnect = connectPlayer(key, new Player());
 */
(() => {
  'use strict';

  const TRACKS = [
    { title: 'Low Tide', artist: 'Harbor Lights', length: 214, hue: 196 },
    { title: 'Paper Planes at Noon', artist: 'The Quiet Hours', length: 187, hue: 28 },
    { title: 'Northern Line', artist: 'Mira Vale', length: 243, hue: 268 },
    { title: 'Glass Garden', artist: 'Juniper & Oak', length: 198, hue: 146 },
    { title: 'Slow Orbit', artist: 'Field Notes', length: 226, hue: 336 },
  ];
  // Playback advances in steps this long.
  const STEP_MS = 250;
  // Past this far into a track, the track before means this one's start.
  const RESTART_S = 3;

  // The player's symbols, after SF Symbols on a 24-unit grid.
  const SYMBOLS = {
    play: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5.6v12.8a1.1 1.1 0 0 0 1.68.94l10.2-6.4a1.1 1.1 0 0 0 0-1.88L9.68 4.66A1.1 1.1 0 0 0 8 5.6Z"/></svg>',
    backward: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="2.6" height="14" rx="1.3" fill="currentColor"/>' +
      '<path fill="currentColor" d="M20 6.4v11.2a1.1 1.1 0 0 1-1.7.92l-8.5-5.6a1.1 1.1 0 0 1 0-1.84l8.5-5.6A1.1 1.1 0 0 1 20 6.4Z"/></svg>',
    forward: '<svg viewBox="0 0 24 24"><rect x="17.4" y="5" width="2.6" height="14" rx="1.3" fill="currentColor"/>' +
      '<path fill="currentColor" d="M4 6.4v11.2a1.1 1.1 0 0 0 1.7.92l8.5-5.6a1.1 1.1 0 0 0 0-1.84l-8.5-5.6A1.1 1.1 0 0 0 4 6.4Z"/></svg>',
    queue: '<svg viewBox="0 0 24 24"><path class="stroke" d="M4 6.5h11M4 12h11M4 17.5h7M18.5 14v7M15 17.5h7"/></svg>',
  };
  for (const [name, markup] of Object.entries(SYMBOLS)) {
    if (window.LiquidKey && !(name in LiquidKey.symbols)) LiquidKey.symbols[name] = markup;
  }

  /**
   * Plays a list of tracks in simulated time. It dispatches change when its
   * state changes, and action events whose detail has a kind: play, pause,
   * previous, next, like {liked}, queue, speed {speed}, each with the track.
   */
  class Player extends EventTarget {
    constructor(tracks = TRACKS) {
      super();
      this.tracks = tracks;
      this.index = 0;
      this.position = 0;
      this.playing = false;
      this.speed = 1;
      this.liked = new Set();
      // The tracks up next, by index.
      this.queue = [1, 2, 3];
      this.ticker = 0;
    }

    get track() {
      return this.tracks[this.index];
    }

    toggle() {
      if (this.playing) this.pause();
      else this.play();
    }

    play() {
      if (this.playing) return;
      this.playing = true;
      this.ticker = setInterval(() => this.advance(), STEP_MS);
      this.emit('play');
      this.changed();
    }

    pause() {
      if (!this.playing) return;
      this.playing = false;
      this.speed = 1;
      clearInterval(this.ticker);
      this.ticker = 0;
      this.emit('pause');
      this.changed();
    }

    advance() {
      this.position += (STEP_MS / 1000) * this.speed;
      if (this.position >= this.track.length) this.next();
      else this.changed();
    }

    /** The track before, or back to the start of this one once it has played a while. */
    previous() {
      if (this.position < RESTART_S) this.index = (this.index - 1 + this.tracks.length) % this.tracks.length;
      this.position = 0;
      this.emit('previous');
      this.changed();
    }

    next() {
      this.index = this.queue.shift() ?? (this.index + 1) % this.tracks.length;
      this.position = 0;
      while (this.queue.length < 3) this.queue.push(((this.queue.at(-1) ?? this.index) + 1) % this.tracks.length);
      this.emit('next');
      this.changed();
    }

    like() {
      const liked = !this.liked.has(this.index);
      if (liked) this.liked.add(this.index);
      else this.liked.delete(this.index);
      this.emit('like', { liked });
      this.changed();
    }

    /** Adds the playing track to the end of the queue, to hear again. */
    enqueue() {
      this.queue.push(this.index);
      this.emit('queue');
      this.changed();
    }

    setSpeed(speed) {
      if (speed === this.speed || (speed !== 1 && !this.playing)) return;
      this.speed = speed;
      this.emit('speed', { speed });
      this.changed();
    }

    changed() {
      this.dispatchEvent(new Event('change'));
    }

    emit(kind, detail = {}) {
      this.dispatchEvent(new CustomEvent('action', { detail: { kind, track: this.track, ...detail } }));
    }
  }

  /** Connects the key to the player, and returns a function that parts them. */
  function connectPlayer(key, player) {
    const handlers = {
      // A tap plays or pauses once it can't become a double tap.
      singletap: () => player.toggle(),
      doubletap: () => player.like(),
      // Holding plays at double speed until the finger lifts.
      hold: () => player.setSpeed(2),
      release: () => player.setSpeed(1),
      presscancel: () => player.setSpeed(1),
      action: (press) => {
        player.setSpeed(1);
        if (press.action === 'previous') player.previous();
        else if (press.action === 'next') player.next();
        else if (press.action === 'queue') player.enqueue();
      },
    };
    const listeners = Object.entries(handlers).map(([type, handle]) => [type, (event) => handle(event.detail)]);
    const reflect = () => {
      key.disabled = false;
      key.armed = false;
      key.live = player.playing;
      // The aura takes the track's color while it plays.
      key.aura = player.playing ? `hsl(${player.track.hue} 80% 62%)` : '';
    };
    for (const [type, listener] of listeners) key.addEventListener(type, listener);
    player.addEventListener('change', reflect);
    reflect();
    return () => {
      for (const [type, listener] of listeners) key.removeEventListener(type, listener);
      player.removeEventListener('change', reflect);
    };
  }

  // The key this adapter expects.
  connectPlayer.config = {
    symbol: 'play',
    liveSymbol: 'waveform',
    armedSymbol: '',
    noLatch: true,
    label: 'Tap to play or pause, double tap to like, hold for double speed',
    lockedLabel: null,
    pulls: {
      up: { action: 'queue', symbol: 'queue', label: 'Add to queue' },
      left: { action: 'previous', symbol: 'backward', label: 'Previous track' },
      right: { action: 'next', symbol: 'forward', label: 'Next track' },
    },
  };

  window.Player = Player;
  window.connectPlayer = connectPlayer;
})();
