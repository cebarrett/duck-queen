/**
 * Sound plays the game's SFX. For voiced sounds (the quack, the ducklings' peep)
 * it prefers a real recording dropped into public/ — e.g. public/quack.mp3 served
 * at /quack.mp3 — and falls back to a synthesized version if the file is absent
 * (or hasn't decoded yet), so the game always makes a noise.
 *
 * Browser autoplay rules: an AudioContext starts "suspended" and can only be
 * resumed from a real user gesture. So we resume it on the first click/keypress,
 * which means by the time a sound actually plays (from the game loop) it's live.
 */

// Optional recordings. BASE_URL keeps these correct even under a sub-path.
const QUACK_URL = `${import.meta.env.BASE_URL}quack.mp3`
const PEEP_URL = `${import.meta.env.BASE_URL}peep.mp3`
const HONK_URL = `${import.meta.env.BASE_URL}honk.mp3`
const DRAKE_URL = `${import.meta.env.BASE_URL}drake.mp3` // male-mallard call
const HEN_URL = `${import.meta.env.BASE_URL}hen.mp3` // female-mallard quack

/** An optional recorded sound: its bytes (once fetched), the decoded buffer (once
 *  ready), and a flag so we don't decode twice at once. */
interface Sample {
  url: string
  raw: ArrayBuffer | null
  buffer: AudioBuffer | null
  decoding: boolean
}

function makeSample(url: string): Sample {
  return { url, raw: null, buffer: null, decoding: false }
}

// The quack is monophonic (one at a time) so mashing Q can't stack copies; this
// is the minimum gap between retriggers, to keep frantic mashing from machine-gunning.
const MIN_QUACK_GAP = 0.08

export class Sound {
  private ctx: AudioContext | null = null

  private readonly quackSample = makeSample(QUACK_URL)
  private readonly peepSample = makeSample(PEEP_URL)
  private readonly honkSample = makeSample(HONK_URL)
  private readonly drakeSample = makeSample(DRAKE_URL)
  private readonly henSample = makeSample(HEN_URL)

  // The currently-playing quack (so a new quack can cut it off) + when it started.
  private quackVoice: AudioScheduledSourceNode | null = null
  private lastQuackTime = -1

