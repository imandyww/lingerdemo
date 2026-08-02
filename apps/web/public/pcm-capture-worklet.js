class LingerPcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.targetRate = options.processorOptions?.targetSampleRate ?? 16000;
    this.chunkSamples = options.processorOptions?.chunkSamples ?? 3200;
    this.ratio = sampleRate / this.targetRate;
    this.pending = [];
    this.position = 0;
    this.output = [];
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;
    const frameCount = channels[0]?.length ?? 0;
    for (let frame = 0; frame < frameCount; frame += 1) {
      let mixed = 0;
      for (const channel of channels) mixed += channel[frame] ?? 0;
      this.pending.push(mixed / channels.length);
    }
    while (this.position + 1 < this.pending.length) {
      const left = Math.floor(this.position);
      const fraction = this.position - left;
      const sample = (this.pending[left] ?? 0) * (1 - fraction) + (this.pending[left + 1] ?? 0) * fraction;
      this.output.push(sample);
      this.position += this.ratio;
    }
    const consumed = Math.floor(this.position);
    if (consumed > 0) {
      this.pending.splice(0, consumed);
      this.position -= consumed;
    }
    while (this.output.length >= this.chunkSamples) {
      const samples = this.output.splice(0, this.chunkSamples);
      const buffer = new ArrayBuffer(samples.length * 2);
      const view = new DataView(buffer);
      for (let index = 0; index < samples.length; index += 1) {
        const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
        view.setInt16(index * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
      }
      this.port.postMessage(buffer, [buffer]);
    }
    return true;
  }
}

registerProcessor("linger-pcm-capture", LingerPcmCaptureProcessor);
