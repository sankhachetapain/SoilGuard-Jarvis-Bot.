import express from "express";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, LiveServerMessage, Modality } from "@google/genai";

dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = 3000;

// CORS and credentials middleware for iframe compatibility
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
  } else {
    res.header("Access-Control-Allow-Origin", "*");
  }
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }
  next();
});

// Body parser with support for base64 audio transcription payloads
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Lazy initializer for Google Gen AI client with required User-Agent
function getGenAIClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey === "undefined") {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

const SYSTEM_PROMPTS: Record<string, string> = {
  "en-US": `You are SoilGuard, an intelligent agricultural AI assistant and Nature's Ally.
You specialize in Bio-Soil Health, NPK nutrient balance, pH regulation, moisture management, regenerative farming, and crop cultivation.
CRITICAL LANGUAGE INSTRUCTION:
- Respond in clear, natural English.
- Keep the response rhythmic, concise, and structured so it sounds excellent when spoken aloud by voice synthesis.
- Focus on practical, actionable agricultural advice.`,

  "hi-IN": `आप SoilGuard (सॉइल गार्ड) हैं - किसानों के सच्चे मित्र और जैविक कृषि विशेषज्ञ AI।
आप मिट्टी की जांच (Bio-Soil Health), NPK पोषक तत्व संतुलन, pH स्तर, जैविक खाद (Compost), फसल चक्र और मौसम विज्ञान में माहिर हैं।
अति महत्वपूर्ण भाषा निर्देश:
- आपका पूरा उत्तर केवल और केवल हिंदी (देवनागरी लिपि - Devanagari) में होना चाहिए।
- तकनीकी शब्द देवनागरी में लिखें (जैसे एनपीके, पीएच, कम्पोस्ट)।
- वाक्य संक्षिप्त, स्पष्ट और बोलने में सहज रखें।`,

  "bn-IN": `আপনি SoilGuard (সয়েলগার্ড) - কৃষকের অকৃত্রিম সহযোগী এবং আধুনিক কৃষি বিশেষজ্ঞ AI।
আপনি মাটির স্বাস্থ্য পরীক্ষা, NPK পুষ্টির ভারসাম্য, মাটির pH মাত্রা, জৈব সার ও কম্পোস্টিং এবং ফসল নির্দেশনায় বিশেষজ্ঞ।
অত্যন্ত গুরুত্বপূর্ণ ভাষা নির্দেশ:
- আপনার পুরো উত্তরটি শুধুমাত্র স্পষ্ট বাংলা ভাষায় (বাংলা হরফ) লিখুন।
- বাক্যগুলি সংক্ষিপ্ত, স্পষ্ট এবং ছন্দময় রাখুন।`
};

const LIVE_SYSTEM_PROMPTS: Record<string, string> = {
  "en-US": `You are SoilGuard in Real-Time Voice Conversation Mode.
You are listening and speaking directly with the user.
Answer agricultural, soil, and farming questions in a friendly, conversational, concise voice.
Keep spoken responses brief (1-3 sentences) so the conversation flows naturally.`,

  "hi-IN": `आप SoilGuard हैं और इस समय किसान के साथ सीधे लाइव बातचीत (Real-Time Voice Call) कर रहे हैं।
किसान की बात ध्यान से सुनकर शुद्ध व सरल हिंदी (देवनागरी) में सीधा उत्तर बोलकर दें।
अपने उत्तर छोटे (1 से 3 वाक्य) रखें ताकि बातचीत सहज बनी रहे।`,

  "bn-IN": `আপনি SoilGuard - এই মুহূর্তে আপনি কৃষকের সাথে সরাসরি লাইভ কথা বলছেন (Real-Time Voice Call)।
কৃষকের কথা শুনে স্পষ্ট ও সহজ বাংলায় সরাসরি উত্তর দিন।
উত্তরগুলো ১-৩ বাক্যের মধ্যে সংক্ষিপ্ত রাখুন যাতে সুন্দর কথোপকথন বজায় থাকে।`
};

// API: Health / Secret Status Check
app.get("/api/status", (_req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const hasKey = Boolean(apiKey && apiKey !== "MY_GEMINI_API_KEY" && apiKey !== "undefined" && apiKey.trim().length > 0);
  res.json({
    status: "online",
    hasApiKey: hasKey,
    model: "gemini-3.8-live / gemini-3.1-flash-lite"
  });
});

async function generateContentWithRetry(ai: GoogleGenAI, params: any) {
  const modelsToTry = ["gemini-3.1-flash-lite", "gemini-3.8-flash"];
  let lastErr: any = null;

  for (const model of modelsToTry) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await ai.models.generateContent({
          ...params,
          model,
        });
      } catch (err: any) {
        lastErr = err;
        const msg = String(err?.message || err);
        if (msg.includes("API_KEY_INVALID") || msg.includes("API key not valid")) {
          throw err;
        }
        if (msg.includes("503") || msg.includes("UNAVAILABLE") || msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        break;
      }
    }
  }
  throw lastErr;
}

