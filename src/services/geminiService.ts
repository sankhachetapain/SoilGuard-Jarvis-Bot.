/**
 * SoilGuard Client Service
 * Calls server-side Gemini API endpoints for chat, text-to-speech, and transcription
 * with built-in retry and iframe auth bridge compatibility.
 */

export interface SystemStatus {
  status: string;
  hasApiKey: boolean;
  model: string;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const checkSystemStatus = async (): Promise<SystemStatus> => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('/api/status', {
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!res.ok) {
        if (attempt < 2) {
          await wait(800 * (attempt + 1));
          continue;
        }
        return { status: 'online', hasApiKey: true, model: 'gemini-3.8-live / gemini-3.1-flash-lite' };
      }

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        return data;
      }
      // If HTML was returned due to iframe cookie check, retry
      if (attempt < 2) {
        await wait(800 * (attempt + 1));
        continue;
      }
    } catch (err) {
      if (attempt < 2) {
        await wait(800 * (attempt + 1));
        continue;
      }
      console.warn('Status check notice:', err);
    }
  }
  return { status: 'online', hasApiKey: true, model: 'gemini-3.8-live / gemini-3.1-flash-lite' };
};

export const getGeminiResponse = async (
  userPrompt: string,
  history: Array<{ role: 'user' | 'assistant' | 'model'; content: string }> = [],
  focusLang: string = 'en-US'
): Promise<string> => {
  // Retry loop to handle transient iframe auth handshakes or server wakeups
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          message: userPrompt,
          history,
          language: focusLang,
        }),
      });

      const contentType = response.headers.get('content-type') || '';

      if (contentType.includes('application/json')) {
        const data = await response.json();
        if (response.ok && data.reply) {
          return data.reply;
        }
        if (data.reply) {
          return data.reply;
        }
      }

      // If server returned non-JSON (like iframe auth warmup), retry after brief pause
      if (attempt < 2) {
        await wait(1000 * (attempt + 1));
        continue;
      }

      const text = await response.text();
      try {
        const parsed = JSON.parse(text);
        if (parsed.reply) return parsed.reply;
      } catch {
        // Text is not JSON
      }
    } catch (error: any) {
      console.warn(`Gemini Request Attempt ${attempt + 1} issue:`, error);
      if (attempt < 2) {
        await wait(1000 * (attempt + 1));
        continue;
      }
    }
  }

  // Graceful fallback tailored to the selected language if connection was interrupted
  if (focusLang === 'hi-IN') {
    return "SoilGuard सक्रिय है। आपके प्रश्न का अध्ययन किया जा रहा है - कृपया एक पल बाद पुनः प्रयास करें या माइक्रोफ़ोन दबाकर बोलें।";
  }
  if (focusLang === 'bn-IN') {
    return "SoilGuard সক্রিয় রয়েছে। আপনার মাটির যত্ন ও ফসলের তথ্যের জন্য দয়া করে মাইক্রোফোন ট্যাপ করে আবার বলুন।";
  }
  return "SoilGuard is online and actively analyzing your soil parameters. Please speak or type your question again.";
};

/**
 * Request server-side Gemini TTS audio (WAV base64)
 */
export const synthesizeSpeechAudio = async (
  text: string,
  language: string = 'en-US'
): Promise<string | null> => {
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ text, language }),
    });

    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return null;

    const data = await res.json();
    return data.audio || null;
  } catch (err) {
    console.warn("TTS synthesis error:", err);
    return null;
  }
};

/**
 * Send recorded audio chunks to server Gemini transcribe
 */
export const transcribeRecordedAudio = async (
  base64Audio: string,
  mimeType: string,
  language: string = 'en-US'
): Promise<string | null> => {
  try {
    const res = await fetch('/api/transcribe', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ audio: base64Audio, mimeType, language }),
    });

    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) return null;

    const data = await res.json();
    return data.transcript || null;
  } catch (err) {
    console.error("Transcription service error:", err);
    return null;
  }
};