  constructor() {
    void this.fetch(this.quackSample) // optional — silently no-ops if absent
    void this.fetch(this.peepSample)
    void this.fetch(this.honkSample)
    void this.fetch(this.drakeSample)
    void this.fetch(this.henSample)

    const unlock = () => {
      this.getContext() // create + resume inside the gesture
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
  }

  /** The Queen's quack — recorded if available, else synthesized. Monophonic:
   *  mashing Q (e.g. during a honk-off) cuts the previous quack instead of piling
   *  copies on top of each other, and a short gap throttles frantic retriggers. */
  quack(): void {
    const ctx = this.getContext()
    if (!ctx) return

    const now = ctx.currentTime
    if (now - this.lastQuackTime < MIN_QUACK_GAP) return // ignore ultra-fast repeats
    this.lastQuackTime = now

    this.stopQuackVoice() // cut off any still-playing quack first

    let voice: AudioScheduledSourceNode
    if (this.quackSample.buffer) {
      voice = this.playBuffer(ctx, this.quackSample.buffer, 1, 0.9)
    } else {
      if (this.quackSample.raw) void this.decode(this.quackSample)
      voice = this.synthQuack(ctx)
    }
    this.quackVoice = voice
    voice.onended = () => {
      if (this.quackVoice === voice) this.quackVoice = null
    }
  }

  private stopQuackVoice(): void {
    if (!this.quackVoice) return
    try {
      this.quackVoice.stop()
    } catch {
      // already stopped/ended — fine
    }
    this.quackVoice = null
  }

  /** A duckling's little peep. `pitch` (~0.85–1.25) gives each duckling its own
   *  voice — it scales the synth frequency, or the recording's playback speed. */
  peep(pitch = 1): void {
    const ctx = this.getContext()
    if (!ctx) return
    this.playSampleOrSynth(ctx, this.peepSample, (c) => this.synthPeep(c, pitch), pitch, 0.5)
  }

  /** A goose's honk — recorded if available, else synthesized. Lower and harsher
   *  than a quack. `pitch` (~0.9–1.15) gives each goose its own voice. */
  honk(pitch = 1): void {
    const ctx = this.getContext()
    if (!ctx) return
    this.playSampleOrSynth(ctx, this.honkSample, (c) => this.synthHonk(c, pitch), pitch, 0.8)
  }

  /** A drake's (male mallard) call — soft, low and reedy, nothing like the female's
   *  quack. `pitch` (~0.8–1.05) gives each drake its own voice. */
  drakeCall(pitch = 1): void {
    const ctx = this.getContext()
    if (!ctx) return
    this.playSampleOrSynth(ctx, this.drakeSample, (c) => this.synthDrake(c, pitch), pitch, 0.5)
  }

  /** A hen's (female mallard) quack — a rounded "quack-quack", quieter than the
   *  Queen's command quack so it reads as ambient chatter, not a rally. `pitch`
   *  (~0.95–1.2) gives each hen its own voice. */
  henQuack(pitch = 1): void {
    const ctx = this.getContext()
    if (!ctx) return
    this.playSampleOrSynth(ctx, this.henSample, (c) => this.synthHen(c, pitch), pitch, 0.7)
  }

  /**
   * A little water splash. `strength` (~0–6) scales the volume. A short burst of
   * white noise pushed through a downward-sweeping lowpass — that "ploosh, fading
   * to a low gurgle" shape reads as water rather than static.
   */
  splash(strength = 1): void {
    const ctx = this.getContext()
    if (!ctx) return

    const now = ctx.currentTime
    const dur = 0.28
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
    const src = ctx.createBufferSource()
    src.buffer = buffer

    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.setValueAtTime(1800, now)
    lp.frequency.exponentialRampToValueAtTime(350, now + dur)

    const gain = ctx.createGain()
    const vol = Math.min(0.5, 0.16 + strength * 0.05)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(vol, now + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur)

    src.connect(lp)
    lp.connect(gain)
    gain.connect(ctx.destination)
    src.start(now)
    src.stop(now + dur)
  }

  // --- Recorded-file path (shared by every voiced sound) ---------------------

  private playSampleOrSynth(
    ctx: AudioContext,
    sample: Sample,
    synth: (ctx: AudioContext) => void,
    pitch: number,
    volume: number,
  ): void {
    if (sample.buffer) {
      this.playBuffer(ctx, sample.buffer, pitch, volume)
      return
    }
    // Have the bytes but not decoded yet — kick that off and synth for now.
    if (sample.raw) void this.decode(sample)
    synth(ctx)
  }

  private async fetch(sample: Sample): Promise<void> {
    try {
      const res = await fetch(sample.url)
      if (!res.ok) return // 404 = no recording; fine, we use the synth
      // Vite's dev server answers a MISSING file with index.html (200, text/html)
      // rather than a 404, so only accept an actual audio file.
      const type = res.headers.get('content-type') ?? ''
      if (type.includes('text/html')) return
      sample.raw = await res.arrayBuffer()
      if (this.ctx) await this.decode(sample)
    } catch {
      // Network/parse trouble — stay on the synth.
    }
  }

  private async decode(sample: Sample): Promise<void> {
    if (!this.ctx || !sample.raw || sample.buffer || sample.decoding) return
    sample.decoding = true
    try {
      // decodeAudioData can "detach" the buffer, so decode a copy.
      sample.buffer = await this.ctx.decodeAudioData(sample.raw.slice(0))
      sample.raw = null
    } catch {
      sample.raw = null // undecodable — fall back to synth for good
    } finally {
      sample.decoding = false
    }
  }

  private playBuffer(ctx: AudioContext, buffer: AudioBuffer, pitch: number, volume: number): AudioBufferSourceNode {
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.playbackRate.value = pitch // shift a recording's pitch (per-duckling voice)
    const gain = ctx.createGain()
    gain.gain.value = volume
    src.connect(gain)
    gain.connect(ctx.destination)
    src.start()
    return src
  }

  // --- Synthesized fallbacks -------------------------------------------------

  /** A short, nasal, pitch-bent quack built from scratch. */
  private synthQuack(ctx: AudioContext): OscillatorNode {
    const now = ctx.currentTime
    const pitch = 1 + (Math.random() * 0.2 - 0.1) // ±10% per quack, for variety

    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    const f = osc.frequency
    f.setValueAtTime(600 * pitch, now)
    f.linearRampToValueAtTime(720 * pitch, now + 0.03)
    f.exponentialRampToValueAtTime(170 * pitch, now + 0.18)

    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 1000
    band.Q.value = 4

    const gain = ctx.createGain()
    const g = gain.gain
    g.setValueAtTime(0.0001, now)
    g.exponentialRampToValueAtTime(0.35, now + 0.012)
    g.exponentialRampToValueAtTime(0.0001, now + 0.22)

    osc.connect(band)
    band.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.25)
    return osc
  }