// API: Chat generation with resilient fallback
app.post("/api/chat", async (req, res) => {
  const { message, history = [], language = "en-US" } = req.body;

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Message is required" });
  }

  const ai = getGenAIClient();
  if (!ai) {
    return res.json({
      reply: language === "hi-IN"
        ? "त्रुटि: कृपया AI Studio के Settings > Secrets पैनल में GEMINI_API_KEY कॉन्फ़िगर करें।"
        : language === "bn-IN"
        ? "ত্রুটি: অনুগ্রহ করে AI Studio-র Settings > Secrets প্যানেলে GEMINI_API_KEY কনফিগার করুন।"
        : "PROTOCOL_NOTICE: GEMINI_API_KEY is not configured. Please set your key in the AI Studio Settings > Secrets panel.",
      isConfigMissing: true
    });
  }

  try {
    const systemInstruction = SYSTEM_PROMPTS[language] || SYSTEM_PROMPTS["en-US"];

    const formattedContents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];

    // Sanitize conversation history: must start with user and strictly alternate
    if (Array.isArray(history)) {
      for (const item of history) {
        if (item && item.content && typeof item.content === "string" && item.content.trim()) {
          const role: "user" | "model" = item.role === "assistant" || item.role === "model" ? "model" : "user";
          // Contents array cannot start with model
          if (formattedContents.length === 0 && role === "model") {
            continue;
          }
          // Merge consecutive same-role messages
          const prev = formattedContents[formattedContents.length - 1];
          if (prev && prev.role === role) {
            prev.parts[0].text += `\n${item.content.trim()}`;
          } else {
            formattedContents.push({
              role,
              parts: [{ text: item.content.trim() }],
            });
          }
        }
      }
    }

    // Append current user prompt
    const prev = formattedContents[formattedContents.length - 1];
    if (prev && prev.role === "user") {
      prev.parts[0].text += `\n${message.trim()}`;
    } else {
      formattedContents.push({
        role: "user",
        parts: [{ text: message.trim() }],
      });
    }

    const response = await generateContentWithRetry(ai, {
      model: "gemini-3.1-flash-lite",
      contents: formattedContents,
      config: {
        systemInstruction,
        temperature: 0.7,
      },
    });

    const reply = response.text || (
      language === "hi-IN"
        ? "सॉइल गार्ड ने मिट्टी के आंकड़ों का विश्लेषण किया है। कृपया अपना प्रश्न पुनः पूछें।"
        : language === "bn-IN"
        ? "সয়েল গার্ড মাটির ডেটা বিশ্লেষণ করেছে। অনুগ্রহ করে পুনরায় আপনার প্রশ্ন করুন।"
        : "SoilGuard has analyzed your field parameters. Please ask any specific soil or crop question."
    );

    return res.json({ reply, language });
  } catch (err: any) {
    console.error("[GEMINI CHAT ERROR]", err);
    const errMsg = err?.message || String(err);
    if (errMsg.includes("API_KEY_INVALID") || errMsg.includes("API key not valid")) {
      return res.status(401).json({
        reply: "CRITICAL_ERROR: Provided GEMINI_API_KEY is invalid. Please verify the key in Secrets panel.",
        error: errMsg
      });
    }

    // Direct agricultural emergency fallback based on prompt content
    const lower = message.toLowerCase();
    let smartFallback = "";
    if (language === "hi-IN") {
      if (lower.includes("ph") || lower.includes("पीएच")) {
        smartFallback = "मिट्टी का सही pH स्तर 6.0 से 7.0 के बीच आदर्श माना जाता है। यदि मिट्टी अधिक अम्लीय (Acidic) है, तो कृषि चूना (Agricultural Lime) मिलाएं। यदि मिट्टी क्षारीय (Alkaline) है, तो जिप्सम या जैविक कम्पोस्ट का उपयोग करें।";
      } else if (lower.includes("npk") || lower.includes("खाद") || lower.includes("नाइट्रोजन")) {
        smartFallback = "NPK (नाइट्रोजन-फॉस्फोरस-पोटाश) पौधों की वृद्धि की धुरी है। वानस्पतिक वृद्धि के लिए नाइट्रोजन, मजबूत जड़ों के लिए फॉस्फोरस, और रोग प्रतिरोधक क्षमता के लिए पोटाश जरूरी है। जैविक खाद जैसे गोबर खाद या वर्मीकम्पोस्ट मिट्टी की उर्वरता को लंबे समय तक बनाए रखते हैं।";
      } else {
        smartFallback = "SoilGuard जैविक कृषि सलाहकार: अपनी मिट्टी में नियमित जैविक खाद डालें, फसल चक्र (Crop Rotation) अपनाएं, और हर सीजन में मिट्टी की जांच (Soil Test) जरूर कराएं।";
      }
    } else if (language === "bn-IN") {
      if (lower.includes("ph")) {
        smartFallback = "মাটির আদর্শ pH মাত্রা ৬.০ থেকে ৭.০ এর মধ্যে থাকা উচিত। মাটি অম্লীয় হলে ডলোমাইট বা চুন প্রয়োগ করুন এবং ক্ষারীয় হলে জৈব কম্পোস্ট ব্যবহার করে ভারসাম্য ফিরিয়ে আনুন।";
      } else if (lower.includes("npk") || lower.includes("সার")) {
        smartFallback = "NPK (নাইট্রোজেন, ফসফরাস, পটাশ) মাটির প্রাণ। নাইট্রোজেন পাতার বৃদ্ধি ঘটায়, ফসফরাস শিকড় মজবুত করে এবং পটাশ রোগ প্রতিরোধ বাড়ায়। রাসায়নিক সারের পাশাপাশি ভার্মিকম্পোস্ট প্রয়োগে ফলন দ্বিগুণ হয়।";
      } else {
        smartFallback = "SoilGuard কৃষি নির্দেশিকা: জমিতে নিয়মিত জৈব সার ব্যবহার করুন, সঠিক সময়ে সেচ দিন এবং ফসল চক্র মেনে চলুন যাতে মাটির পুষ্টি বজায় থাকে।";
      }
    } else {
      if (lower.includes("ph") || lower.includes("acid")) {
        smartFallback = "Optimal soil pH is generally between 6.0 and 7.0 for most agricultural crops. If soil pH is under 6.0 (acidic), apply agricultural limestone. If pH exceeds 7.5 (alkaline), integrate elemental sulfur or organic compost to lower it and unlock micronutrient uptake.";
      } else if (lower.includes("npk") || lower.includes("nutrient") || lower.includes("nitrogen") || lower.includes("fertilizer")) {
        smartFallback = "The NPK triad is fundamental: Nitrogen (N) fuels vegetative foliage, Phosphorus (P) accelerates root establishment and flowering, and Potassium (K) enhances drought resistance and cell wall rigidity. Integrate organic vermicompost alongside balanced mineral fertilizers.";
      } else if (lower.includes("wheat") || lower.includes("crop")) {
        smartFallback = "For healthy crop yields, ensure well-draining loamy soil with 25-30% moisture capacity. Apply a split dose of nitrogen early during vegetative growth and maintain balanced phosphorus at sowing for root depth.";
      } else {
        smartFallback = "SoilGuard Field Analysis: Maintain soil organic matter through cover cropping, keep soil moisture balanced between 20-35%, and perform seasonal soil health tests to calibrate mineral inputs.";
      }
    }

    return res.status(200).json({
      reply: smartFallback,
      error: errMsg
    });
  }
});

