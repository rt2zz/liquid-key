# Liquid key

One key with a whole interaction model. It can be tapped, double tapped, and
held, and while it is held, bubbles pull out of it, each tearing free where
letting go would act. The key has no meaning of its own: it reports what the
finger did, and draws the state the page gives it.

A design concept, as a web component: one classic script with no build step
and no dependencies, so it runs from `file://`.

## Try it

Open `index.html`. It's a phone with a text field beside the key or under
it, driving simulated dictation or a media player, in any of three themes.
The log beside it shows what the key reported and what happened.

## Use it

```html
<script src="liquid-key.js"></script>
<liquid-key></liquid-key>
<script>
  const key = document.querySelector('liquid-key');
  key.pulls = {
    up: { action: 'send', symbol: 'arrow-up', label: 'Send' },
    left: { action: 'undo', symbol: 'undo', label: 'Undo' },
  };
  key.addEventListener('tap', () => console.log('tap'));
  key.addEventListener('hold', () => console.log('hold'));
  key.addEventListener('action', (event) => console.log('pulled to', event.detail.action));
</script>
```

Events go out, and state comes in. The page listens for what the finger did
and sets what the key should show.

- **Gestures:** a press let go before 275 ms is a tap, or a double tap when
  it began within 300 ms of a tap's release. A press kept 275 ms within
  12 px is a hold. A bubble pulled out of the key arms where it tears free,
  and letting go there performs its action. A double tap latches the key
  until the next press.
- **Events:** `press`, `hold`, `slide`, `aim`, `tap`, `singletap`,
  `doubletap`, `action`, `release`, `presscancel`, `activechange` and
  `lockchange`. Exactly one of `tap`, `doubletap`, `action`, `release` and
  `presscancel` ends each press.
- **State:** `live`, `armed`, `aura` and `disabled`, as properties or
  attributes.
- **Configuration:** `pulls`, by direction (up, left, right, up-left or
  up-right); `symbol`, `live-symbol`, `armed-symbol`, `label`,
  `locked-label`, `hold-delay`, `double-tap-delay`, `size`, `no-latch`,
  `no-haptics`, `theme` and `geometry`. The last draws the gesture's
  geometry over the key.
- **Themes:** `outline` (the default), `glass` and `solid`. A theme is a set
  of `--liquid-key-*` custom properties, so your own is plain CSS.
- **Haptics:** these go through `LiquidKey.haptic(kind)`, which a native
  shell can replace.
- **Keyboard:** focus the key and hold Space or Enter. Arrows pull while it
  is held, and Escape cancels.

The full reference is the comment at the top of `liquid-key.js`.

## Files

- `liquid-key.js`: the component.
- `speech-engine.js` and `dictation.js`: a simulated speech engine, and the
  adapter that connects it to the key.
- `player.js`: a simulated media player, and its adapter.
- `index.html`: the sandbox.
- `test/behavior.html`: checks of the key's behavior on a hand-turned clock.
  Open it and it prints a line per check.

## License

MIT
