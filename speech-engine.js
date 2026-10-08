/*
 * A simulated speech engine, so the sandbox's key can be tried without a
 * microphone. A tap arms a one-shot command, a double tap dictates
 * hands-free until the next press, and a hold dictates until release, with
 * send, undo, and fix around them. Speech is scripted: words arrive while it
 * dictates, and a tapped command hears nothing, so its attention runs out.
 *
 * It knows nothing of the key. The sandbox turns the key's events into these
 * calls and the engine's state into the key's properties, which is how a
 * real engine plugs in too.
 *
 *   open()                  a press came down: open a stream, or press on the live one
 *   key(action)             what the press became: hold, tap, doubleTap, fixPrompt, dictate
 *   finish({ send, fix })   let go: insert what was heard, then send or fix
 *   cancel()                drop the stream and what it heard
 *   openCommands()          a tap stayed single: the commands open while one is armed
 *   undo(), fix(), send()   act on the field directly
 *
 * State: stream ('idle' | 'starting' | 'streaming'), sending, mode ('off' |
 * 'ready' | 'command' | 'dictation'), commandArmed, connected, and live. It
 * dispatches change when that state changes, and action events whose detail
 * has a kind: start, heard {text, prompt}, insert {text}, send, undo, fix
 * {prompt}, command {state}, commands, cancel, end {reason}.
 */
