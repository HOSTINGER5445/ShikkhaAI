
import React, { useState, useEffect, useRef } from 'react';
import { 
  BookOpen, Languages, Send, Image as ImageIcon, Mic, Volume2, History, PlusCircle, Settings, X, 
  Loader2, ExternalLink, GraduationCap, Sparkles, BrainCircuit, FileText, CheckCircle2, MicOff, PlayCircle, UserCircle
} from 'lucide-react';
import { Language, Message, Subject, ChatSession, LiveState, QuizItem } from './types';
import { getGeminiResponse, generateSpeech, decode, decodeAudioData, generateQuiz, encode } from './services/geminiService';
import { GoogleGenAI, Modality } from '@google/genai';
import ProfileSettingsModal from './ProfileSettingsModal';

const SUBJECTS: Subject[] = ['General', 'Mathematics', 'Science', 'History', 'Literature', 'ICT'];

// The 'window.aistudio' object is assumed to be pre-configured, valid, and accessible in the execution context.
// Therefore, explicitly declaring it here is unnecessary and can cause type conflicts.

const App: React.FC = () => {
  const [language, setLanguage] = useState<Language>('bn');
  const [subject, setSubject] = useState<Subject>('General');
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [liveState, setLiveState] = useState<LiveState>({ isActive: false, userTranscript: '', aiTranscript: '', isConnecting: false });
  const [hasApiKey, setHasApiKey] = useState(false);
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const [userAvatar, setUserAvatar] = useState<string | null>(null); // New state for user avatar
  
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const liveSessionRef = useRef<any>(null);

  const currentSession = sessions.find(s => s.id === currentSessionId);

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio && await window.aistudio.hasSelectedApiKey()) {
        setHasApiKey(true);
      } else {
        setHasApiKey(false);
      }
      if (sessions.length === 0) createNewSession();
    };
    checkKey();
  }, []);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [currentSession?.messages, isTyping, liveState.isActive]);

  const handleApiKeyError = () => {
    setHasApiKey(false);
    alert(language === 'bn' 
      ? 'আপনার API কী-তে একটি সমস্যা হয়েছে। অনুগ্রহ করে Google AI Studio ডায়ালগ থেকে একটি অর্থপ্রদত্ত GCP প্রোজেক্ট থেকে API কী নির্বাচন করুন।' 
      : 'There was an issue with your API key. Please select an API key from a paid GCP project via the Google AI Studio dialog.');
  };

  const createNewSession = (initialSubject: Subject = 'General') => {
    const newSession: ChatSession = {
      id: Date.now().toString(),
      title: language === 'bn' ? 'নতুন পড়া' : 'New Study Session',
      subject: initialSubject,
      language: language,
      messages: [],
      createdAt: new Date(),
    };
    setSessions(prev => [newSession, ...prev]);
    setCurrentSessionId(newSession.id);
    setSubject(initialSubject);
  };

  const handleSend = async (overridePrompt?: string) => {
    if (!hasApiKey) {
      handleApiKeyError();
      return;
    }
    const finalPrompt = overridePrompt || input;
    if (!finalPrompt.trim() && attachments.length === 0) return;
    if (!currentSessionId) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: finalPrompt,
      timestamp: new Date(),
      attachments: [...attachments],
    };

    updateSessionMessages(currentSessionId, userMessage);
    setInput('');
    setAttachments([]);
    setIsTyping(true);

    try {
      const history = currentSession?.messages || [];
      const response = await getGeminiResponse(finalPrompt, language, subject, history, userMessage.attachments, handleApiKeyError);
      
      const modelMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        content: response.text,
        timestamp: new Date(),
        groundingUrls: response.groundingUrls,
      };

      updateSessionMessages(currentSessionId, modelMessage);
    } catch (error) {
      console.error(error);
    } finally {
      setIsTyping(false);
    }
  };

  const startQuiz = async () => {
    if (!hasApiKey) {
      handleApiKeyError();
      return;
    }
    if (!currentSessionId || !currentSession || currentSession.messages.length === 0) return;
    setIsTyping(true);
    try {
      const context = currentSession.messages.slice(-5).map(m => m.content).join(' ');
      const quiz = await generateQuiz(context, language, subject, handleApiKeyError);
      
      const quizMsg: Message = {
        id: Date.now().toString(),
        role: 'model',
        content: language === 'bn' ? "এখানে একটি কুইজ দেওয়া হলো:" : "Here is a quick quiz for you:",
        timestamp: new Date(),
        isQuiz: true,
        quizData: quiz
      };
      updateSessionMessages(currentSessionId, quizMsg);
    } catch (e) {
      console.error(e);
    } finally {
      setIsTyping(false);
    }
  };

  const updateSessionMessages = (sessionId: string, newMessage: Message) => {
    setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, messages: [...s.messages, newMessage] } : s));
  };

  const startLiveTutor = async () => {
    if (!hasApiKey) {
      handleApiKeyError();
      return;
    }
    setLiveState(prev => ({ ...prev, isConnecting: true, isActive: true }));
    // Instantiate GoogleGenAI right before the API call to ensure the latest API key is used.
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
    
    let nextStartTime = 0;
    let inputAudioContext: AudioContext | null = null;
    let outputAudioContext: AudioContext | null = null;
    let stream: MediaStream | null = null;
    const sources = new Set<AudioBufferSourceNode>();

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      // CRITICAL: Solely rely on sessionPromise resolves and then call `session.sendRealtimeInput`, do not add other condition checks.
      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            if (!inputAudioContext || !stream) return;
            const source = inputAudioContext.createMediaStreamSource(stream);
            const scriptProcessor = inputAudioContext.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
              const pcmBlob = { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
              sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioContext.destination);
            setLiveState(prev => ({ ...prev, isConnecting: false }));
          },
          onmessage: async (message) => {
            if (message.serverContent?.outputTranscription) {
              setLiveState(prev => ({ ...prev, aiTranscript: prev.aiTranscript + message.serverContent!.outputTranscription!.text }));
            } else if (message.serverContent?.inputTranscription) {
               setLiveState(prev => ({ ...prev, userTranscript: prev.userTranscript + message.serverContent!.inputTranscription!.text }));
            }
            
            if (message.serverContent?.turnComplete) {
              setLiveState(prev => ({ ...prev, userTranscript: '', aiTranscript: '' }));
            }

            const audioBase64 = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioBase64 && outputAudioContext) {
              nextStartTime = Math.max(nextStartTime, outputAudioContext.currentTime);
              const buffer = await decodeAudioData(decode(audioBase64), outputAudioContext, 24000, 1);
              const source = outputAudioContext.createBufferSource();
              source.buffer = buffer;
              source.connect(outputAudioContext.destination);
              source.start(nextStartTime);
              nextStartTime += buffer.duration;
              sources.add(source);
            }
            if (message.serverContent?.interrupted) {
              sources.forEach(s => s.stop());
              sources.clear();
              nextStartTime = 0;
            }
          },
          onclose: () => stopLiveTutor(),
          onerror: (e) => {
            console.error("Live API Error:", e);
            handleApiKeyError(); // Re-prompt on error
            stopLiveTutor();
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: `You are a helpful study tutor named ShikkhaAI. Support both English and Bengali. Context: ${subject}.`
        }
      });
      liveSessionRef.current = { sessionPromise, stream, inputAudioContext, outputAudioContext };
    } catch (e: any) {
      console.error(e);
      if (e.message.includes("Requested entity was not found.")) {
         handleApiKeyError();
      } else if (e.name === 'NotFoundError' || e.name === 'NotAllowedError' || e.name === 'NotReadableError') {
        alert(language === 'bn' 
          ? 'মাইক্রোফোন পাওয়া যায়নি বা অ্যাক্সেস করা যায়নি। লাইভ টিউটর ব্যবহারের জন্য একটি মাইক্রোফোন প্রয়োজন।' 
          : 'Microphone not found or could not be accessed. A microphone is required to use the Live Tutor.');
      }
      stopLiveTutor();
    }
  };

  const stopLiveTutor = () => {
    if (liveSessionRef.current) {
      // Use .then() on the sessionPromise to ensure it's resolved before attempting to close
      liveSessionRef.current.sessionPromise.then((session: any) => {
        if (session && session.close) {
          session.close();
        }
      });
      if (liveSessionRef.current.stream) liveSessionRef.current.stream.getTracks().forEach((t: any) => t.stop());
      if (liveSessionRef.current.inputAudioContext) liveSessionRef.current.inputAudioContext.close();
      if (liveSessionRef.current.outputAudioContext) liveSessionRef.current.outputAudioContext.close();
    }
    setLiveState({ isActive: false, userTranscript: '', aiTranscript: '', isConnecting: false });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    Array.from(files).forEach(file => {
      const reader = new FileReader();
      reader.onloadend = () => setAttachments(prev => [...prev, reader.result as string]);
      reader.readAsDataURL(file);
    });
  };

  const speakText = async (text: string) => {
    if (!hasApiKey) {
      handleApiKeyError();
      return;
    }
    if (isSpeaking) return;
    setIsSpeaking(true);
    try {
      const base64Audio = await generateSpeech(text, language, handleApiKeyError);
      if (base64Audio) {
        if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
        const ctx = audioContextRef.current;
        const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        source.onended = () => setIsSpeaking(false);
        source.start();
      } else setIsSpeaking(false);
    } catch (e) { setIsSpeaking(false); }
  };

  const translations = {
    headerTitle: language === 'bn' ? 'শিক্ষা AI' : 'ShikkhaAI',
    placeholder: language === 'bn' ? 'আপনার প্রশ্নটি এখানে লিখুন...' : 'Ask your study question here...',
    newChat: language === 'bn' ? 'নতুন প্রশ্ন' : 'New Question',
    history: language === 'bn' ? 'আগের আলোচনা' : 'Recent Sessions',
    subject: language === 'bn' ? 'বিষয়' : 'Subject',
    languageBtn: language === 'bn' ? 'English' : 'বাংলা',
    typing: language === 'bn' ? 'ShikkhaAI চিন্তা করছে...' : 'ShikkhaAI is thinking...',
    sources: language === 'bn' ? 'তথ্যসূত্রসমূহ' : 'Sources & References',
    liveTutor: language === 'bn' ? 'লাইভ টিউটর' : 'Live Tutor',
    stopLive: language === 'bn' ? 'বন্ধ করুন' : 'Stop Session',
    summarize: language === 'bn' ? 'সারসংক্ষেপ' : 'Summarize',
    quiz: language === 'bn' ? 'কুইজ' : 'Quiz',
    simplify: language === 'bn' ? 'সহজ ব্যাখ্যা' : 'Simplify',
    apiKeyRequired: language === 'bn' ? 'API কী প্রয়োজন' : 'API Key Required',
    apiKeyPrompt: language === 'bn' ? 'এই অ্যাপটি ব্যবহার করার জন্য আপনাকে একটি Google Gemini API কী নির্বাচন করতে হবে। একটি অর্থপ্রদত্ত GCP প্রোজেক্ট থেকে আপনার API কী নির্বাচন করুন।' : 'To use this app, you need to select a Google Gemini API Key. Please select your API Key from a paid GCP project.',
    selectApiKey: language === 'bn' ? 'আমার API কী নির্বাচন করুন' : 'Select My API Key',
    billingDoc: language === 'bn' ? 'বিলিং ডকুমেন্টেশন' : 'Billing Documentation',
    profileSettings: language === 'bn' ? 'প্রোফাইল সেটিংস' : 'Profile Settings',
    uploadAvatar: language === 'bn' ? 'ছবি আপলোড করুন' : 'Upload Avatar',
    changeAvatar: language === 'bn' ? 'ছবি পরিবর্তন করুন' : 'Change Avatar',
    removeAvatar: language === 'bn' ? 'ছবি সরান' : 'Remove Avatar',
    generalSettings: language === 'bn' ? 'সাধারণ সেটিংস' : 'General Settings',
    preferredLanguage: language === 'bn' ? 'পছন্দের ভাষা' : 'Preferred Language',
    languageEnglish: 'English',
    languageBengali: 'বাংলা',
  };

  if (!hasApiKey) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-indigo-900 text-white p-8 text-center animate-in fade-in duration-500">
        <div className="w-32 h-32 bg-indigo-600 rounded-3xl flex items-center justify-center text-white shadow-2xl mb-8">
          <GraduationCap size={64} />
        </div>
        <h2 className="text-4xl font-black mb-4">{translations.apiKeyRequired}</h2>
        <p className="text-xl max-w-2xl leading-relaxed mb-8">{translations.apiKeyPrompt}</p>
        <button
          onClick={async () => {
            if (window.aistudio) {
              await window.aistudio.openSelectKey();
              setHasApiKey(true); // Assume success to mitigate race condition
            }
          }}
          className="bg-amber-500 hover:bg-amber-600 text-white font-bold py-4 px-8 rounded-full text-lg shadow-lg transform transition-all active:scale-95 mb-4"
        >
          {translations.selectApiKey}
        </button>
        <a 
          href="https://ai.google.dev/gemini-api/docs/billing" 
          target="_blank" 
          rel="noopener noreferrer" 
          className="text-indigo-200 hover:text-indigo-100 underline text-sm"
        >
          {translations.billingDoc}
        </a>
      </div>
    );
  }

  return (
    <div className={`flex h-screen bg-slate-50 text-slate-900 overflow-hidden ${language === 'bn' ? 'bengali-font' : ''}`}>
      {/* Sidebar */}
      <aside className="w-80 border-r border-slate-200 bg-white flex flex-col hidden lg:flex">
        <div className="p-6 flex items-center gap-3 border-b border-slate-100">
          <div className="bg-indigo-600 p-2 rounded-xl text-white shadow-lg shadow-indigo-200">
            <GraduationCap size={28} />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-indigo-900">{translations.headerTitle}</h1>
        </div>

        <div className="p-4">
          <button 
            onClick={() => createNewSession(subject)}
            className="w-full flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl font-semibold transition-all shadow-md active:scale-95"
          >
            <PlusCircle size={20} />
            {translations.newChat}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider mb-2 mt-4">
            <History size={14} />
            {translations.history}
          </div>
          {sessions.map(session => (
            <button
              key={session.id}
              onClick={() => setCurrentSessionId(session.id)}
              className={`w-full text-left p-3 rounded-xl flex items-center gap-3 transition-all ${
                currentSessionId === session.id ? 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100 shadow-sm' : 'hover:bg-slate-50 text-slate-600'
              }`}
            >
              <div className={`p-2 rounded-lg ${currentSessionId === session.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
                <BookOpen size={16} />
              </div>
              <div className="truncate">
                <div className="text-sm font-semibold truncate">{session.messages[0]?.content.slice(0, 30) || session.title}</div>
                <div className="text-[10px] opacity-60 font-medium">{session.subject} • {new Date(session.createdAt).toLocaleDateString()}</div>
              </div>
            </button>
          ))}
        </div>

        <div className="p-4 border-t border-slate-100 bg-slate-50/50">
          <button onClick={() => setShowProfileSettings(true)} className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-white hover:shadow-sm text-slate-600 transition-all border border-transparent hover:border-slate-200 mb-2">
            <div className="flex items-center gap-3">
              {userAvatar ? (
                <img src={userAvatar} alt="User Avatar" className="w-6 h-6 rounded-full object-cover border border-slate-200" />
              ) : (
                <UserCircle size={24} className="text-indigo-600" />
              )}
              <span className="text-sm font-semibold">{translations.profileSettings}</span>
            </div>
          </button>
          <button onClick={() => setLanguage(l => l === 'en' ? 'bn' : 'en')} className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-white hover:shadow-sm text-slate-600 transition-all border border-transparent hover:border-slate-200">
            <div className="flex items-center gap-3">
              <Languages size={18} className="text-indigo-600" />
              <span className="text-sm font-semibold">{translations.languageBtn}</span>
            </div>
            <div className="w-8 h-4 bg-slate-200 rounded-full relative">
              <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-indigo-600 transition-all ${language === 'bn' ? 'right-0.5' : 'left-0.5'}`} />
            </div>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative min-w-0 bg-white md:bg-slate-50">
        {/* Header */}
        <header className="h-16 border-b border-slate-200 bg-white/80 backdrop-blur-lg flex items-center justify-between px-4 md:px-8 sticky top-0 z-20">
          <div className="flex items-center gap-4">
            <button onClick={() => startLiveTutor()} className="flex items-center gap-2 px-4 py-2 bg-amber-50 text-amber-700 rounded-full text-sm font-bold border border-amber-100 hover:bg-amber-100 transition-all active:scale-95 shadow-sm">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
              </span>
              {translations.liveTutor}
            </button>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-slate-400 uppercase hidden sm:inline">{translations.subject}:</span>
            <select value={subject} onChange={(e) => setSubject(e.target.value as Subject)} className="bg-slate-100 border-none rounded-xl py-1.5 px-4 focus:ring-2 focus:ring-indigo-500 text-sm font-bold text-slate-700 cursor-pointer hover:bg-slate-200 transition-colors">
              {SUBJECTS.map(sub => (
                <option key={sub} value={sub}>{language === 'bn' ? getSubjectNameBn(sub) : sub}</option>
              ))}
            </select>
          </div>
        </header>

        {/* Study Toolbox */}
        {currentSession && currentSession.messages.length > 0 && (
          <div className="flex gap-2 p-2 px-4 md:px-8 bg-white/50 border-b border-slate-100 overflow-x-auto scrollbar-hide">
            <button onClick={startQuiz} className="flex items-center gap-2 whitespace-nowrap px-4 py-1.5 rounded-full bg-white border border-slate-200 text-xs font-bold text-indigo-600 hover:border-indigo-200 hover:bg-indigo-50 transition-all shadow-sm">
              <CheckCircle2 size={14} /> {translations.quiz}
            </button>
            <button onClick={() => handleSend(language === 'bn' ? 'সারসংক্ষেপ করে দিন' : 'Please summarize our discussion')} className="flex items-center gap-2 whitespace-nowrap px-4 py-1.5 rounded-full bg-white border border-slate-200 text-xs font-bold text-emerald-600 hover:border-emerald-200 hover:bg-emerald-50 transition-all shadow-sm">
              <FileText size={14} /> {translations.summarize}
            </button>
            <button onClick={() => handleSend(language === 'bn' ? 'এটি আরও সহজভাবে বুঝিয়ে দিন' : 'Explain this more simply')} className="flex items-center gap-2 whitespace-nowrap px-4 py-1.5 rounded-full bg-white border border-slate-200 text-xs font-bold text-amber-600 hover:border-amber-200 hover:bg-amber-50 transition-all shadow-sm">
              <BrainCircuit size={14} /> {translations.simplify}
            </button>
          </div>
        )}

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 scroll-smooth">
          {(!currentSession || currentSession.messages.length === 0) && (
            <div className="h-full flex flex-col items-center justify-center text-center max-w-2xl mx-auto space-y-8 animate-in fade-in zoom-in duration-500">
              <div className="relative">
                <div className="w-24 h-24 bg-indigo-600 rounded-3xl flex items-center justify-center text-white shadow-2xl rotate-3">
                  <GraduationCap size={48} />
                </div>
                <div className="absolute -bottom-2 -right-2 w-10 h-10 bg-amber-400 rounded-2xl flex items-center justify-center text-white shadow-lg -rotate-12">
                  <Sparkles size={20} />
                </div>
              </div>
              <div>
                <h2 className="text-4xl font-black text-slate-800 mb-4 tracking-tight">
                  {language === 'bn' ? 'কেমন আছো? আমি তোমার শিক্ষা বন্ধু!' : "Hey! I'm your study partner."}
                </h2>
                <p className="text-slate-500 text-xl leading-relaxed font-medium">
                  {language === 'bn' 
                    ? 'যেকোনো বিষয়ে সাহায্য চাও—আমি গণিত সমাধান, নোট তৈরি বা জটিল বিষয় বোঝাতে পারি।' 
                    : 'Ask me anything—I can solve equations, take notes, or explain tough science concepts.'}
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full px-4">
                {[
                  { en: 'Newton\'s Third Law', bn: 'নিউটনের তৃতীয় সূত্র' },
                  { en: 'Solve: 2x + 5 = 15', bn: 'সমাধান: ২x + ৫ = ১৫' },
                  { en: 'How does photosynthesis work?', bn: 'সালোকসংশ্লেষণ কীভাবে কাজ করে?' },
                  { en: 'Write a summary of Hamlet', bn: 'হ্যামলেট নাটকের সারসংক্ষেপ' }
                ].map(ex => (
                  <button 
                    key={ex.en}
                    onClick={() => setInput(language === 'bn' ? ex.bn : ex.en)}
                    className="p-5 bg-white border border-slate-200 rounded-2xl text-sm font-bold text-slate-700 hover:border-indigo-500 hover:text-indigo-600 transition-all text-left shadow-sm hover:shadow-md group"
                  >
                    <span className="flex items-center justify-between">
                      {language === 'bn' ? ex.bn : ex.en}
                      <PlayCircle size={18} className="opacity-0 group-hover:opacity-100 transition-opacity text-indigo-500" />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {currentSession?.messages.map((msg) => (
            <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} animate-in slide-in-from-bottom-2`}>
              <div className={`max-w-[90%] md:max-w-[80%] rounded-2xl p-5 md:p-6 shadow-sm relative group ${
                msg.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-white border border-slate-200 text-slate-800 rounded-tl-none'
              }`}>
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="flex gap-2 mb-4">
                    {msg.attachments.map((img, idx) => (
                      <img key={idx} src={img} alt="attachment" className="w-48 h-auto rounded-xl border border-white/20 shadow-lg" />
                    ))}
                  </div>
                )}
                
                <div className="prose prose-slate max-w-none font-medium leading-relaxed">
                  <p className="whitespace-pre-wrap">{msg.content}</p>
                </div>

                {msg.isQuiz && msg.quizData && (
                  <div className="mt-6 space-y-4">
                    {msg.quizData.map((q, i) => (
                      <div key={i} className="p-4 bg-slate-50 rounded-xl border border-slate-100">
                        <p className="font-bold text-indigo-900 mb-3">{q.question}</p>
                        <div className="grid gap-2">
                          {q.options.map((opt, oi) => (
                            <button key={oi} onClick={() => alert(oi === q.correctAnswer ? 'Correct! 🎉' : 'Try again! ❌')} className="text-left p-3 rounded-lg bg-white border border-slate-200 text-sm hover:border-indigo-300 hover:bg-indigo-50 transition-all font-semibold">
                              {opt}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {msg.role === 'model' && (
                  <button onClick={() => speakText(msg.content)} className="absolute -right-12 top-0 p-3 text-slate-400 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity bg-white rounded-full shadow-sm">
                    {isSpeaking ? <Loader2 className="animate-spin" size={18} /> : <Volume2 size={18} />}
                  </button>
                )}

                {msg.groundingUrls && msg.groundingUrls.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    <div className="flex flex-wrap gap-2">
                      {msg.groundingUrls.map((source, idx) => (
                        <a key={idx} href={source.uri} target="_blank" rel="noopener noreferrer" className="text-[10px] bg-slate-50 border border-slate-200 hover:bg-indigo-50 hover:border-indigo-200 px-3 py-1.5 rounded-full text-slate-600 transition-all flex items-center gap-1 font-bold">
                          <ExternalLink size={10} /> {source.title || 'Source'}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <span className="text-[10px] text-slate-400 mt-2 mx-1 font-bold uppercase tracking-tighter">
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          ))}

          {isTyping && (
            <div className="flex items-center gap-3 bg-white border border-slate-200 rounded-2xl p-4 w-fit shadow-sm animate-pulse">
               <div className="w-6 h-6 bg-indigo-600 rounded-lg flex items-center justify-center text-white">
                  <GraduationCap size={14} />
               </div>
               <span className="text-xs font-bold text-slate-400 italic">{translations.typing}</span>
            </div>
          )}
        </div>

        {/* Live Overlay */}
        {liveState.isActive && (
          <div className="absolute inset-0 bg-indigo-900/90 backdrop-blur-xl z-50 flex flex-col items-center justify-center p-8 text-white animate-in fade-in duration-300">
            <div className="absolute top-8 right-8">
              <button onClick={stopLiveTutor} className="p-4 bg-red-500/20 hover:bg-red-500 text-red-500 hover:text-white rounded-full transition-all border border-red-500/50">
                <MicOff size={24} />
              </button>
            </div>
            
            <div className="w-64 h-64 relative mb-12">
              <div className="absolute inset-0 bg-indigo-500 rounded-full animate-ping opacity-20"></div>
              <div className="absolute inset-0 bg-indigo-400 rounded-full animate-pulse opacity-40 [animation-delay:0.5s]"></div>
              <div className="relative w-full h-full bg-gradient-to-tr from-indigo-600 to-indigo-400 rounded-full flex items-center justify-center shadow-2xl border-4 border-white/20">
                <Mic size={64} />
              </div>
            </div>

            <div className="max-w-2xl w-full space-y-8 text-center">
              {liveState.isConnecting ? (
                <div className="flex flex-col items-center gap-4">
                  <Loader2 className="animate-spin" size={48} />
                  <h3 className="text-2xl font-bold">{language === 'bn' ? 'সংযোগ হচ্ছে...' : 'Connecting to ShikkhaAI...'}</h3>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <p className="text-indigo-200 text-xs font-bold uppercase tracking-widest">{language === 'bn' ? 'আপনি বলছেন' : 'You are saying'}</p>
                    <p className="text-2xl font-semibold h-16">{liveState.userTranscript || '...'}</p>
                  </div>
                  <div className="h-px bg-white/10 w-full" />
                  <div className="space-y-2">
                    <p className="text-amber-400 text-xs font-bold uppercase tracking-widest">{language === 'bn' ? 'শিক্ষা AI' : 'ShikkhaAI'}</p>
                    <p className="text-2xl font-bold text-amber-50 h-32">{liveState.aiTranscript || '...'}</p>
                  </div>
                </>
              )}
            </div>
            
            <p className="mt-12 text-sm text-indigo-300 font-medium">
              {language === 'bn' ? 'বন্ধ করতে ওপরের লাল বাটনে চাপ দিন' : 'Tap the red button to end the session'}
            </p>
          </div>
        )}

        {/* Input Bar */}
        <div className="p-4 md:p-8 bg-white md:bg-transparent">
          <div className="max-w-5xl mx-auto flex flex-col gap-4">
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-3 mb-1 p-3 bg-white border border-slate-200 rounded-2xl shadow-sm">
                {attachments.map((img, idx) => (
                  <div key={idx} className="relative w-24 h-24 group">
                    <img src={img} alt="preview" className="w-full h-full object-cover rounded-xl shadow-md" />
                    <button onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))} className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1.5 shadow-xl opacity-0 group-hover:opacity-100 transition-opacity">
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            <div className="relative flex items-end gap-3">
              <div className="flex-1 relative group">
                <textarea 
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
                  placeholder={translations.placeholder}
                  className="w-full pl-6 pr-24 py-5 bg-white border-2 border-slate-200 rounded-3xl focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 focus:outline-none transition-all resize-none shadow-xl shadow-slate-200/50 max-h-48 min-h-[64px] font-medium"
                  rows={1}
                />

                <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  <button onClick={() => fileInputRef.current?.click()} className="p-2.5 text-slate-400 hover:text-indigo-600 transition-colors rounded-xl hover:bg-slate-50">
                    <ImageIcon size={22} />
                  </button>
                  <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" multiple accept="image/*" />
                </div>
              </div>

              <button 
                onClick={() => handleSend()}
                disabled={!input.trim() && attachments.length === 0}
                className="h-[64px] w-[64px] flex items-center justify-center bg-indigo-600 text-white rounded-3xl shadow-xl shadow-indigo-300 hover:bg-indigo-700 hover:scale-105 active:scale-95 disabled:opacity-50 disabled:shadow-none transition-all group"
              >
                <Send size={24} className="group-hover:translate-x-1 group-hover:-translate-y-1 transition-transform" />
              </button>
            </div>
            
            <div className="flex items-center justify-center gap-4 text-[10px] text-slate-400 font-black uppercase tracking-[0.2em]">
               <div className="h-px w-8 bg-slate-200" />
               ShikkhaAI Intelligent Tutor
               <div className="h-px w-8 bg-slate-200" />
            </div>
          </div>
        </div>
      </main>

      <ProfileSettingsModal
        isOpen={showProfileSettings}
        onClose={() => setShowProfileSettings(false)}
        language={language}
        setLanguage={setLanguage}
        userAvatar={userAvatar}
        setUserAvatar={setUserAvatar}
        translations={translations}
      />
    </div>
  );
};

const getSubjectNameBn = (subject: Subject): string => {
  const map: Record<Subject, string> = {
    'General': 'সাধারণ', 'Mathematics': 'গণিত', 'Science': 'বিজ্ঞান',
    'History': 'ইতিহাস', 'Literature': 'সাহিত্য', 'ICT': 'তথ্য ও প্রযুক্তি'
  };
  return map[subject];
};

export default App;