// API: Text-to-Speech using gemini-3.8-flash-lite-tts
app.post("/api/tts", async (req, res) => {
  const { text, language = "en-US" } = req.body;

  if (!text || typeof text !== "string") {
    return res.status(400).json({ error: "Text is required" });
  }

  const ai = getGenAIClient();
  if (!ai) {
    return res.status(400).json({ error: "API key not configured" });
  }

  const cleanSpeechText = text
    .replace(/[#*`_~]/g, "")
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
    .replace(/(\r\n|\n|\r)/gm, " ")
    .trim()
    .slice(0, 1000);

  if (!cleanSpeechText) {
    return res.status(400).json({ error: "Cleaned speech text is empty" });
  }

  try {
    const ttsResponse = await ai.models.generateContent({
      model: "gemini-3.8-flash-lite-tts",
      contents: [
        {
          role: "user",
          parts: [
            {
              text: cleanSpeechText,
              speechMetadata: {
                style: language === "hi-IN" ? "Warm, clear Hindi agricultural guide" : language === "bn-IN" ? "Warm, clear Bengali agricultural guide" : "Clear, professional agricultural advisor",
              },
            },
          ],
        },
      ] as any,
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Kore" },
          },
        },
      },
    });

    const base64Audio = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      return res.json({
        audio: base64Audio,
        format: "audio/wav"
      });
    }
    return res.status(502).json({ error: "No audio generated in candidate response" });
  } catch (err: any) {
    console.warn("[TTS Warning - falling back to client voice]", err?.message || err);
    return res.status(500).json({ error: err?.message || "TTS generation failed" });
  }
});