(() => {
  'use strict';

  const SPEECH = [
    'this key runs in any browser',
    'pull up to send and slide sideways to fix or undo',
    'it tears free right where the two circles part',
    'every theme keeps the same timing',
    'hold to dictate and let go to insert',
  ];
  const PROMPTS = ['make it more formal', 'fix the punctuation', 'say it in fewer words'];
  // The engine accepting a new stream.
  const ACCEPT_MS = 90;
  // Simulated speech, about three and a half words a second.
  const WORD_MS = 280;
  // A command's attention window.
  const ATTENTION_MS = 6000;

  class SpeechEngine extends EventTarget {
    constructor({ speech = SPEECH, prompts = PROMPTS } = {}) {
      super();
      this.lines = { speech, prompts };
      this.stream = 'idle';
      this.sending = false;
      this.mode = 'off';
      this.commandArmed = false;
      this.connected = true;
      this.streams = 0;
      // The engine's side of the live stream.
      this.session = null;
      this.pending = [];
      this.requests = { release: false, send: false, fix: false };
      this.timers = new Map();
      this.speech = { line: 0, word: 0, pause: 0 };
      this.prompt = { line: 0, word: 0, pause: 0 };
      this.ticker = 0;
    }

    /** A stream is open and not finishing a send. */
    get live() {
      return this.stream !== 'idle' && !this.sending;
    }

    // MARK: Presses

    /** The first press opens a stream; a press while it is live is another key-down on it. */
    open() {
      // A finishing stream ends as the finger comes down; this press starts a new one.
      if (this.timers.has('tail')) this.completeFinish();
      if (this.stream === 'idle') this.start();
      else this.deliver('press');
    }

    /** What the current press turned out to be. */
    key(action) {
      this.deliver(action);
    }

    /** The finger let go: keep a short tail, then finish what was heard. */
    finish({ send = false, fix = false } = {}) {
      if (this.stream === 'idle') return;
      if (send) {
        this.requests.send = true;
        this.sending = true;
      }
      if (fix) this.requests.fix = true;
      if (this.stream !== 'streaming') {
        this.requests.release = true;
        this.changed();
        return;
      }
      this.changed();
      this.after('tail', 200, () => this.completeFinish());
    }

    completeFinish() {
      this.cancelTimer('tail');
      if (!this.session) return;
      const { send, fix } = this.requests;
      this.stopMicrophone();
      this.conclude(send, fix);
    }

    /** Drops the stream and what it heard. */
    cancel() {
      if (this.stream === 'idle') return;
      this.stopMicrophone();
      if (this.session) {
        this.emit('cancel');
        this.end();
      }
    }

    /** A tap that stayed single: with its command still armed, the commands open. */
    openCommands() {
      if (this.stream !== 'idle' && this.commandArmed) this.emit('commands');
    }

    /** Undoes the last insertion. */
    undo() {
      this.emit('undo');
    }

    /** Fixes the field, with no prompt. */
    fix() {
      this.emit('fix', { prompt: '' });
    }

    /** Sends the field as it is. */
    send() {
      this.emit('send');
    }

    start() {
      if (!this.connected) return;
      const id = ++this.streams;
      this.session = { latched: false, endingLatch: false, endingCommand: false, fixPrompt: false, heard: [], prompt: [] };
      this.pending = [];
      this.requests = { release: false, send: false, fix: false };
      this.stream = 'starting';
      this.sending = false;
      this.emit('start');
      this.changed();
      this.after('accept', ACCEPT_MS, () => {
        if (this.streams !== id || this.stream !== 'starting') return;
        this.stream = 'streaming';
        this.down(true);
        for (const action of this.pending.splice(0)) this.resolve(action);
        if (this.requests.release) this.finish();
        this.changed();
      });
    }

    /** Key actions go out in order, on whichever stream is live. */
    deliver(action) {
      if (this.stream === 'starting') this.pending.push(action);
      else if (this.stream === 'streaming') this.resolve(action);
    }

    stopMicrophone() {
      this.cancelTimer('accept');
      this.cancelTimer('tail');
      this.stream = 'idle';
      this.sending = false;
      this.pending = [];
      this.changed();
    }

    // MARK: Resolving presses

    down(first) {
      const session = this.session;
      if (session.latched) {
        // The press that ends hands-free dictation.
        session.latched = false;
        session.endingLatch = true;
      } else if (this.commandArmed) {
        // A press after the double-tap window disarms the command.
        this.cancelTimer('arm');
        session.endingCommand = true;
        this.set({ commandArmed: false, mode: 'ready' });
      } else if (first) {
        this.set({ mode: 'ready' });
      }
      this.listen();
    }

    resolve(action) {
      const session = this.session;
      if (!session) return;
      if (action === 'press') return this.down(false);
      switch (action) {
        case 'hold':
          session.endingLatch = session.endingCommand = false;
          this.set({ mode: 'dictation' });
          break;
        case 'tap':
          // The tap that ends dictation finalizes it, so the last words are inserted.
          if (session.endingLatch) return this.conclude(false, false);
          if (session.endingCommand) return this.end('Command disarmed');
          this.set({ commandArmed: true, mode: 'command' });
          this.emit('command', { state: 'armed' });
          this.after('arm', ATTENTION_MS, () => {
            this.emit('command', { state: 'expired' });
            this.end('No command heard');
          });
          break;
        case 'doubleTap':
          this.cancelTimer('arm');
          session.endingCommand = false;
          session.latched = true;
          this.set({ commandArmed: false, mode: 'dictation' });
          break;
        case 'fixPrompt':
          // What was heard is inserted; what follows is Fix's prompt.
          this.insertHeard();
          session.fixPrompt = true;
          break;
        case 'dictate':
          session.fixPrompt = false;
          session.prompt = [];
          this.emit('heard', { text: session.heard.join(' '), prompt: '' });
          break;
      }
      this.listen();
    }

    /** Inserts what was heard, then sends or fixes. */
    conclude(send, fix) {
      const session = this.session;
      if (!session) return;
      this.insertHeard();
      if (fix) this.emit('fix', { prompt: session.prompt.join(' ') });
      else if (send) this.emit('send');
      this.end();
    }

    end(reason) {
      this.cancelTimer('arm');
      this.session = null;
      this.set({ mode: 'off', commandArmed: false });
      if (this.stream !== 'idle') this.stopMicrophone();
      this.listen();
      this.emit('heard', { text: '', prompt: '' });
      this.emit('end', { reason });
    }

    insertHeard() {
      const session = this.session;
      if (!session || !session.heard.length) return;
      const text = session.heard.join(' ');
      session.heard = [];
      this.emit('insert', { text });
      this.emit('heard', { text: '', prompt: session.prompt.join(' ') });
    }

    // MARK: Simulated speech

    get hearing() {
      return this.session != null && this.stream === 'streaming' && this.mode === 'dictation';
    }

    listen() {
      const on = this.hearing;
      if (on && !this.ticker) {
        // Each capture starts at the beginning of a sentence.
        for (const speech of [this.speech, this.prompt]) {
          if (speech.word) {
            speech.word = 0;
            speech.line++;
          }
          speech.pause = 1;
        }
        this.ticker = setInterval(() => this.speak(), WORD_MS);
      } else if (!on && this.ticker) {
        clearInterval(this.ticker);
        this.ticker = 0;
      }
    }

    speak() {
      const session = this.session;
      if (!session) return;
      const toFix = session.fixPrompt;
      const speech = toFix ? this.prompt : this.speech;
      if (speech.pause > 0) {
        speech.pause--;
        return;
      }
      const lines = toFix ? this.lines.prompts : this.lines.speech;
      const words = lines[speech.line % lines.length].split(' ');
      const word = words[speech.word++];
      const done = speech.word >= words.length;
      if (done) {
        speech.word = 0;
        speech.line++;
        speech.pause = 3;
      }
      (toFix ? session.prompt : session.heard).push(word);
      this.emit('heard', { text: session.heard.join(' '), prompt: session.prompt.join(' ') });
      // Hands-free dictation inserts each utterance as it completes.
      if (done && session.latched && !toFix) this.insertHeard();
    }

    // MARK: Plumbing

    set(patch) {
      Object.assign(this, patch);
      this.changed();
    }

    changed() {
      this.dispatchEvent(new Event('change'));
    }

    emit(kind, detail = {}) {
      this.dispatchEvent(new CustomEvent('action', { detail: { kind, ...detail } }));
    }

    after(name, ms, fn) {
      this.cancelTimer(name);
      this.timers.set(name, setTimeout(() => {
        this.timers.delete(name);
        fn();
      }, ms));
    }

    cancelTimer(name) {
      clearTimeout(this.timers.get(name));
      this.timers.delete(name);
    }
  }

  window.SpeechEngine = SpeechEngine;
})();
