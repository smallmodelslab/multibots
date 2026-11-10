// A voice chat on the user's own models hears the user in the window or on
// the phone: what the microphone hears, cut into what they say between
// pauses, each sent as 16-bit mono WAV at the rate transcription models
// take.

export const hearingRate = 16_000;

// How loud a voice must be, as the root mean square of its samples, to count
// as speaking.
export const speakingLevel = 0.02;

// Speech starts once the microphone has been this loud for this long, and
// ends after this long quieter; a little of what came before it is kept, so
// its first sound is not cut off.
const speechMs = 150;
const pauseMs = 800;
const beforeMs = 300;
const longestMs = 30_000;

export const loudness = (samples: Float32Array) =>
  Math.sqrt(
    samples.reduce((sum, sample) => sum + sample * sample, 0) /
      Math.max(1, samples.length),
  );

// Samples at `rate` brought to the hearing rate: each the mean of the ones
// it stands for.
export const toHearingRate = (raw: Float32Array, rate: number) => {
  const step = rate / hearingRate;
  if (step === 1) return raw;
  const samples = new Float32Array(Math.floor(raw.length / step));
  for (let index = 0; index < samples.length; index += 1) {
    const from = Math.floor(index * step);
    const to = Math.floor((index + 1) * step);
    let sum = 0;
    for (let at = from; at < to; at += 1) sum += raw[at]!;
    samples[index] = sum / (to - from);
  }
  return samples;
};

export const wav = (samples: Float32Array) => {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const text = (at: number, value: string) => {
    for (let index = 0; index < value.length; index += 1)
      view.setUint8(at + index, value.charCodeAt(index));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, hearingRate, true);
  view.setUint32(28, hearingRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) =>
    view.setInt16(
      44 + index * 2,
      Math.max(-1, Math.min(1, sample)) * 0x7fff,
      true,
    ),
  );
  return new Uint8Array(view.buffer);
};

// Takes the microphone's samples at the hearing rate as they come, and hands
// `onSaid` each thing the user said once they pause. While the bot speaks it
// hears nothing, so that it does not hear the bot.
export const createHearing = (onSaid: (samples: Float32Array) => void) => {
  const ms = (samples: number) => (samples / hearingRate) * 1000;
  const length = (pieces: Float32Array[]) =>
    pieces.reduce((sum, piece) => sum + piece.length, 0);
  const join = (pieces: Float32Array[]) => {
    const all = new Float32Array(length(pieces));
    let at = 0;
    for (const piece of pieces) {
      all.set(piece, at);
      at += piece.length;
    }
    return all;
  };
  let before: Float32Array[] = [];
  let said: Float32Array[] = [];
  let loud = 0;
  let quiet = 0;
  return (samples: Float32Array, botSpeaking: boolean) => {
    if (botSpeaking) {
      before = [];
      said = [];
      loud = 0;
      return;
    }
    const level = loudness(samples);
    if (!said.length) {
      before.push(samples);
      while (ms(length(before)) > beforeMs) before.shift();
      loud = level > speakingLevel ? loud + samples.length : 0;
      if (ms(loud) >= speechMs) {
        said = before;
        before = [];
        quiet = 0;
      }
      return;
    }
    said.push(samples);
    quiet = level > speakingLevel ? 0 : quiet + samples.length;
    if (ms(quiet) >= pauseMs || ms(length(said)) >= longestMs) {
      onSaid(join(said));
      said = [];
      loud = 0;
    }
  };
};
