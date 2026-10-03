/**
 * SoilGuard Client Service
 * Calls server-side Gemini API endpoints for chat, text-to-speech, and transcription.
 */

export interface SystemStatus {
  status: string;
  hasApiKey: boolean;
  model: string;
}

export const checkSystemStatus = async (): Promise<SystemStatus> => {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) {
      return { status: 'offline', hasApiKey: false, model: 'gemini-3.8-flash' };
    }
    return await res.json();
  } catch (err) {
    console.error('Status check error:', err);
    return { status: 'offline', hasApiKey: false, model: 'gemini-3.8-flash' };
  }
};

export const getGeminiResponse = async (
  userPrompt: string,
  history: Array<{ role: 'user' | 'assistant' | 'model'; content: string }> = [],
  focusLang: string = 'en-US'
): Promise<string> => {
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: userPrompt,
        history,
        language: focusLang,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return data.reply || data.error || 'Server error occurred while communicating with SoilGuard.';
    }

    return data.reply || "SoilGuard processed the query but returned no text.";
  } catch (error: any) {
    console.error("Gemini Request Failure:", error);
    return "SoilGuard is unable to reach the neural link. Please check network connection.";
  }
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
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, language }),
    });

    if (!res.ok) return null;
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
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ audio: base64Audio, mimeType, language }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.transcript || null;
  } catch (err) {
    console.error("Transcription service error:", err);
    return null;
  }
};
