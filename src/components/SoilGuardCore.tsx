import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Mic, 
  Send, 
  Loader2, 
  Zap, 
  Activity, 
  ShieldCheck, 
  Terminal as TerminalIcon, 
  Cpu, 
  Volume2, 
  VolumeX, 
  RotateCcw,
  Sparkles,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  PhoneCall,
  PhoneOff,
  Radio
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';
import { Message } from '../types';
import { 
  getGeminiResponse, 
  synthesizeSpeechAudio, 
  transcribeRecordedAudio, 
  checkSystemStatus, 
  SystemStatus 
} from '../services/geminiService';
import { LiveAudioSession } from '../services/liveAudioService';
import { cn } from '../lib/utils';

type SupportedLanguage = 'en-US' | 'hi-IN' | 'bn-IN';

interface LangInfo {
  code: SupportedLanguage;
  label: string;
  flag: string;
  greeting: string;
  subtext: string;
  prompts: string[];
}

const LANG_CONFIG: Record<SupportedLanguage, LangInfo> = {
  'en-US': {
    code: 'en-US',
    label: 'English',
    flag: '🇬🇧',
    greeting: "SYSTEM ONLINE. SoilGuard AI Protocol initialized in English. Standing by for soil, crop, and agricultural intelligence queries.",
    subtext: "Soil Health & Regeneration Protocol Active",
    prompts: [
      "What is the ideal NPK ratio for wheat?",
      "How to fix acidic soil with pH below 5.5 organically?",
      "Best organic cover crops to restore soil nitrogen"
    ]
  },
  'hi-IN': {
    code: 'hi-IN',
    label: 'हिंदी (Hindi)',
    flag: '🇮🇳',
    greeting: "सॉइल गार्ड सक्रिय है। भाषा हिंदी में सेट हो गई है। आप मिट्टी की जांच, NPK संतुलन और फसल सुधार से संबंधित कोई भी सवाल पूछ सकते हैं।",
    subtext: "मृदा स्वास्थ्य एवं जैविक कृषि प्रणाली सक्रिय",
    prompts: [
      "गेहूं की फसल के लिए सही NPK अनुपात क्या है?",
      "अम्लीय मिट्टी (कम pH) को जैविक रूप से कैसे सुधारें?",
      "मिट्टी में नाइट्रोजन बढ़ाने के लिए सबसे अच्छी हरी खाद कौन सी है?"
    ]
  },
  'bn-IN': {
    code: 'bn-IN',
    label: 'বাংলা (Bengali)',
    flag: '🇧🇩',
    greeting: "সয়েলগার্ড সক্রিয়। ভাষা বাংলায় রূপান্তরিত হয়েছে। আপনি মাটির পরীক্ষা, NPK পুষ্টি উপাদান এবং ফসলের যত্ন নিয়ে প্রশ্ন করতে পারেন।",
    subtext: "মৃত্তিকা স্বাস্থ্য ও টেকসই কৃষি প্রটোকল সক্রিয়",
    prompts: [
      "ধান চাষের জন্য মাটির আদর্শ NPK অনুপাত কত?",
      "মাটির অতিরিক্ত অম্লতা (কম pH) কমানোর প্রাকৃতিক উপায় কী?",
      "মাটিতে নাইট্রোজেনের ঘাটতি দূর করতে কোন জৈব সার সেরা?"
    ]
  }
};

