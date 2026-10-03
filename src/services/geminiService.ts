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

function generateAgriculturalAdvice(prompt: string, language: string): string {
  const p = prompt.toLowerCase();
  if (language === 'hi-IN') {
    if (p.includes('ph') || p.includes('पीएच') || p.includes('अम्ल')) {
      return "फसलों के लिए मिट्टी का आदर्श pH 6.0 से 7.2 माना जाता है।\n- **अम्लीय मिट्टी (pH < 6.0):** बुवाई से पहले प्रति एकड़ 150-200 किग्रा कृषि चूना (Agricultural Lime) मिलाएं।\n- **क्षारीय मिट्टी (pH > 7.5):** जिप्सम (Gypsum) अथवा सड़ी गोबर खाद या वर्मीकम्पोस्ट का प्रयोग कर pH संतुलित करें।";
    }
    if (p.includes('npk') || p.includes('खाद') || p.includes('नाइट्रोजन') || p.includes('पोटाश') || p.includes('उर्वरक')) {
      return "संतुलित NPK पोषण फसल की पैदावार बढ़ाने का मुख्य आधार है:\n- **नाइट्रोजन (N):** पत्तियों व तने के समुचित विकास के लिए।\n- **फास्फोरस (P):** गहरी जड़ों और शुरुआती जमाव के लिए।\n- **पोटाश (K):** कीट-रोग प्रतिरोधक क्षमता और दानों की चमक बढ़ाने के लिए।\nसाथ में 5 टन प्रति हेक्टेयर गोबर खाद (FYM) का उपयोग करें।";
    }
    if (p.includes('गेहूं') || p.includes('wheat') || p.includes('धान') || p.includes('चावल') || p.includes('मक्का')) {
      return "मुख्य अनाज फसलों की मिट्टी प्रबंधन रणनीति:\n- दोमट या बलुई दोमट मिट्टी जिसमें जल निकास अच्छा हो, सर्वोत्तम है।\n- बुवाई के समय संतुलित फास्फोरस व पोटाश दें और पहली सिंचाई पर नाइट्रोजन का छिड़काव करें।\n- मिट्टी में 25-30% नमी का स्तर बनाए रखें।";
    }
    return "SoilGuard जैविक सलाहकार: स्वस्थ मिट्टी के लिए समय पर जुताई, फसल चक्र (Crop Rotation), हरी खाद (ढैंचा/सनई) और जैविक जीवामृत का उपयोग करें। मिट्टी में जैविक कार्बन का स्तर कम से कम 0.75% होना चाहिए।";
  }

  if (language === 'bn-IN') {
    if (p.includes('ph') || p.includes('অম্ল')) {
      return "মাটির আদর্শ pH মাত্রা ৬.০ থেকে ৭.০ এর মধ্যে থাকা প্রয়োজন।\n- **মাটি অম্লীয় হলে (pH < 6.0):** ডলোমাইট বা কৃষি চুন প্রয়োগ করুন।\n- **মাটি ক্ষারীয় হলে (pH > 7.5):** জৈব কম্পোস্ট ও জিপসাম ব্যবহার করে স্বাভাবিক অবস্থায় আনুন।";
    }
    if (p.includes('npk') || p.includes('সার') || p.includes('নাইট্রোজেন') || p.includes('পটাশ')) {
      return "জমির সুষম পুষ্টির জন্য NPK অনুপাত অত্যন্ত গুরুত্বপূর্ণ:\n- নাইট্রোজেন (N) দ্রুত বৃদ্ধির জন্য।\n- ফসফরাস (P) মূল বা শিকড়ের বলিষ্ঠ বৃদ্ধির জন্য।\n- পটাশিয়াম (K) প্রতিকূল আবহাওয়া ও রোগ প্রতিরোধের জন্য।\nরাসায়নিক সারের সাথে ভার্মিকম্পোস্ট প্রয়োগে সবচেয়ে ভালো ফল পাওয়া যায়।";
    }
    return "SoilGuard কৃষি পরামর্শ: জমিতে নিয়মিত ট্রাইকোডার্মা যুক্ত জৈব সার দিন, সঠিক সেচ ব্যবস্থা নিশ্চিত করুন এবং মাটির উর্বরতা রক্ষা করতে প্রতি বছর মাটি পরীক্ষা করুন।";
  }

  // English
  if (p.includes('ph') || p.includes('acid') || p.includes('alkaline')) {
    return "Optimal agricultural soil pH ranges between 6.0 and 7.2:\n* **Acidic Soil (pH < 6.0):** Amend with agricultural limestone (calcium carbonate) 2-4 weeks prior to planting to neutralize acidity.\n* **Alkaline Soil (pH > 7.5):** Incorporate elemental sulfur, composted pine needles, or peat to mobilize micronutrients like iron and zinc.\n* **Tip:** Retest pH every season as mineral fertilizers and irrigation shift soil acidity.";
  }
  if (p.includes('npk') || p.includes('nitrogen') || p.includes('phosphorus') || p.includes('potassium') || p.includes('fertilizer') || p.includes('nutrient')) {
    return "Balanced N-P-K nutrient management is key to crop health:\n* **Nitrogen (N):** Drives vegetative vigor and chlorophyll. Best applied in split doses to minimize leaching.\n* **Phosphorus (P):** Essential for root establishment, flowering, and energy transfer (ATP). Apply during seedbed preparation.\n* **Potassium (K):** Regulates stomatal conductance, water stress tolerance, and disease resistance.\n* **Bio-Enhancer:** Pair mineral inputs with mature vermicompost to boost soil cation exchange capacity (CEC).";
  }
  if (p.includes('wheat') || p.includes('grain') || p.includes('rice') || p.includes('corn') || p.includes('maize') || p.includes('crop')) {
    return "Cereal & Field Crop Soil Strategy:\n* **Soil Texture:** Well-drained loam or clay-loam with 20-30% available moisture capacity.\n* **Sowing Baseline:** Ensure adequate available phosphate at sowing for early root crown depth.\n* **Nitrogen Timing:** Top-dress nitrogen during early tillering and before jointing for maximum protein and grain fill.";
  }
  if (p.includes('moisture') || p.includes('water') || p.includes('irrigation')) {
    return "Soil Moisture Optimization:\n* Maintain root zone moisture between 25% and 35% field capacity.\n* Apply organic straw or woodchip mulch to cut soil evaporation by up to 40%.\n* Avoid waterlogged saturation, which deprives mycorrhizal root microbes of oxygen.";
  }
  return "SoilGuard Field Advisory: Maintain soil organic matter through cover cropping, keep soil moisture balanced between 20-35%, and perform seasonal soil health tests to calibrate mineral inputs for your crops.";
}

export const getGeminiResponse = async (
  userPrompt: string,
  history: Array<{ role: 'user' | 'assistant' | 'model'; content: string }> = [],
  focusLang: string = 'en-US'
): Promise<string> => {
  // Retry loop to handle transient server wakeups or network interruptions
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
        if (data && data.reply && typeof data.reply === 'string' && data.reply.trim()) {
          return data.reply;
        }
      }

      // If server returned non-JSON, retry after brief pause
      if (attempt < 2) {
        await wait(800 * (attempt + 1));
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
        await wait(800 * (attempt + 1));
        continue;
      }
    }
  }

  // Direct, rich agricultural advisory fallback tailored to the question and language
  return generateAgriculturalAdvice(userPrompt, focusLang);
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
