import { GoogleGenAI, Type, GenerateContentResponse, Modality, Blob } from "@google/genai";
import { Language, Message, Subject, QuizItem } from "../types";

const API_KEY = process.env.API_KEY || "";

const handleApiError = (error: any, onError: () => void) => {
  console.error("Gemini API Error:", error);
  // Check for specific error message as per guideline to reset API key state
  if (error?.message?.includes("Requested entity was not found.")) {
    onError();
  }
  throw error;
};

export const getGeminiResponse = async (
  prompt: string,
  language: Language,
  subject: Subject,
  history: Message[] = [],
  imageAttachments: string[] = [],
  onError: () => void,
) => {
  // Instantiate GoogleGenAI right before the API call to ensure the latest API key is used.
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  
  const systemInstruction = language === 'bn' 
    ? `আপনি একজন বিশেষজ্ঞ শিক্ষা সহায়ক AI যার নাম "ShikkhaAI"। আপনি ছাত্রদের গণিত, বিজ্ঞান, ইতিহাস এবং অন্যান্য বিষয়ে সাহায্য করেন। 
       বর্তমান বিষয়: ${subject}। আপনার উত্তরগুলি শিক্ষামূলক, সহজবোধ্য এবং উৎসাহব্যঞ্জক হতে হবে। সর্বদা উত্তর বাংলায় দিন, তবে জটিল টেকনিক্যাল শব্দ ব্র্যাকেটে ইংরেজিতে লিখতে পারেন।`
    : `You are an expert educational AI assistant named "ShikkhaAI". You help students with ${subject} and other academic topics.
       Your explanations should be pedagogically sound, clear, and encouraging. Answer in English.`;

  const contents: any[] = history.slice(-10).map(msg => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.content }]
  }));

  const userParts: any[] = [{ text: prompt }];
  
  imageAttachments.forEach(img => {
    userParts.push({
      inlineData: {
        data: img.split(',')[1],
        mimeType: 'image/jpeg'
      }
    });
  });

  contents.push({
    role: 'user',
    parts: userParts
  });

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents,
      config: {
        systemInstruction,
        tools: [{ googleSearch: {} }],
        temperature: 0.7,
      },
    });

    return {
      text: response.text || "Sorry, I couldn't generate a response.",
      groundingUrls: response.candidates?.[0]?.groundingMetadata?.groundingChunks?.map((chunk: any) => ({
        uri: chunk.web?.uri,
        title: chunk.web?.title
      })).filter((c: any) => c.uri) || []
    };
  } catch (error) {
    handleApiError(error, onError);
    return { text: "An error occurred. Please try again.", groundingUrls: [] };
  }
};

export const generateQuiz = async (context: string, language: Language, subject: Subject, onError: () => void): Promise<QuizItem[]> => {
  // Instantiate GoogleGenAI right before the API call to ensure the latest API key is used.
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const prompt = `Based on this context: "${context}", generate 3 multiple choice questions for a student in ${language === 'bn' ? 'Bengali' : 'English'}. Subject: ${subject}.`;
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              options: { type: Type.ARRAY, items: { type: Type.STRING } },
              correctAnswer: { type: Type.INTEGER, description: "Index of the correct option (0-3)" }
            },
            required: ["question", "options", "correctAnswer"]
          }
        }
      }
    });

    return JSON.parse(response.text || "[]");
  } catch (e) {
    handleApiError(e, onError);
    return [];
  }
};

export const generateSpeech = async (text: string, language: Language, onError: () => void) => {
  // Instantiate GoogleGenAI right before the API call to ensure the latest API key is used.
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const voiceName = language === 'bn' ? 'Kore' : 'Zephyr';
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName },
          },
        },
      },
    });

    return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  } catch (error) {
    handleApiError(error, onError);
    return null;
  }
};

// Base64 helpers
export function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

// Helper function to create Blob for audio data, adhering to @google/genai's Blob interface.
export function createBlob(data: Float32Array): Blob {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) {
    int16[i] = data[i] * 32768;
  }
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
}