export const SoilGuardCore: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: LANG_CONFIG['en-US'].greeting,
      timestamp: Date.now(),
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [systemStatus, setSystemStatus] = useState<SystemStatus>({ status: 'checking', hasApiKey: true, model: 'gemini-3.8-live' });
  const [statusNotification, setStatusNotification] = useState<string | null>(null);
  const [activeLang, setActiveLang] = useState<SupportedLanguage>('en-US');

  // Real-time Live API State (gemini-3.8-live)
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [isLiveConnecting, setIsLiveConnecting] = useState(false);
  const [liveVolume, setLiveVolume] = useState(0);
  const [liveModelSpeaking, setLiveModelSpeaking] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const liveSessionRef = useRef<LiveAudioSession | null>(null);

  // Check system secret configuration on mount
  useEffect(() => {
    checkSystemStatus().then((status) => {
      setSystemStatus(status);
    });
  }, []);

  // Show temporary status badge in the HUD
  const triggerNotification = useCallback((text: string) => {
    setStatusNotification(text);
    const timer = setTimeout(() => {
      setStatusNotification(null);
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  // Stop currently playing voice audio
  const stopAudio = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
      currentAudioRef.current = null;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, []);

  // High-fidelity speech playback: Gemini 3.8 TTS with Web Speech API fallback
  const speakText = useCallback(async (text: string, language: SupportedLanguage = activeLang) => {
    if (!voiceEnabled || isLiveMode) return;
    stopAudio();

    const cleanText = text
      .replace(/[#*`_~]/g, '')
      .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
      .replace(/(\r\n|\n|\r)/gm, ' ')
      .trim();

    if (!cleanText) return;

    setIsSpeaking(true);

    try {
      // 1. Try Gemini 3.8 Flash Lite TTS from backend
      const audioBase64 = await synthesizeSpeechAudio(cleanText, language);

      if (audioBase64) {
        const audioUrl = `data:audio/wav;base64,${audioBase64}`;
        const audio = new Audio(audioUrl);
        currentAudioRef.current = audio;

        audio.onended = () => {
          setIsSpeaking(false);
          currentAudioRef.current = null;
        };

        audio.onerror = () => {
          console.warn("Gemini audio playback failed, falling back to speech synthesis");
          fallbackSpeechSynthesis(cleanText, language);
        };

        await audio.play();
        return;
      }
    } catch (err) {
      console.warn("Gemini TTS playback failed, falling back to client synthesis:", err);
    }

    // 2. Client Web Speech API fallback
    fallbackSpeechSynthesis(cleanText, language);
  }, [activeLang, voiceEnabled, isLiveMode, stopAudio]);

  const fallbackSpeechSynthesis = (text: string, language: SupportedLanguage) => {
    if (!('speechSynthesis' in window)) {
      setIsSpeaking(false);
      return;
    }

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.volume = 1;
    utterance.rate = 1.0;
    utterance.pitch = 0.95;

    const voices = window.speechSynthesis.getVoices();
    let selectedVoice;

    if (language === 'hi-IN') {
      utterance.lang = 'hi-IN';
      selectedVoice = voices.find(v => v.lang.startsWith('hi') || v.name.includes('Hindi'));
    } else if (language === 'bn-IN') {
      utterance.lang = 'bn-IN';
      selectedVoice = voices.find(v => v.lang.startsWith('bn') || v.name.includes('Bengali') || v.name.includes('Bangla'));
    } else {
      utterance.lang = 'en-US';
      selectedVoice = voices.find(v => (v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural')))) || voices.find(v => v.lang.startsWith('en'));
    }

    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  };

  // ==========================================
  // REAL-TIME LIVE VOICE CALL (gemini-3.8-live)
  // ==========================================
  const startLiveCall = async () => {
    stopAudio();
    if (isRecording) stopRecordingSession();

    setIsLiveConnecting(true);
    triggerNotification("INITIATING_LIVE_VOICE_UPLINK...");

    const session = new LiveAudioSession({
      onReady: () => {
        setIsLiveConnecting(false);
        setIsLiveMode(true);
        triggerNotification(`LIVE_CALL_ACTIVE // ${LANG_CONFIG[activeLang].label}`);
        setMessages(prev => [
          ...prev,
          {
            id: Date.now().toString(),
            role: 'assistant',
            content: activeLang === 'hi-IN'
              ? "🔴 **लाइव वॉइस कॉल सक्रिय है (Gemini 3.8 Live)**। आप सीधे बोलकर बात कर सकते हैं, मैं सुनकर तुरंत जवाब दूंगा।"
              : activeLang === 'bn-IN'
              ? "🔴 **লাইভ ভয়েস কল সক্রিয় (Gemini 3.8 Live)**। আপনি সরাসরি কথা বলুন, আমি রিয়েল-টাইমে শুনে উত্তর দিচ্ছি।"
              : "🔴 **Live Voice Call Active (gemini-3.8-live)**. Speak naturally; I am listening and responding in real-time.",
            timestamp: Date.now(),
          }
        ]);
      },
      onAudioChunk: () => {
        setLiveModelSpeaking(true);
      },
      onText: (text: string, role: 'user' | 'model') => {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          // If previous message was from the same role within last 4s, append
          if (last && last.role === (role === 'model' ? 'assistant' : 'user') && Date.now() - last.timestamp < 4000) {
            return [
              ...prev.slice(0, -1),
              { ...last, content: last.content + ' ' + text }
            ];
          }
          return [
            ...prev,
            {
              id: Date.now().toString(),
              role: role === 'model' ? 'assistant' : 'user',
              content: text,
              timestamp: Date.now(),
            }
          ];
        });
      },
      onVolumeChange: (vol: number) => {
        setLiveVolume(vol);
        if (vol > 0.05) {
          setLiveModelSpeaking(false);
        }
      },
      onInterrupted: () => {
        setLiveModelSpeaking(false);
        triggerNotification("USER_INTERRUPTION_DETECTED");
      },
      onError: (errMsg: string) => {
        console.error("Live call error:", errMsg);
        triggerNotification(`LIVE_ERROR: ${errMsg}`);
        stopLiveCall();
      },
      onClose: () => {
        setIsLiveMode(false);
        setIsLiveConnecting(false);
        setLiveModelSpeaking(false);
        triggerNotification("LIVE_CALL_ENDED");
      }
    });

    liveSessionRef.current = session;
    await session.start(activeLang);
  };

  const stopLiveCall = () => {
    if (liveSessionRef.current) {
      liveSessionRef.current.stop();
      liveSessionRef.current = null;
    }
    setIsLiveMode(false);
    setIsLiveConnecting(false);
    setLiveModelSpeaking(false);
    setLiveVolume(0);
  };

  // Change language with greeting and clear visual/audio confirmation
  const changeLanguage = (code: SupportedLanguage) => {
    setActiveLang(code);
    stopAudio();

    if (isLiveMode) {
      stopLiveCall();
      triggerNotification(`SWITCHING_LIVE_LANGUAGE: ${LANG_CONFIG[code].label}`);
      setTimeout(() => {
        startLiveCall();
      }, 500);
      return;
    }

    if (isRecording) {
      stopRecordingSession();
    }

    const config = LANG_CONFIG[code];
    triggerNotification(`SYNC_LANGUAGE: ${config.label}`);

    const acknowledgmentMsg: Message = {
      id: Date.now().toString(),
      role: 'assistant',
      content: config.greeting,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, acknowledgmentMsg]);
    speakText(config.greeting, code);
  };

  // Process standard query and request Gemini response
  const processQuery = async (queryText: string) => {
    if (!queryText.trim() || isLoading) return;

    stopAudio();

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: queryText,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    const historyPayload = messages.slice(-8).map(m => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const response = await getGeminiResponse(queryText, historyPayload, activeLang);

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response,
        timestamp: Date.now(),
      };

      setMessages(prev => [...prev, assistantMessage]);
      setIsLoading(false);

      // Play voice answer aloud
      speakText(response, activeLang);
    } catch (err: any) {
      console.error("Query Error:", err);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: "SoilGuard connection encountered an anomaly. Please try again.",
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, errorMessage]);
      setIsLoading(false);
    }
  };

  const handleSend = () => {
    processQuery(input);
  };

  // Stop recording session and clean up
  const stopRecordingSession = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {}
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      try {
        mediaRecorderRef.current.stop();
      } catch (e) {}
    }

    setIsRecording(false);
  };

  const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = (reader.result as string).split(',')[1];
        resolve(base64String);
      };
      reader.onerror = reject;
    });
  };

  // Dual-mode Voice Input: Web Speech API with automatic Gemini Transcribe fallback
  const startRecordingSession = async () => {
    stopAudio();
    audioChunksRef.current = [];

    // 1. Start MediaRecorder as guaranteed backup for server transcription
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream?.getTracks().forEach(track => track.stop());

        if (audioChunksRef.current.length > 0 && !input.trim()) {
          setIsTranscribing(true);
          triggerNotification("TRANSCRIBING_NEURAL_AUDIO...");

          try {
            const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || 'audio/webm' });
            const base64Audio = await blobToBase64(audioBlob);
            const transcript = await transcribeRecordedAudio(
              base64Audio, 
              mediaRecorder.mimeType || 'audio/webm', 
              activeLang
            );

            if (transcript && transcript.trim()) {
              setInput(transcript);
              processQuery(transcript);
            } else {
              triggerNotification("VOICE_INPUT_EMPTY: Speak clearly");
            }
          } catch (transcribeError) {
            console.error("Transcribe fallback failed:", transcribeError);
          } finally {
            setIsTranscribing(false);
          }
        }
      };

      mediaRecorder.start();
    } catch (mediaError: any) {
      console.warn("MediaRecorder permission not granted or unavailable:", mediaError);
    }

    // 2. Try browser Web Speech API for low-latency live speech
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    let webSpeechHandled = false;

    if (SpeechRecognition) {
      try {
        if (recognitionRef.current) {
          recognitionRef.current.abort();
        }

        const recognition = new SpeechRecognition();
        recognitionRef.current = recognition;
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = activeLang;

        recognition.onstart = () => {
          setIsRecording(true);
          triggerNotification("LISTENING: Speak now...");
        };

        recognition.onresult = (event: any) => {
          webSpeechHandled = true;
          const transcript = event.results[0][0].transcript;
          if (transcript) {
            setInput(transcript);
            stopRecordingSession();
            processQuery(transcript);
          }
        };

        recognition.onerror = (event: any) => {
          console.warn("Web Speech API encountered:", event.error);
          if (event.error === 'network') {
            triggerNotification("SWITCHING_TO_NEURAL_STT");
          } else if (event.error === 'no-speech') {
            triggerNotification("NO_SPEECH_DETECTED");
          }
        };

        recognition.onend = () => {
          if (!webSpeechHandled) {
            setIsRecording(false);
          }
        };

        recognition.start();
        setIsRecording(true);
        return;
      } catch (e) {
        console.warn("WebSpeech init exception:", e);
      }
    }

    if (mediaRecorderRef.current) {
      setIsRecording(true);
      triggerNotification("RECORDING_VOICE: Press mic again to submit");
    } else {
      triggerNotification("MICROPHONE_PERMISSION_REQUIRED");
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecordingSession();
    } else {
      startRecordingSession();
    }
  };

  // Auto-scroll chat stream
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading, isTranscribing, isLiveMode]);

  return (
    <div className="relative w-full max-w-5xl mx-auto flex flex-col items-center justify-between min-h-[92vh] py-4 px-4">
      <div className="scanline" />

      {/* TOP HUD BAR */}
      <header className="w-full flex flex-col md:flex-row justify-between items-center gap-3 bg-core-surface/80 border border-core-border rounded-2xl p-3.5 backdrop-blur-xl z-20 shadow-lg">
        
        {/* Process status & Secret Panel status */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Cpu className={cn("w-5 h-5 animate-pulse", isLiveMode ? "text-emerald-400" : "text-core-primary")} />
              <div className={cn("absolute -inset-1 blur-sm rounded-full", isLiveMode ? "bg-emerald-400/20" : "bg-core-primary/20")} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-core-primary font-bold tracking-widest uppercase">
                  SOILGUARD // VOICE-AI
                </span>
                <span className={cn(
                  "text-[9px] font-mono px-1.5 py-0.5 rounded border uppercase",
                  isLiveMode 
                    ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-300 animate-pulse font-bold" 
                    : "bg-core-primary/10 border-core-primary/30 text-core-primary"
                )}>
                  {isLiveMode ? "GEMINI-3.8-LIVE (ACTIVE)" : "GEMINI-3.8 READY"}
                </span>
              </div>
              <p className="text-[10px] font-mono text-blue-300/70">
                {isLiveMode ? "Continuous Bi-Directional Speech Uplink" : LANG_CONFIG[activeLang].subtext}
              </p>
            </div>
          </div>

          {/* Secret status pill */}
          <div 
            title={systemStatus.hasApiKey ? "Gemini API Key configured in Secrets panel" : "Configure GEMINI_API_KEY in Settings > Secrets"}
            className={cn(
              "hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono border backdrop-blur-md transition-all",
              systemStatus.hasApiKey 
                ? "bg-emerald-950/40 border-emerald-500/30 text-emerald-400" 
                : "bg-amber-950/40 border-amber-500/30 text-amber-300"
            )}
          >
            <KeyRound className="w-3 h-3" />
            <span>{systemStatus.hasApiKey ? "API KEY: SECURE" : "API KEY: PENDING"}</span>
            {systemStatus.hasApiKey ? (
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            ) : (
              <AlertCircle className="w-3 h-3 text-amber-400 animate-pulse" />
            )}
          </div>
        </div>

        {/* CONTROLS & TRILINGUAL LANGUAGE SELECTOR HUD */}
        <div className="flex items-center gap-2">
          {/* Trilingual Selector */}
          <div className="flex items-center bg-core-bg/80 border border-core-border rounded-xl p-1 gap-1">
            {(Object.keys(LANG_CONFIG) as SupportedLanguage[]).map((code) => {
              const lang = LANG_CONFIG[code];
              const isSelected = activeLang === code;
              return (
                <button
                  key={code}
                  onClick={() => changeLanguage(code)}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition-all duration-200 cursor-pointer select-none",
                    isSelected
                      ? "bg-core-primary text-core-bg font-bold shadow-[0_0_15px_rgba(0,255,204,0.6)] scale-105"
                      : "text-blue-300/80 hover:text-white hover:bg-white/5"
                  )}
                >
                  <span className="text-sm">{lang.flag}</span>
                  <span>{lang.label}</span>
                </button>
              );
            })}
          </div>

          {/* Voice Mute / Unmute Toggle */}
          <button
            onClick={() => {
              if (voiceEnabled) stopAudio();
              setVoiceEnabled(!voiceEnabled);
              triggerNotification(!voiceEnabled ? "VOICE_SYNTHESIS_ENABLED" : "VOICE_MUTED");
            }}
            title={voiceEnabled ? "Voice Output Active (Click to mute)" : "Voice Muted (Click to enable)"}
            className={cn(
              "p-2 rounded-xl border transition-all cursor-pointer",
              voiceEnabled 
                ? "bg-core-primary/10 border-core-primary/40 text-core-primary hover:bg-core-primary/20 shadow-[0_0_10px_rgba(0,255,204,0.2)]" 
                : "bg-white/5 border-white/10 text-white/40 hover:text-white/80"
            )}
          >
            {voiceEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* CENTRAL VISUALIZER & LIVE AGENT CONTROL */}
      <div className="flex flex-col items-center justify-center my-3 relative">
        {/* Status Notification Overlay */}
        <AnimatePresence>
          {statusNotification && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute -top-7 px-4 py-1 rounded-full bg-core-primary/20 border border-core-primary/60 text-core-primary text-[10px] font-mono tracking-widest uppercase shadow-[0_0_20px_rgba(0,255,204,0.4)] z-30"
            >
              {statusNotification}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Pulsing Circular Jarvis Core */}
        <div className="relative flex items-center justify-center w-40 h-40 lg:w-48 lg:h-48">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 16, repeat: Infinity, ease: "linear" }}
            className={cn(
              "absolute inset-0 border border-dashed rounded-full scale-125 transition-colors",
              isLiveMode ? "border-emerald-400/40" : "border-core-primary/25"
            )}
          />
          <motion.div
            animate={{ rotate: -360 }}
            transition={{ duration: 24, repeat: Infinity, ease: "linear" }}
            className={cn(
              "absolute inset-2 border rounded-full transition-colors",
              isLiveMode ? "border-emerald-500/40" : "border-core-secondary/40"
            )}
          />
          <motion.div
            animate={{ 
              scale: isLiveMode
                ? [1, 1 + liveVolume * 0.4, 1]
                : isSpeaking 
                ? [1, 1.15, 1] 
                : isRecording 
                ? [1, 1.2, 1] 
                : [1, 1.04, 1] 
            }}
            transition={{ duration: isLiveMode ? 0.2 : isSpeaking ? 0.6 : isRecording ? 1 : 2.5, repeat: Infinity, ease: "easeInOut" }}
            className={cn(
              "absolute inset-0 border rounded-full scale-150 transition-colors",
              isLiveMode ? "border-emerald-400/30" : "border-core-primary/20"
            )}
          />

          <motion.div
            animate={{
              scale: isLiveMode && (liveVolume > 0.05 || liveModelSpeaking)
                ? [1, 1.15, 1]
                : isSpeaking
                ? [1, 1.12, 1]
                : isRecording
                ? [1, 1.18, 1]
                : isLoading || isTranscribing || isLiveConnecting
                ? [1, 1.08, 1]
                : 1,
              boxShadow: isLiveMode
                ? ["0 0 30px #10b981", "0 0 70px #10b981", "0 0 30px #10b981"]
                : isSpeaking
                ? ["0 0 25px #00ffcc", "0 0 60px #00ffcc", "0 0 25px #00ffcc"]
                : isRecording
                ? ["0 0 25px #ef4444", "0 0 60px #ef4444", "0 0 25px #ef4444"]
                : isLoading || isTranscribing
                ? ["0 0 20px #0066ff", "0 0 50px #0066ff", "0 0 20px #0066ff"]
                : ["0 0 20px rgba(0,255,204,0.2)", "0 0 35px rgba(0,255,204,0.4)", "0 0 20px rgba(0,255,204,0.2)"]
            }}
            transition={{ duration: isLiveMode ? 0.3 : 1.5, repeat: Infinity, ease: "easeInOut" }}
            className={cn(
              "relative w-24 h-24 lg:w-28 lg:h-28 bg-core-surface border-2 rounded-full flex flex-col items-center justify-center z-10 transition-colors duration-500",
              isLiveMode
                ? "border-emerald-400 bg-emerald-950/30 text-emerald-400"
                : isSpeaking
                ? "border-core-primary bg-core-primary/10 text-core-primary"
                : isRecording
                ? "border-red-500 bg-red-500/10 text-red-500"
                : isLoading || isTranscribing || isLiveConnecting
                ? "border-blue-500 bg-blue-500/10 text-blue-400"
                : "border-core-primary/60 text-core-primary"
            )}
          >
            {isLiveConnecting ? (
              <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
            ) : isLiveMode ? (
              liveModelSpeaking ? (
                <Volume2 className="w-8 h-8 animate-bounce text-emerald-300" />
              ) : liveVolume > 0.05 ? (
                <Activity className="w-8 h-8 animate-pulse text-emerald-300" />
              ) : (
                <Radio className="w-8 h-8 animate-pulse text-emerald-400" />
              )
            ) : isLoading || isTranscribing ? (
              <Loader2 className="w-8 h-8 animate-spin" />
            ) : isRecording ? (
              <Activity className="w-8 h-8 animate-pulse text-red-500" />
            ) : isSpeaking ? (
              <Activity className="w-8 h-8 animate-bounce text-core-primary" />
            ) : (
              <Zap className="w-8 h-8 animate-pulse" />
            )}

            <span className="text-[8px] font-mono tracking-widest mt-1 uppercase font-bold text-center">
              {isLiveConnecting 
                ? "CONNECTING"
                : isLiveMode
                ? liveModelSpeaking ? "SPEAKING" : liveVolume > 0.05 ? "HEARING YOU" : "LIVE LISTENING"
                : isTranscribing 
                ? "TRANSCRIBING" 
                : isLoading 
                ? "ANALYZING" 
                : isRecording 
                ? "RECORDING" 
                : isSpeaking 
                ? "SPEAKING" 
                : "STANDBY"}
            </span>

            <div className="absolute inset-2 bg-core-primary/5 rounded-full blur-md" />
          </motion.div>
        </div>

        {/* LIVE REAL-TIME CONVERSATION CALL TOGGLE BUTTON */}
        <div className="mt-3 flex items-center gap-2">
          {!isLiveMode ? (
            <button
              onClick={startLiveCall}
              disabled={isLiveConnecting}
              className="flex items-center gap-2 px-5 py-2 rounded-full bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/50 text-emerald-300 text-xs font-mono font-bold tracking-wider hover:shadow-[0_0_20px_rgba(16,185,129,0.5)] transition-all cursor-pointer group"
            >
              <PhoneCall className="w-4 h-4 text-emerald-400 group-hover:scale-110 transition-transform" />
              <span>START LIVE VOICE CALL (GEMINI 3.8 LIVE)</span>
            </button>
          ) : (
            <button
              onClick={stopLiveCall}
              className="flex items-center gap-2 px-5 py-2 rounded-full bg-red-500/20 hover:bg-red-500/30 border border-red-500/60 text-red-400 text-xs font-mono font-bold tracking-wider hover:shadow-[0_0_20px_rgba(239,68,68,0.5)] transition-all cursor-pointer animate-pulse"
            >
              <PhoneOff className="w-4 h-4 text-red-400" />
              <span>END LIVE CALL (DISCONNECT)</span>
            </button>
          )}
        </div>
      </div>

      {/* CONVERSATION HUD / TERMINAL */}
      <div className="w-full max-w-3xl flex-1 flex flex-col bg-core-surface/60 border border-core-border rounded-2xl backdrop-blur-xl overflow-hidden shadow-2xl my-2">
        {/* Terminal Header */}
        <div className="flex items-center justify-between px-4 py-2 bg-core-bg/60 border-b border-core-border text-xs font-mono">
          <div className="flex items-center gap-2 text-core-primary">
            <TerminalIcon className="w-4 h-4" />
            <span className="tracking-widest uppercase font-bold">
              {isLiveMode ? "🔴 LIVE VOICE STREAM" : `NEURAL_STREAM // ${LANG_CONFIG[activeLang].label}`}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {isSpeaking && !isLiveMode && (
              <button
                onClick={stopAudio}
                className="flex items-center gap-1 text-[10px] text-red-400 hover:text-red-300 font-mono transition-colors cursor-pointer"
              >
                <VolumeX className="w-3 h-3" />
                <span>STOP VOICE</span>
              </button>
            )}
            <div className="flex items-center gap-1.5 text-blue-300/60 text-[10px]">
              <ShieldCheck className="w-3.5 h-3.5 text-core-primary" />
              <span>{isLiveMode ? "LIVE BI-DIRECTIONAL AUDIO" : "AUDIO READY"}</span>
            </div>
          </div>
        </div>

        {/* Message Log */}
        <div 
          ref={scrollRef} 
          className="flex-1 overflow-y-auto p-4 space-y-3.5 max-h-[36vh] min-h-[25vh] scroll-smooth"
        >
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={cn(
                "flex flex-col rounded-xl p-3.5 max-w-[90%] transition-all",
                msg.role === 'user'
                  ? "ml-auto bg-core-primary/10 border border-core-primary/30 text-white"
                  : "mr-auto bg-core-bg/70 border border-core-border text-blue-100"
              )}
            >
              <div className="flex items-center justify-between gap-3 mb-1.5">
                <span className={cn(
                  "text-[10px] font-mono uppercase tracking-wider font-semibold",
                  msg.role === 'user' ? "text-core-primary" : "text-blue-400"
                )}>
                  {msg.role === 'user' ? "▶ YOU" : "◆ SOILGUARD"}
                </span>

                {msg.role === 'assistant' && !isLiveMode && (
                  <button
                    onClick={() => speakText(msg.content, activeLang)}
                    title="Replay Voice Audio"
                    className="flex items-center gap-1 text-[10px] font-mono text-core-primary hover:text-white px-2 py-0.5 rounded bg-core-primary/10 hover:bg-core-primary/20 border border-core-primary/30 transition-all cursor-pointer"
                  >
                    <Volume2 className="w-3 h-3" />
                    <span>Replay Voice</span>
                  </button>
                )}
              </div>

              <div className="markdown-body font-mono text-sm leading-relaxed">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
            </motion.div>
          ))}

          {isLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mr-auto bg-core-bg/70 border border-core-border rounded-xl p-3 flex items-center gap-3 text-xs font-mono text-blue-300"
            >
              <Loader2 className="w-4 h-4 text-core-primary animate-spin" />
              <span>Analyzing soil nutrients and synthesizing voice response...</span>
            </motion.div>
          )}

          {isTranscribing && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="ml-auto bg-core-primary/10 border border-core-primary/30 rounded-xl p-3 flex items-center gap-3 text-xs font-mono text-core-primary"
            >
              <Activity className="w-4 h-4 animate-pulse" />
              <span>Transcribing voice recording through Gemini...</span>
            </motion.div>
          )}
        </div>

        {/* QUICK QUERY RECOMMENDATION PILLS */}
        <div className="px-4 py-2 bg-core-bg/40 border-t border-core-border flex items-center gap-2 overflow-x-auto scrollbar-hide">
          <span className="text-[10px] font-mono text-blue-300/50 uppercase tracking-widest whitespace-nowrap flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-core-primary" />
            QUICK:
          </span>
          {LANG_CONFIG[activeLang].prompts.map((promptText, idx) => (
            <button
              key={idx}
              onClick={() => {
                if (isLiveMode && liveSessionRef.current) {
                  processQuery(promptText);
                } else {
                  processQuery(promptText);
                }
              }}
              disabled={isLoading || isLiveConnecting}
              className="text-[11px] font-mono whitespace-nowrap px-2.5 py-1 rounded-full bg-core-surface hover:bg-core-primary/20 border border-core-border hover:border-core-primary/50 text-blue-200 hover:text-white transition-all cursor-pointer disabled:opacity-50"
            >
              {promptText}
            </button>
          ))}
        </div>
      </div>

      {/* INPUT COMMAND CONSOLE */}
      <footer className="w-full max-w-3xl z-20">
        <div className="relative flex items-center gap-3 bg-core-surface/90 border border-core-border p-2.5 rounded-2xl glow-primary focus-within:border-core-primary focus-within:shadow-[0_0_30px_rgba(0,255,204,0.3)] transition-all">
          
          {/* Mic Button */}
          <button
            onClick={toggleRecording}
            disabled={isLoading || isTranscribing || isLiveMode}
            title={
              isLiveMode 
                ? "Live voice conversation is active" 
                : isRecording 
                ? "Stop recording voice" 
                : "Speak to SoilGuard"
            }
            className={cn(
              "p-3.5 rounded-xl transition-all duration-300 cursor-pointer flex items-center justify-center relative",
              isRecording
                ? "bg-red-500 text-white shadow-[0_0_25px_rgba(239,68,68,0.7)] scale-110 animate-pulse"
                : isLiveMode
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 cursor-not-allowed"
                : "bg-core-primary/10 text-core-primary hover:bg-core-primary/20 hover:scale-105 border border-core-primary/30"
            )}
          >
            <Mic className="w-5 h-5" />
            {isRecording && (
              <span className="absolute -top-1 -right-1 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
              </span>
            )}
          </button>

          {/* Text Input */}
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            disabled={isLoading || isTranscribing}
            placeholder={
              isLiveMode
                ? "Live call active: Speak into your microphone..."
                : isRecording 
                ? "Recording voice... Click mic when finished" 
                : activeLang === 'hi-IN'
                ? "बोलें या लिखें: मिट्टी, NPK, खाद या फसल के बारे में..."
                : activeLang === 'bn-IN'
                ? "বলুন বা লিখুন: মাটি, সার, NPK বা ফসল নিয়ে..."
                : "Type or speak: Ask SoilGuard about soil health, NPK, crops..."
            }
            className="flex-1 bg-transparent border-none outline-none text-white font-mono placeholder:text-blue-300/40 text-sm tracking-normal px-2"
          />

          {/* Reset / Clear Chat button */}
          {messages.length > 2 && (
            <button
              onClick={() => {
                stopAudio();
                setMessages([{
                  id: Date.now().toString(),
                  role: 'assistant',
                  content: LANG_CONFIG[activeLang].greeting,
                  timestamp: Date.now(),
                }]);
                triggerNotification("STREAM_RESET");
              }}
              title="Reset Conversation Stream"
              className="p-3 text-blue-400 hover:text-white hover:bg-white/5 rounded-xl transition-colors cursor-pointer"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}

          {/* Send Button */}
          <button
            onClick={handleSend}
            disabled={!input.trim() || isLoading || isTranscribing}
            title="Send query"
            className="p-3.5 bg-core-primary text-core-bg rounded-xl font-bold hover:bg-white hover:shadow-[0_0_20px_#00ffcc] transition-all disabled:opacity-20 disabled:grayscale cursor-pointer"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </footer>
    </div>
  );
};
