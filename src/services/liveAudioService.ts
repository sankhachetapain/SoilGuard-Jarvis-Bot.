/**
 * Live Audio Service for Gemini 3.8 Live API
 * Handles 16kHz PCM microphone capture and 24kHz gapless playback over WebSockets
 */

export interface LiveCallbacks {
  onReady?: () => void;
  onAudioChunk?: () => void;
  onText?: (text: string, role: 'user' | 'model') => void;
  onInterrupted?: () => void;
  onVolumeChange?: (volume: number) => void;
  onError?: (err: string) => void;
  onClose?: () => void;
}

export class LiveAudioSession {
  private ws: WebSocket | null = null;
  private inputAudioCtx: AudioContext | null = null;
  private outputAudioCtx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;
  private nextStartTime: number = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  private callbacks: LiveCallbacks;
  private isConnecting: boolean = false;
  private isConnected: boolean = false;

  constructor(callbacks: LiveCallbacks) {
    this.callbacks = callbacks;
  }

  async start(language: string = 'en-US') {
    if (this.isConnected || this.isConnecting) return;
    this.isConnecting = true;

    try {
      // 1. Initialize output AudioContext (24kHz for Gemini Live model output)
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.outputAudioCtx = new AudioCtx({ sampleRate: 24000 });
      if (this.outputAudioCtx.state === 'suspended') {
        await this.outputAudioCtx.resume();
      }
      this.nextStartTime = this.outputAudioCtx.currentTime;

      // 2. Connect WebSocket to /live
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/live?lang=${encodeURIComponent(language)}`;
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = async () => {
        console.log("[LiveAudio] WebSocket connected to", wsUrl);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.ready) {
            this.isConnected = true;
            this.isConnecting = false;
            this.callbacks.onReady?.();
          }

          if (data.audio && this.outputAudioCtx) {
            this.playAudioChunk(data.audio);
            this.callbacks.onAudioChunk?.();
          }

          if (data.text) {
            this.callbacks.onText?.(data.text, data.role || 'model');
          }

          if (data.interrupted) {
            this.stopPlayback();
            this.callbacks.onInterrupted?.();
          }

          if (data.error) {
            console.error("[LiveAudio] Server error:", data.error);
            this.callbacks.onError?.(data.error);
          }

          if (data.closed) {
            this.stop();
          }
        } catch (e) {
          console.error("[LiveAudio] Message parse error:", e);
        }
      };

      this.ws.onerror = (e) => {
        console.error("[LiveAudio] WebSocket error:", e);
        this.callbacks.onError?.("Live connection error");
        this.stop();
      };

      this.ws.onclose = () => {
        console.log("[LiveAudio] WebSocket closed");
        this.stop();
      };

      // 3. Capture microphone audio (16kHz PCM little-endian)
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          channelCount: 1, 
          echoCancellation: true, 
          noiseSuppression: true, 
          autoGainControl: true 
        } 
      });

      this.inputAudioCtx = new AudioCtx();
      if (this.inputAudioCtx.state === 'suspended') {
        await this.inputAudioCtx.resume();
      }

      const source = this.inputAudioCtx.createMediaStreamSource(this.mediaStream);
      this.scriptProcessor = this.inputAudioCtx.createScriptProcessor(4096, 1, 1);

      this.scriptProcessor.onaudioprocess = (e) => {
        if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        const inputChannel = e.inputBuffer.getChannelData(0);
        
        // Measure audio volume for visualizer
        let sum = 0;
        for (let i = 0; i < inputChannel.length; i++) {
          sum += inputChannel[i] * inputChannel[i];
        }
        const rms = Math.sqrt(sum / inputChannel.length);
        this.callbacks.onVolumeChange?.(Math.min(1, rms * 5));

        // Downsample to 16000Hz if needed
        const resampled = this.downsampleTo16k(inputChannel, this.inputAudioCtx!.sampleRate);
        const pcmBase64 = this.float32To16BitPCM(resampled);

        this.ws.send(JSON.stringify({ audio: pcmBase64 }));
      };

      source.connect(this.scriptProcessor);
      this.scriptProcessor.connect(this.inputAudioCtx.destination);

    } catch (err: any) {
      console.error("[LiveAudio] Start failed:", err);
      this.callbacks.onError?.(err?.message || "Failed to initialize microphone or live call");
      this.stop();
    }
  }

  // Play incoming 24kHz PCM chunk with gapless scheduling
  private playAudioChunk(base64Data: string) {
    if (!this.outputAudioCtx) return;

    try {
      const binary = atob(base64Data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const int16 = new Int16Array(bytes.buffer);
      const audioBuffer = this.outputAudioCtx.createBuffer(1, int16.length, 24000);
      const channel = audioBuffer.getChannelData(0);

      for (let i = 0; i < int16.length; i++) {
        channel[i] = int16[i] / 32768.0;
      }

      const source = this.outputAudioCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.outputAudioCtx.destination);

      const currentTime = this.outputAudioCtx.currentTime;
      if (this.nextStartTime < currentTime) {
        this.nextStartTime = currentTime + 0.04; // small buffer to avoid clicks
      }

      source.start(this.nextStartTime);
      this.nextStartTime += audioBuffer.duration;
      this.activeSources.push(source);

      source.onended = () => {
        const idx = this.activeSources.indexOf(source);
        if (idx !== -1) {
          this.activeSources.splice(idx, 1);
        }
      };
    } catch (err) {
      console.error("[LiveAudio] Playback error:", err);
    }
  }

  // Cancel output playback immediately on user interruption
  private stopPlayback() {
    this.activeSources.forEach((s) => {
      try {
        s.stop();
      } catch (e) {
        // ignore
      }
    });
    this.activeSources = [];
    if (this.outputAudioCtx) {
      this.nextStartTime = this.outputAudioCtx.currentTime;
    }
  }

  stop() {
    this.isConnecting = false;
    this.isConnected = false;

    this.stopPlayback();

    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    if (this.inputAudioCtx) {
      try {
        this.inputAudioCtx.close();
      } catch (e) {}
      this.inputAudioCtx = null;
    }

    if (this.outputAudioCtx) {
      try {
        this.outputAudioCtx.close();
      } catch (e) {}
      this.outputAudioCtx = null;
    }

    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }

    this.callbacks.onClose?.();
  }

  // Downsample to 16000Hz
  private downsampleTo16k(input: Float32Array, sampleRate: number): Float32Array {
    if (sampleRate === 16000) return input;
    const ratio = sampleRate / 16000;
    const newLen = Math.round(input.length / ratio);
    const output = new Float32Array(newLen);
    for (let i = 0; i < newLen; i++) {
      const idx = Math.min(Math.round(i * ratio), input.length - 1);
      output[i] = input[idx];
    }
    return output;
  }

  // Float32 to 16-bit PCM little-endian Base64
  private float32To16BitPCM(input: Float32Array): string {
    const buffer = new ArrayBuffer(input.length * 2);
    const view = new DataView(buffer);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  get running(): boolean {
    return this.isConnected;
  }
}
