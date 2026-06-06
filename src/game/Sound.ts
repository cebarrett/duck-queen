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

export class Sound {
  private ctx: AudioContext | null = null

  private readonly quackSample = makeSample(QUACK_URL)
  private readonly peepSample = makeSample(PEEP_URL)

  constructor() {
    void this.fetch(this.quackSample) // optional — silently no-ops if absent
    void this.fetch(this.peepSample)

    const unlock = () => {
      this.getContext() // create + resume inside the gesture
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
  }

  /** The Queen's quack — recorded if available, else synthesized. */
  quack(): void {
    const ctx = this.getContext()
    if (!ctx) return
    this.playSampleOrSynth(ctx, this.quackSample, (c) => this.synthQuack(c), 1, 0.9)
  }

  /** A duckling's little peep. `pitch` (~0.85–1.25) gives each duckling its own
   *  voice — it scales the synth frequency, or the recording's playback speed. */
  peep(pitch = 1): void {
    const ctx = this.getContext()
    if (!ctx) return
    this.playSampleOrSynth(ctx, this.peepSample, (c) => this.synthPeep(c, pitch), pitch, 0.5)
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

  // --- Recorded-file path (shared by quack + peep) ---------------------------

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

  private playBuffer(ctx: AudioContext, buffer: AudioBuffer, pitch: number, volume: number): void {
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.playbackRate.value = pitch // shift a recording's pitch (per-duckling voice)
    const gain = ctx.createGain()
    gain.gain.value = volume
    src.connect(gain)
    gain.connect(ctx.destination)
    src.start()
  }

  // --- Synthesized fallbacks -------------------------------------------------

  /** A short, nasal, pitch-bent quack built from scratch. */
  private synthQuack(ctx: AudioContext): void {
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
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume()
    return this.ctx
  }
}
