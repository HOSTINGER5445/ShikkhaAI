
import React, { useRef } from 'react';
import { X, UserCircle, UploadCloud, Languages, Settings as SettingsIcon } from 'lucide-react';
import { Language } from './types';

interface ProfileSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  language: Language;
  setLanguage: (lang: Language) => void;
  userAvatar: string | null;
  setUserAvatar: (avatar: string | null) => void;
  translations: {
    profileSettings: string;
    uploadAvatar: string;
    changeAvatar: string;
    removeAvatar: string;
    generalSettings: string;
    preferredLanguage: string;
    languageEnglish: string;
    languageBengali: string;
  };
}

const ProfileSettingsModal: React.FC<ProfileSettingsModalProps> = ({
  isOpen,
  onClose,
  language,
  setLanguage,
  userAvatar,
  setUserAvatar,
  translations,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setUserAvatar(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 animate-in fade-in duration-300">
      <div className="bg-white rounded-3xl shadow-xl w-full max-w-lg p-6 md:p-8 relative transform animate-in slide-in-from-bottom-8 ease-out duration-300">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full hover:bg-slate-100 text-slate-500 transition-colors"
        >
          <X size={24} />
        </button>

        <div className="flex items-center gap-4 border-b border-slate-100 pb-6 mb-6">
          <SettingsIcon size={32} className="text-indigo-600" />
          <h2 className="text-2xl font-bold text-slate-800">{translations.profileSettings}</h2>
        </div>

        <div className="space-y-8">
          {/* Avatar Section */}
          <div className="flex flex-col items-center gap-4">
            <div className="relative w-32 h-32 rounded-full bg-slate-100 flex items-center justify-center overflow-hidden border-4 border-indigo-50/50 shadow-inner">
              {userAvatar ? (
                <img src={userAvatar} alt="User Avatar" className="w-full h-full object-cover" />
              ) : (
                <UserCircle size={80} className="text-slate-400" />
              )}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="absolute inset-0 bg-black/40 text-white flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity rounded-full"
                title={translations.changeAvatar}
              >
                <UploadCloud size={32} />
              </button>
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="image/*"
                onChange={handleAvatarFileChange}
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full text-sm font-semibold transition-all shadow-md active:scale-95"
              >
                {userAvatar ? translations.changeAvatar : translations.uploadAvatar}
              </button>
              {userAvatar && (
                <button
                  onClick={() => setUserAvatar(null)}
                  className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-600 rounded-full text-sm font-semibold transition-all shadow-md active:scale-95"
                >
                  {translations.removeAvatar}
                </button>
              )}
            </div>
          </div>

          {/* Language Section */}
          <div className="space-y-3">
            <h3 className="text-lg font-bold text-slate-700 flex items-center gap-2">
              <Languages size={20} className="text-indigo-500" /> {translations.preferredLanguage}
            </h3>
            <div className="flex justify-around bg-slate-50 rounded-xl p-2 border border-slate-100">
              <button
                onClick={() => setLanguage('en')}
                className={`flex-1 text-center py-2 rounded-lg font-semibold transition-colors ${
                  language === 'en' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                {translations.languageEnglish}
              </button>
              <button
                onClick={() => setLanguage('bn')}
                className={`flex-1 text-center py-2 rounded-lg font-semibold transition-colors ${
                  language === 'bn' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                {translations.languageBengali}
              </button>
            </div>
          </div>

          {/* General Settings Placeholder */}
          <div className="space-y-3 opacity-70">
            <h3 className="text-lg font-bold text-slate-700 flex items-center gap-2">
                <SettingsIcon size={20} className="text-indigo-500" /> {translations.generalSettings}
            </h3>
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 text-sm text-slate-500">
              {language === 'bn' ? 'অন্যান্য সেটিংস শীঘ্রই এখানে যোগ করা হবে।' : 'Other settings will be available here soon.'}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

export default ProfileSettingsModal;