  /** A tiny high chirp — soft triangle wave, a quick up-then-down pitch blip.
   *  High and short reads as "duckling peep". `pitch` sets the voice. */
  private synthPeep(ctx: AudioContext, pitch: number): void {
    const now = ctx.currentTime
    const dur = 0.12
    const base = 1100 * pitch

    const osc = ctx.createOscillator()
    osc.type = 'triangle' // softer than a sawtooth, brighter than a sine
    const f = osc.frequency
    f.setValueAtTime(base * 0.85, now)
    f.exponentialRampToValueAtTime(base * 1.25, now + 0.05) // quick chirp up
    f.exponentialRampToValueAtTime(base * 0.9, now + dur) // settle down

    const gain = ctx.createGain()
    const g = gain.gain
    g.setValueAtTime(0.0001, now)
    g.exponentialRampToValueAtTime(0.14, now + 0.01) // soft — they're little
    g.exponentialRampToValueAtTime(0.0001, now + dur)

    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + dur + 0.02)
  }

  /** A honk — lower, harsher and longer than the quack: a sawtooth that blips up
   *  ("ho-") then falls ("-onk"), through a low bandpass. `pitch` sets the voice. */
  private synthHonk(ctx: AudioContext, pitch: number): void {
    const now = ctx.currentTime
    const dur = 0.32
    const base = 300 * pitch

    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    const f = osc.frequency
    f.setValueAtTime(base, now)
    f.linearRampToValueAtTime(base * 1.25, now + 0.06) // "ho-"
    f.exponentialRampToValueAtTime(base * 0.7, now + dur) // "-onk"

    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 700
    band.Q.value = 3

    const gain = ctx.createGain()
    const g = gain.gain
    g.setValueAtTime(0.0001, now)
    g.exponentialRampToValueAtTime(0.4, now + 0.02)
    g.exponentialRampToValueAtTime(0.0001, now + dur)

    osc.connect(band)
    band.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + dur + 0.02)
  }

  /** A drake's reedy nasal call — a low sawtooth dropping a little, squeezed
   *  through a narrow bandpass for a buzzy "rhaeb", and kept quiet (drakes are
   *  much softer than the loud hen). `pitch` sets the voice. */
  private synthDrake(ctx: AudioContext, pitch: number): void {
    const now = ctx.currentTime
    const dur = 0.2
    const base = 175 * pitch

    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    const f = osc.frequency
    f.setValueAtTime(base * 1.15, now)
    f.linearRampToValueAtTime(base, now + 0.05)
    f.exponentialRampToValueAtTime(base * 0.8, now + dur) // settle lower

    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 1300 // a narrow, reedy/nasal band
    band.Q.value = 9

    const gain = ctx.createGain()
    const g = gain.gain
    g.setValueAtTime(0.0001, now)
    g.exponentialRampToValueAtTime(0.12, now + 0.02) // quiet
    g.exponentialRampToValueAtTime(0.0001, now + dur)

    osc.connect(band)
    band.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + dur + 0.02)
  }

  /** A hen's two-syllable "quack-quack" — a sawtooth through a bandpass with the
   *  pitch falling twice and two gain bumps, lower-volume than the Queen's command
   *  quack so it reads as ambient chatter. `pitch` sets the voice. */
  private synthHen(ctx: AudioContext, pitch: number): void {
    const now = ctx.currentTime
    const dur = 0.32
    const base = 520 * pitch

    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    const f = osc.frequency
    f.setValueAtTime(base * 1.1, now)
    f.linearRampToValueAtTime(base, now + 0.04)
    f.exponentialRampToValueAtTime(base * 0.65, now + 0.11) // first syllable falls
    f.setValueAtTime(base * 1.0, now + 0.14) // jump up for the second
    f.exponentialRampToValueAtTime(base * 0.55, now + dur) // second falls

    const band = ctx.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.value = 900
    band.Q.value = 3

    const gain = ctx.createGain()
    const g = gain.gain
    g.setValueAtTime(0.0001, now)
    g.exponentialRampToValueAtTime(0.22, now + 0.02) // first "quack"
    g.exponentialRampToValueAtTime(0.05, now + 0.11) // dip between syllables
    g.exponentialRampToValueAtTime(0.2, now + 0.16) // second "quack"
    g.exponentialRampToValueAtTime(0.0001, now + dur)

    osc.connect(band)
    band.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + dur + 0.02)
  }

  // --- Context plumbing ------------------------------------------------------

  private getContext(): AudioContext | null {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      this.ctx = new Ctor()
      void this.decode(this.quackSample) // decode anything already fetched
      void this.decode(this.peepSample)
      void this.decode(this.honkSample)
      void this.decode(this.drakeSample)
      void this.decode(this.henSample)
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }
}
