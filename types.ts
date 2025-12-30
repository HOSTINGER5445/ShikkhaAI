
export type Language = 'en' | 'bn';

export interface Message {
  id: string;
  role: 'user' | 'model';
  content: string;
  timestamp: Date;
  attachments?: string[]; 
  groundingUrls?: Array<{ uri: string; title: string }>;
  isQuiz?: boolean;
  quizData?: QuizItem[];
}

export interface QuizItem {
  question: string;
  options: string[];
  correctAnswer: number;
}

export type Subject = 'General' | 'Mathematics' | 'Science' | 'History' | 'Literature' | 'ICT';

export interface ChatSession {
  id: string;
  title: string;
  subject: Subject;
  language: Language;
  messages: Message[];
  createdAt: Date;
}

export interface LiveState {
  isActive: boolean;
  userTranscript: string;
  aiTranscript: string;
  isConnecting: boolean;
}