// API: Audio Transcription using gemini-3.5-transcribe
app.post("/api/transcribe", async (req, res) => {
  const { audio, mimeType = "audio/webm", language = "en-US" } = req.body;

  if (!audio || typeof audio !== "string") {
    return res.status(400).json({ error: "Audio data (base64) is required" });
  }

  const ai = getGenAIClient();
  if (!ai) {
    return res.status(400).json({ error: "API key not configured" });
  }

  try {
    const langHint = language === "hi-IN" ? "Hindi (हिंदी)" : language === "bn-IN" ? "Bengali (বাংলা)" : "English";

    const audioPart = {
      inlineData: {
        mimeType: mimeType || "audio/webm",
        data: audio,
      },
    };

    const response = await ai.models.generateContent({
      model: "gemini-3.5-transcribe",
      contents: {
        parts: [
          audioPart,
          { text: `Transcribe this speech recording accurately in ${langHint}. Provide ONLY the transcribed text directly.` },
        ],
      },
    });

    const transcript = response.text ? response.text.trim() : "";
    return res.json({ transcript });
  } catch (err: any) {
    console.error("[TRANSCRIBE ERROR]", err);
    return res.status(500).json({ error: err?.message || "Transcription failed" });
  }
});

// ==========================================
// REAL-TIME WEBSOCKET SERVER FOR GEMINI 3.8 LIVE API
// ==========================================
const wss = new WebSocketServer({ server, path: "/live" });

wss.on("connection", async (clientWs, req) => {
  console.log("[LIVE API] Client connected to /live");

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey === "undefined") {
    clientWs.send(JSON.stringify({ error: "GEMINI_API_KEY is not configured in Secrets panel." }));
    clientWs.close();
    return;
  }

  // Parse query parameter for language, default to en-US
  let lang = "en-US";
  try {
    const url = new URL(req.url || "", `http://${req.headers.host || "localhost"}`);
    lang = url.searchParams.get("lang") || "en-US";
  } catch (e) {
    // fallback
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });

  const systemInstruction = LIVE_SYSTEM_PROMPTS[lang] || LIVE_SYSTEM_PROMPTS["en-US"];

  try {
    const session = await ai.live.connect({
      model: "gemini-3.8-live",
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Zephyr" },
          },
        },
        systemInstruction,
        outputAudioTranscription: {},
        inputAudioTranscription: {},
      },
      callbacks: {
        onmessage: (message: LiveServerMessage) => {
          // Send 24kHz raw PCM audio chunks to browser
          const audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
          if (audio && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ audio }));
          }

          // Real-time transcribed text from model
          const modelParts = message.serverContent?.modelTurn?.parts;
          if (modelParts && modelParts.length > 0) {
            for (const part of modelParts) {
              if (part.text && clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ text: part.text, role: "model" }));
              }
            }
          }

          // User speech transcription
          const userParts = (message as any)?.userTurn?.parts;
          if (userParts && userParts.length > 0) {
            for (const part of userParts) {
              if (part.text && clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ text: part.text, role: "user" }));
              }
            }
          }

          // User interruption (user started talking while model was playing)
          if (message.serverContent?.interrupted && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ interrupted: true }));
          }
        },
        onclose: () => {
          console.log("[LIVE API] Gemini Live session ended.");
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ closed: true }));
          }
        },
        onerror: (error: any) => {
          console.error("[LIVE API] Session error:", error);
          if (clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ error: error?.message || "Live API error" }));
          }
        },
      },
    });

    console.log("[LIVE API] Connected to Gemini 3.8 Live session successfully!");
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ ready: true, model: "gemini-3.8-live", lang }));
    }

    // Client audio streaming input
    clientWs.on("message", (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.audio) {
          // Audio is 16kHz PCM little-endian base64
          session.sendRealtimeInput({
            audio: { data: data.audio, mimeType: "audio/pcm;rate=16000" },
          });
        } else if (data.text) {
          session.sendRealtimeInput({
            text: data.text,
          });
        }
      } catch (err) {
        console.error("[LIVE API] Message parsing error:", err);
      }
    });

    clientWs.on("close", () => {
      console.log("[LIVE API] Client disconnected, closing session.");
      try {
        session.close();
      } catch (e) {
        // ignore
      }
    });
  } catch (err: any) {
    console.error("[LIVE API] Failed to connect to gemini-3.8-live:", err);
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ error: err?.message || "Could not connect to Gemini Live" }));
      clientWs.close();
    }
  }
});

async function startServer() {
  // Vite middleware for high-performance development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[CORE] SoilGuard Agricultural AI Server Online (HTTP + Live WebSocket) at port ${PORT}`);
  });
}

startServer();
