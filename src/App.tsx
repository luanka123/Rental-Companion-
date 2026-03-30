import React, { useState, useEffect, createContext, useContext, Component } from 'react';
import { Routes, Route, Link, useSearchParams, useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, MessageCircle, MapPin, Camera, AlertTriangle, Fuel, ArrowRight, Check, User, LogOut, X, Mail, Lock, UserPlus, Languages, Car, Users, Settings, LayoutDashboard, ClipboardList, ExternalLink, Copy, Trash2, Download, ChevronDown, ChevronUp, TrendingUp, Map as MapIcon, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GoogleGenAI } from "@google/genai";
import { auth, db, googleProvider } from './firebase';
import { onAuthStateChanged, signInWithPopup, signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword, User as FirebaseUser } from 'firebase/auth';
import { 
  doc, 
  getDoc, 
  setDoc, 
  updateDoc, 
  serverTimestamp,
  collection,
  deleteDoc,
  addDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
import { QRCodeSVG } from 'qrcode.react';
import EXIF from 'exif-js';
import { translateText, detectLanguage } from './services/geminiService';

// --- Error Handling ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class ErrorBoundary extends Component<any, any> {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    const self = this as any;
    if (self.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-red-50">
          <div className="bg-white p-8 rounded-3xl shadow-xl max-w-md w-full text-center">
            <AlertTriangle className="mx-auto text-red-500 mb-4" size={48} />
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Ops! Qualcosa è andato storto.</h1>
            <p className="text-gray-600 mb-6">L'applicazione ha riscontrato un errore imprevisto. Prova a ricaricare la pagina o resettare l'app.</p>
            <div className="bg-gray-100 p-4 rounded-xl text-left text-xs font-mono overflow-auto max-h-40 mb-6">
              {self.state.error?.message || "Errore sconosciuto"}
            </div>
            <div className="flex flex-col gap-3">
              <button 
                onClick={() => window.location.reload()}
                className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all"
              >
                Ricarica Pagina
              </button>
              <button 
                onClick={() => {
                  localStorage.clear();
                  sessionStorage.clear();
                  window.location.href = '/';
                }}
                className="w-full bg-gray-200 text-gray-800 py-3 rounded-xl font-bold hover:bg-gray-300 transition-all"
              >
                Resetta App
              </button>
            </div>
          </div>
        </div>
      );
    }

    return self.props.children;
  }
}

// --- Auth Context ---

interface UserProfile {
  uid: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  role: 'admin' | 'client';
}

interface AuthContextType {
  user: FirebaseUser | null;
  profile: UserProfile | null;
  loading: boolean;
  openAuthModal: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    console.log("AuthProvider: Initializing onAuthStateChanged...");
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      console.log("AuthProvider: Auth state changed", currentUser?.email);
      try {
        setUser(currentUser);
        if (currentUser) {
          console.log("AuthProvider: Fetching profile for", currentUser.uid);
          const docRef = doc(db, 'users', currentUser.uid);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            console.log("AuthProvider: Profile found", docSnap.data());
            setProfile(docSnap.data() as UserProfile);
          } else {
            console.log("AuthProvider: Profile not found");
            setProfile(null);
          }
        } else {
          setProfile(null);
        }
      } catch (err) {
        console.error("AuthProvider: Auth initialization error:", err);
      } finally {
        console.log("AuthProvider: Initialization complete, setting loading to false");
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  const openAuthModal = () => setIsModalOpen(true);
  const closeAuthModal = () => setIsModalOpen(false);

  return (
    <AuthContext.Provider value={{ user, profile, loading, openAuthModal }}>
      {children}
      <AuthModal isOpen={isModalOpen} onClose={closeAuthModal} />
    </AuthContext.Provider>
  );
};

const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

// --- Auth Modal ---

const AuthModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [isRegistering, setIsRegistering] = useState(false);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    username: '',
    email: '',
    password: ''
  });
  const [error, setError] = useState('');

  const handleGoogleLogin = async () => {
    try {
      console.log("AuthModal: Starting Google Login...");
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      console.log("AuthModal: Google Login successful", user.email);
      const docRef = doc(db, 'users', user.uid);
      const docSnap = await getDoc(docRef);
      
      if (!docSnap.exists()) {
        console.log("AuthModal: Creating new user profile...");
        const [firstName, ...lastNameParts] = (user.displayName || 'Utente').split(' ');
        const lastName = lastNameParts.join(' ') || 'Rental';
        const username = user.email?.split('@')[0] || `user_${user.uid.slice(0, 5)}`;
        
        await setDoc(docRef, {
          uid: user.uid,
          firstName,
          lastName,
          username,
          email: user.email,
          role: user.email === 'borrellim73@gmail.com' ? 'admin' : 'client',
          createdAt: serverTimestamp()
        });
      }
      onClose();
      console.log("AuthModal: Redirecting to dashboard...");
      navigate('/dashboard');
    } catch (err: any) {
      console.error("AuthModal: Google Login error", err);
      setError(err.message);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (isRegistering) {
        const result = await createUserWithEmailAndPassword(auth, formData.email, formData.password);
        await setDoc(doc(db, 'users', result.user.uid), {
          uid: result.user.uid,
          firstName: formData.firstName,
          lastName: formData.lastName,
          username: formData.username,
          email: formData.email,
          role: formData.email === 'borrellim73@gmail.com' ? 'admin' : 'client',
          createdAt: serverTimestamp()
        });
      } else {
        await signInWithEmailAndPassword(auth, formData.email, formData.password);
      }
      onClose();
      navigate('/dashboard');
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden relative"
      >
        <button onClick={onClose} className="absolute top-4 right-4 p-2 hover:bg-gray-100 rounded-full transition-colors">
          <X size={20} />
        </button>
        
        <div className="p-8">
          <h2 className="text-2xl font-bold text-center mb-6">
            {isRegistering ? t('auth.register') : t('auth.login')}
          </h2>

          {error && <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm mb-4">{error}</div>}

          <form onSubmit={handleEmailAuth} className="space-y-4">
            {isRegistering && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <input 
                    required
                    placeholder={t('auth.firstName')}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                    value={formData.firstName}
                    onChange={e => setFormData({...formData, firstName: e.target.value})}
                  />
                  <input 
                    required
                    placeholder={t('auth.lastName')}
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                    value={formData.lastName}
                    onChange={e => setFormData({...formData, lastName: e.target.value})}
                  />
                </div>
                <input 
                  required
                  placeholder={t('auth.username')}
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                  value={formData.username}
                  onChange={e => setFormData({...formData, username: e.target.value})}
                />
              </>
            )}
            <input 
              required
              type="email"
              placeholder={t('auth.email')}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
              value={formData.email}
              onChange={e => setFormData({...formData, email: e.target.value})}
            />
            <input 
              required
              type="password"
              placeholder={t('auth.password')}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
              value={formData.password}
              onChange={e => setFormData({...formData, password: e.target.value})}
            />
            <button className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all">
              {isRegistering ? t('auth.registerBtn') : t('auth.loginBtn')}
            </button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200"></div></div>
            <div className="relative flex justify-center text-sm"><span className="px-2 bg-white text-gray-500">{t('auth.or')}</span></div>
          </div>

          <button 
            onClick={handleGoogleLogin}
            className="w-full flex items-center justify-center gap-3 border border-gray-200 py-3 rounded-xl font-semibold hover:bg-gray-50 transition-all"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
            {t('auth.google')}
          </button>

          <p className="mt-6 text-center text-sm text-gray-600">
            {isRegistering ? t('auth.haveAccount') : t('auth.noAccount')}
            <button 
              onClick={() => setIsRegistering(!isRegistering)}
              className="ml-1 text-blue-600 font-bold hover:underline"
            >
              {isRegistering ? t('auth.loginBtn') : t('auth.registerBtn')}
            </button>
          </p>
        </div>
      </motion.div>
    </div>
  );
};

// --- Components ---

const Chat = ({ rentalUid, sessionId, sender, showCustomerCard = false }: { rentalUid: string, sessionId: string, sender: 'customer' | 'rental', showCustomerCard?: boolean }) => {
  const [messages, setMessages] = useState<any[]>([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customerInfo, setCustomerInfo] = useState<any>(null);

  useEffect(() => {
    if (sessionId) {
      const q = query(
        collection(db, 'rentals'),
        where('rentalUid', '==', rentalUid),
        where('customerPhone', '==', sessionId),
        where('status', '==', 'active')
      );
      const unsubscribe = onSnapshot(q, (snapshot) => {
        if (!snapshot.empty) {
          setCustomerInfo(snapshot.docs[0].data());
        } else {
          setCustomerInfo(null);
        }
      });
      return () => unsubscribe();
    }
  }, [rentalUid, sessionId]);

  useEffect(() => {
    // Query for both the provided rentalUid and demo-uid for testing
    const q = query(
      collection(db, 'chats'),
      where('rentalUid', 'in', [rentalUid, 'demo-uid']),
      where('sessionId', '==', sessionId)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any[];
      // Sort in memory with safety checks
      msgs.sort((a, b) => {
        const timeA = a.timestamp?.toMillis?.() || a.timestamp?.seconds * 1000 || 0;
        const timeB = b.timestamp?.toMillis?.() || b.timestamp?.seconds * 1000 || 0;
        return timeA - timeB;
      });
      setMessages(msgs);
    }, (err) => {
      console.error("Chat: Snapshot error", err);
      setError("Errore nel caricamento dei messaggi.");
    });

    return () => unsubscribe();
  }, [rentalUid, sessionId]);

  const handleSendMessage = async () => {
    const textToSend = inputText.trim();
    if (!textToSend || isSending) return;
    setIsSending(true);
    setError(null);
    setInputText(''); // Clear immediately to avoid multiple sends and potential UI lag

    try {
      console.log("Chat: Detecting language for", textToSend);
      const originalLang = await detectLanguage(textToSend);
      console.log("Chat: Detected language:", originalLang);
      
      let targetLang = 'it'; // Default target is Italian (for the rental)

      if (sender === 'rental') {
        // If rental is sending, try to find the customer's language from previous messages
        const customerMsg = messages.find(m => m.sender === 'customer');
        if (customerMsg && customerMsg.originalLang) {
          targetLang = customerMsg.originalLang;
        } else {
          targetLang = 'en'; // Fallback for customer
        }
      }
      
      // Only translate if languages are different
      let translatedText = textToSend;
      const cleanOriginalLang = originalLang.slice(0, 2).toLowerCase();
      const cleanTargetLang = targetLang.slice(0, 2).toLowerCase();

      if (cleanOriginalLang !== cleanTargetLang) {
        console.log(`Chat: Translating from ${cleanOriginalLang} to ${cleanTargetLang}`);
        translatedText = await translateText(textToSend, targetLang);
      }

      await addDoc(collection(db, 'chats'), {
        sender,
        rentalUid,
        sessionId,
        originalText: textToSend,
        translatedText,
        originalLang: cleanOriginalLang,
        targetLang: cleanTargetLang,
        timestamp: serverTimestamp()
      });
    } catch (err: any) {
      console.error("Chat: Send error", err);
      setError("Errore nell'invio del messaggio.");
      setInputText(textToSend); // Restore text on error
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex flex-col h-[450px] w-full max-w-sm bg-white rounded-3xl shadow-2xl border border-gray-100 overflow-hidden">
      <div className="bg-blue-600 p-4 text-white font-bold flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageCircle size={20} /> 
          <span>{sender === 'rental' ? `Chat con ${customerInfo?.customerName || sessionId}` : 'Assistenza Live'}</span>
        </div>
        <div className="text-[10px] bg-blue-500 px-2 py-1 rounded-full uppercase tracking-wider">AI Translated</div>
      </div>
      
      {showCustomerCard && customerInfo && (
        <div className="bg-blue-50 p-4 border-b border-blue-100 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-blue-600 uppercase">Cliente Identificato</p>
            <p className="text-sm font-bold text-gray-900">{customerInfo.customerName}</p>
            <p className="text-[10px] text-gray-500">{customerInfo.carModel} ({customerInfo.carPlate})</p>
          </div>
          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm text-blue-600">
            <Car size={20} />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50">
        {error && <div className="p-2 bg-red-100 text-red-600 text-xs rounded-lg text-center mb-2">{error}</div>}
        {messages.length === 0 && (
          <div className="text-center text-gray-400 text-sm mt-10">
            Inizia una conversazione. Tradurremo tutto automaticamente!
          </div>
        )}
        {messages.map((msg) => {
          const isMe = msg.sender === sender;
          const displayLang = isMe ? msg.originalLang : msg.targetLang;
          const displayText = isMe ? msg.originalText : msg.translatedText;
          const subText = isMe ? `Tradotto: ${msg.translatedText}` : `Originale: ${msg.originalText}`;
          const subLang = isMe ? msg.targetLang : msg.originalLang;

          return (
            <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] p-3 rounded-2xl shadow-sm ${isMe ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-white text-gray-800 rounded-tl-none'}`}>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[8px] px-1.5 py-0.5 rounded-full uppercase font-bold ${isMe ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
                    {displayLang || '??'}
                  </span>
                  {!isMe && (
                    <ArrowRight size={8} className="text-gray-300" />
                  )}
                  {!isMe && (
                    <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600 uppercase font-bold">
                      {msg.targetLang || '??'}
                    </span>
                  )}
                </div>
                <p className="text-sm leading-relaxed">{displayText}</p>
                <div className={`text-[9px] mt-1.5 pt-1.5 border-t ${isMe ? 'border-blue-500 opacity-70' : 'border-gray-100 text-gray-400'} italic`}>
                  {subText} ({subLang})
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="p-4 bg-white border-t border-gray-100 flex gap-2">
        <input 
          type="text" 
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleSendMessage();
            }
            // Prevent event bubbling to avoid global listeners catching spacebar
            e.stopPropagation();
          }}
          placeholder="Scrivi nella tua lingua..."
          className="flex-1 px-4 py-3 rounded-2xl bg-gray-50 border-none outline-none focus:ring-2 focus:ring-blue-500 text-sm"
        />
        <button 
          onClick={handleSendMessage}
          disabled={isSending || !inputText.trim()}
          className="bg-blue-600 text-white p-3 rounded-2xl hover:bg-blue-700 transition-all disabled:opacity-50 shadow-lg shadow-blue-100"
        >
          <ArrowRight size={20} />
        </button>
      </div>
    </div>
  );
};

const Navbar = () => {
  const { user, profile, openAuthModal } = useAuth();
  const { t, i18n } = useTranslation();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

  const toggleLanguage = () => {
    const newLang = i18n.language.startsWith('it') ? 'en' : 'it';
    i18n.changeLanguage(newLang);
  };

  return (
    <nav className="fixed top-0 left-0 right-0 bg-white/80 backdrop-blur-md z-50 border-b border-gray-100">
      <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold">R</div>
          <span className="font-bold text-xl tracking-tight text-gray-900">Rental<span className="text-blue-600">Companion</span></span>
        </Link>
        <div className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-600">
          <Link to="/" className="hover:text-blue-600 transition-colors">Home</Link>
          {user && (
            <Link 
              to="/dashboard" 
              className="hover:text-blue-600 transition-colors font-bold"
              onClick={() => {
                // Ensure we go to the default tab when clicking the main Dashboard link
                if (window.location.pathname === '/dashboard') {
                  window.location.reload();
                }
              }}
            >
              Dashboard
            </Link>
          )}
          <a href="#problemi" className="hover:text-blue-600 transition-colors">{t('nav.problems')}</a>
          <a href="#come-funziona" className="hover:text-blue-600 transition-colors">{t('nav.howItWorks')}</a>
        </div>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={toggleLanguage}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-600 flex items-center gap-1"
            title="Cambia lingua / Change language"
          >
            <Languages size={20} />
            <span className="text-xs font-bold uppercase">{i18n.language.split('-')[0]}</span>
          </button>

          {user ? (
            <div className="relative">
              <button 
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-full hover:bg-gray-100 transition-all border border-gray-100"
              >
                <div className="w-7 h-7 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center">
                  <User size={16} />
                </div>
                <span className="text-sm font-semibold text-gray-700 hidden sm:inline">
                  {profile?.username || user.displayName?.split(' ')[0] || 'Utente'}
                </span>
              </button>
              
              <AnimatePresence>
                {isUserMenuOpen && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 10 }}
                    className="absolute right-0 mt-2 w-48 bg-white rounded-2xl shadow-xl border border-gray-100 py-2 z-[60]"
                  >
                    <div className="px-4 py-2 border-b border-gray-50 mb-1">
                      <p className="text-xs text-gray-400">{t('nav.loggedInAs')}</p>
                      <p className="text-sm font-bold truncate">{user.email}</p>
                    </div>
                    <Link 
                      to="/dashboard"
                      onClick={() => setIsUserMenuOpen(false)}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <LayoutDashboard size={16} /> Dashboard
                    </Link>
                    <button 
                      onClick={() => signOut(auth)}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <LogOut size={16} /> {t('nav.logout')}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <button 
              onClick={openAuthModal}
              className="bg-blue-600 text-white px-6 py-2 rounded-full text-sm font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-200"
            >
              {t('nav.login')}
            </button>
          )}
        </div>
      </div>
    </nav>
  );
};

const CustomerCheckIn = () => {
  const [plate, setPlate] = useState('');
  const [phone, setPhone] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation();

  const handleCheck = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setResult(null);
    try {
      const q = query(
        collection(db, 'rentals'),
        where('carPlate', '==', plate.toUpperCase()),
        where('customerPhone', '==', phone),
        where('status', '==', 'active'),
        limit(1)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        const rental = snap.docs[0].data();
        const ownerSnap = await getDoc(doc(db, 'users', rental.ownerUid));
        setResult({ ...rental, owner: ownerSnap.data() });
      } else {
        alert("Nessun noleggio attivo trovato con questi dati.");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  if (result) {
    return (
      <div className="bg-white p-8 rounded-3xl shadow-2xl border border-blue-100 max-w-md mx-auto">
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 bg-blue-600 text-white rounded-full flex items-center justify-center shadow-lg">
            <Car size={32} />
          </div>
          <div>
            <h3 className="text-xl font-bold text-gray-900">{result.carModel}</h3>
            <p className="text-blue-600 font-bold tracking-widest">{result.carPlate}</p>
          </div>
        </div>
        <div className="space-y-4 mb-8">
          <div className="flex justify-between items-center p-3 bg-gray-50 rounded-xl">
            <span className="text-gray-500 text-sm">Noleggio</span>
            <span className="font-bold text-gray-900">{result.owner?.rentName}</span>
          </div>
          <div className="flex justify-between items-center p-3 bg-gray-50 rounded-xl">
            <span className="text-gray-500 text-sm">Scadenza</span>
            <span className="font-bold text-gray-900">{new Date(result.endDate).toLocaleDateString()}</span>
          </div>
        </div>
        <Link 
          to={`/demo/${result.owner?.airport}?rent=${encodeURIComponent(result.owner?.rentName)}&wa=${result.owner?.whatsapp}&uid=${result.ownerUid}`}
          className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
        >
          Accedi alla tua Guida <ArrowRight size={20} />
        </Link>
        <button onClick={() => setResult(null)} className="w-full mt-4 text-gray-400 text-sm hover:underline">Indietro</button>
      </div>
    );
  }

  return (
    <div className="bg-white p-8 rounded-3xl shadow-xl border border-gray-100 max-w-md mx-auto">
      <h3 className="text-xl font-bold mb-6 text-center">Controlla il tuo Noleggio</h3>
      <form onSubmit={handleCheck} className="space-y-4">
        <div>
          <label className="block text-xs font-bold text-gray-400 mb-1 uppercase">Targa Auto</label>
          <input 
            type="text" 
            required
            className="w-full px-4 py-3 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-blue-500"
            value={plate}
            onChange={e => setPlate(e.target.value.toUpperCase())}
            placeholder="es: AB123CD"
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-gray-400 mb-1 uppercase">Cellulare (usato nel contratto)</label>
          <input 
            type="tel" 
            required
            className="w-full px-4 py-3 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-blue-500"
            value={phone}
            onChange={e => setPhone(e.target.value)}
            placeholder="es: 3471234567"
          />
        </div>
        <button 
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 flex items-center justify-center gap-2"
        >
          {loading ? 'Verifica in corso...' : 'Verifica Noleggio'} <Check size={20} />
        </button>
      </form>
    </div>
  );
};

const LandingPage = () => {
  const { t } = useTranslation();
  const { user, openAuthModal } = useAuth();
  const [formData, setFormData] = useState({ name: '', whatsapp: '', email: '', location: '' });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    alert(t('form.success'));
    setFormData({ name: '', whatsapp: '', email: '', location: '' });
  };

  return (
    <div className="pt-16 bg-white">
      {/* Hero Section */}
      <section className="relative py-20 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 relative z-10">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <motion.div 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              className="text-left"
            >
              <h1 className="text-4xl md:text-6xl font-extrabold text-gray-900 leading-tight mb-6">
                {t('hero.title')}
              </h1>
              <p className="text-xl text-gray-600 mb-10 leading-relaxed">
                {t('hero.subtitle')}
              </p>
              <div className="flex flex-col sm:flex-row items-center gap-4">
                {user ? (
                  <Link 
                    to="/dashboard"
                    className="w-full sm:w-auto bg-blue-600 text-white px-8 py-4 rounded-full text-lg font-bold hover:bg-blue-700 transition-all shadow-xl shadow-blue-200 flex items-center justify-center gap-2"
                  >
                    Vai alla tua Dashboard <ArrowRight size={20} />
                  </Link>
                ) : (
                  <button 
                    onClick={() => openAuthModal()}
                    className="w-full sm:w-auto bg-blue-600 text-white px-8 py-4 rounded-full text-lg font-bold hover:bg-blue-700 transition-all shadow-xl shadow-blue-200 flex items-center justify-center gap-2"
                  >
                    {t('hero.cta')} <ArrowRight size={20} />
                  </button>
                )}
              </div>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              className="relative"
            >
              <CustomerCheckIn />
            </motion.div>
          </div>
        </div>
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-full -z-0 opacity-5 pointer-events-none">
          <div className="absolute top-10 left-10 w-64 h-64 bg-blue-600 rounded-full blur-3xl"></div>
          <div className="absolute bottom-10 right-10 w-96 h-96 bg-green-400 rounded-full blur-3xl"></div>
        </div>
      </section>

      {/* Problem Section */}
      <section id="problemi" className="py-20 bg-gray-50">
        <div className="max-w-7xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-12">{t('problems.title')}</h2>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { title: t('problems.p1.title'), desc: t('problems.p1.desc') },
              { title: t('problems.p2.title'), desc: t('problems.p2.desc') },
              { title: t('problems.p3.title'), desc: t('problems.p3.desc') },
              { title: t('problems.p4.title'), desc: t('problems.p4.desc') }
            ].map((item, i) => (
              <motion.div 
                key={i}
                whileHover={{ y: -5 }}
                className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100"
              >
                <div className="w-12 h-12 bg-red-100 text-red-600 rounded-xl flex items-center justify-center mb-4">
                  <AlertTriangle size={24} />
                </div>
                <h3 className="font-bold text-lg mb-2">{item.title}</h3>
                <p className="text-gray-600 text-sm">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="come-funziona" className="py-20">
        <div className="max-w-7xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-16">{t('howItWorks.title')}</h2>
          <div className="flex flex-col md:flex-row items-center justify-between gap-12">
            {[
              { step: "01", title: t('howItWorks.s1.title'), desc: t('howItWorks.s1.desc') },
              { step: "02", title: t('howItWorks.s2.title'), desc: t('howItWorks.s2.desc') },
              { step: "03", title: t('howItWorks.s3.title'), desc: t('howItWorks.s3.desc') }
            ].map((item, i) => (
              <div key={i} className="flex-1 text-center relative">
                <div className="text-6xl font-black text-blue-50 opacity-10 absolute -top-10 left-1/2 -translate-x-1/2 z-0">
                  {item.step}
                </div>
                <div className="relative z-10">
                  <h3 className="text-xl font-bold mb-4">{item.title}</h3>
                  <p className="text-gray-600">{item.desc}</p>
                </div>
                {i < 2 && <div className="hidden lg:block absolute top-1/2 -right-6 text-gray-300"><ArrowRight /></div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section id="vantaggi" className="py-20 bg-blue-600 text-white">
        <div className="max-w-7xl mx-auto px-4">
          <h2 className="text-3xl font-bold text-center mb-12">{t('benefits.title')}</h2>
          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            {[
              t('benefits.b1'),
              t('benefits.b2'),
              t('benefits.b3'),
              t('benefits.b4')
            ].map((benefit, i) => (
              <div key={i} className="flex items-center gap-4 bg-white/10 p-6 rounded-2xl backdrop-blur-sm">
                <CheckCircle2 className="text-green-400 shrink-0" />
                <span className="font-semibold text-lg">{benefit}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Form Section */}
      <section className="py-20">
        <div className="max-w-3xl mx-auto px-4">
          <div className="bg-white rounded-3xl shadow-2xl border border-gray-100 p-8 md:p-12">
            <h2 className="text-3xl font-bold mb-2 text-center">{t('form.title')}</h2>
            <p className="text-gray-500 text-center mb-8 text-sm">
              Compila il modulo per generare istantaneamente la tua area demo personalizzata con QR Code, 
              mappe ZTL e chat multilingue.
            </p>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('form.rentName')}</label>
                  <input 
                    required
                    type="text" 
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    value={formData.name}
                    onChange={e => setFormData({...formData, name: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('form.whatsapp')}</label>
                  <input 
                    required
                    type="tel" 
                    className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                    value={formData.whatsapp}
                    onChange={e => setFormData({...formData, whatsapp: e.target.value})}
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('form.email')}</label>
                <input 
                  required
                  type="email" 
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  value={formData.email}
                  onChange={e => setFormData({...formData, email: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">{t('form.location')}</label>
                <input 
                  required
                  type="text" 
                  className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  value={formData.location}
                  onChange={e => setFormData({...formData, location: e.target.value})}
                />
              </div>
              <button 
                type="submit"
                className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-blue-700 transition-all shadow-lg shadow-blue-200"
              >
                {t('form.submit')}
              </button>
            </form>
          </div>
        </div>
      </section>

      <footer className="py-10 border-t border-gray-100 text-center text-gray-500 text-sm">
        <p>© 2026 Rental Companion. {t('footer.rights') || 'Tutti i diritti riservati.'}</p>
        <p className="mt-2 text-xs opacity-50">// REPLACE: tuodominio.it with actual domain</p>
      </footer>
    </div>
  );
};

const DemoPage = () => {
  const { user } = useAuth();
  const { t } = useTranslation();
  const { airport } = useParams();
  const [searchParams] = useSearchParams();
  const rentName = searchParams.get('rent') || 'Rental';
  const waNumber = searchParams.get('wa') || '393001234567';
  const rentalUid = searchParams.get('uid') || 'demo-uid';
  
  const [rentalProfile, setRentalProfile] = useState<any>(null);
  const [activeRentals, setActiveRentals] = useState<any[]>([]);
  const [selectedRental, setSelectedRental] = useState<any>(null);
  const [loadingRentals, setLoadingRentals] = useState(false);

  useEffect(() => {
    if (rentalUid && rentalUid !== 'demo-uid') {
      const fetchProfile = async () => {
        const docSnap = await getDoc(doc(db, 'users', rentalUid));
        if (docSnap.exists()) {
          setRentalProfile(docSnap.data());
        }
      };
      fetchProfile();
    }
  }, [rentalUid]);

  const [customerPhone, setCustomerPhone] = useState(() => localStorage.getItem('rental_customer_phone') || '');
  const [sessionId, setSessionId] = useState(() => {
    const saved = localStorage.getItem('rental_session_id');
    if (saved) return saved;
    return ''; // Wait for phone
  });

  useEffect(() => {
    if (rentalUid && customerPhone) {
      setLoadingRentals(true);
      const q = query(
        collection(db, 'rentals'),
        where('rentalUid', '==', rentalUid),
        where('customerPhone', '==', customerPhone),
        where('status', '==', 'active')
      );

      const unsubscribe = onSnapshot(q, (snapshot) => {
        const rs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setActiveRentals(rs);
        if (rs.length === 1) {
          setSelectedRental(rs[0]);
        } else if (rs.length === 0) {
          setSelectedRental(null);
        }
        setLoadingRentals(false);
      });
      return () => unsubscribe();
    }
  }, [rentalUid, customerPhone]);

  const handleStartChat = (phone: string) => {
    const cleanPhone = phone.trim().replace(/\D/g, '');
    if (cleanPhone.length < 8) {
      alert("Inserisci un numero di telefono valido.");
      return;
    }
    setCustomerPhone(cleanPhone);
    setSessionId(cleanPhone);
    localStorage.setItem('rental_customer_phone', cleanPhone);
    localStorage.setItem('rental_session_id', cleanPhone);
  };

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [photos, setPhotos] = useState({
    front: false,
    back: false,
    sides: false,
    interior: false,
    fuel: false
  });

  const handleConfirmPhotos = () => {
    const allDone = Object.values(photos).every(v => v);
    if (allDone) {
      alert("Foto confermate! Grazie per la collaborazione.");
    } else {
      alert("Fai tutte le foto prima!");
    }
  };

  const waLink = `https://wa.me/${waNumber}?text=${encodeURIComponent('Ciao, sono un vostro cliente e ho bisogno di assistenza...')}`;

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Hero */}
      <div className="bg-blue-600 text-white px-4 py-12 text-center rounded-b-[40px] shadow-xl">
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
          {user?.uid === rentalUid && (
            <Link 
              to="/dashboard" 
              className="inline-flex items-center gap-2 bg-white/20 hover:bg-white/30 text-white px-4 py-2 rounded-full text-xs font-bold mb-6 transition-all backdrop-blur-sm border border-white/10"
            >
              <LayoutDashboard size={14} /> Torna alla Dashboard
            </Link>
          )}
          <h1 className="text-3xl font-bold mb-2">Benvenuto in {rentalProfile?.rentName || rentName}</h1>
          <p className="text-blue-100 uppercase tracking-widest text-sm font-bold">{airport?.toUpperCase()} AIRPORT</p>
        </motion.div>
      </div>

      <div className="max-w-md mx-auto px-4 -mt-6 space-y-6">
        {!customerPhone ? (
          <section className="bg-white rounded-3xl p-8 shadow-xl border border-gray-100 text-center">
            <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <User size={32} />
            </div>
            <h2 className="text-2xl font-bold mb-4">Identificati</h2>
            <p className="text-gray-500 mb-8 text-sm">Inserisci il numero di telefono usato per il noleggio per accedere alla tua guida personalizzata.</p>
            <div className="space-y-4">
              <input 
                type="tel" 
                placeholder="Il tuo numero di telefono"
                className="w-full px-6 py-4 rounded-2xl bg-gray-50 border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 text-lg text-center"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleStartChat((e.target as HTMLInputElement).value);
                  }
                  e.stopPropagation();
                }}
              />
              <button 
                onClick={(e) => {
                  const input = (e.currentTarget.previousSibling as HTMLInputElement);
                  handleStartChat(input.value);
                }}
                className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold text-lg hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
              >
                Accedi
              </button>
            </div>
          </section>
        ) : loadingRentals ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : activeRentals.length > 0 && !selectedRental ? (
          <section className="bg-white rounded-3xl p-6 shadow-xl border border-gray-100">
            <h2 className="text-xl font-bold mb-6 text-center">{t('demo.selectRental')}</h2>
            <div className="space-y-4">
              {activeRentals.map(r => (
                <button 
                  key={r.id}
                  onClick={() => setSelectedRental(r)}
                  className="w-full p-4 rounded-2xl border border-gray-100 hover:border-blue-500 hover:bg-blue-50 transition-all text-left flex items-center justify-between group"
                >
                  <div>
                    <p className="text-xs font-bold text-blue-600 uppercase mb-1">{r.carPlate}</p>
                    <p className="font-bold text-gray-800">{r.carModel}</p>
                  </div>
                  <ArrowRight size={20} className="text-gray-300 group-hover:text-blue-600 transition-colors" />
                </button>
              ))}
            </div>
          </section>
        ) : activeRentals.length === 0 ? (
          <section className="bg-white rounded-3xl p-8 shadow-xl border border-gray-100 text-center">
            <div className="w-16 h-16 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertTriangle size={32} />
            </div>
            <h2 className="text-xl font-bold mb-2">{t('demo.noRentals')}</h2>
            <p className="text-gray-500 mb-8 text-sm">Non abbiamo trovato noleggi attivi per il numero <strong>{customerPhone}</strong>.</p>
            <button 
              onClick={() => {
                setCustomerPhone('');
                localStorage.removeItem('rental_customer_phone');
              }}
              className="text-blue-600 font-bold hover:underline"
            >
              Prova con un altro numero
            </button>
          </section>
        ) : (
          <>
            {/* Rental Info Header */}
            <div className="bg-white rounded-3xl p-4 shadow-sm border border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center">
                  <Car size={20} />
                </div>
                <div>
                  <p className="text-[10px] font-bold text-blue-600 uppercase leading-none mb-1">{selectedRental.carPlate}</p>
                  <p className="text-sm font-bold text-gray-800 leading-none">{selectedRental.carModel}</p>
                </div>
              </div>
              {activeRentals.length > 1 && (
                <button 
                  onClick={() => setSelectedRental(null)}
                  className="text-[10px] font-bold text-gray-400 hover:text-blue-600 uppercase"
                >
                  Cambia Auto
                </button>
              )}
            </div>

            {/* Section 1: Position */}
            <section className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center">
                  <MapPin size={20} />
                </div>
                <h2 className="text-xl font-bold">{t('demo.office')}</h2>
              </div>
              <div className="aspect-video bg-gray-200 rounded-2xl mb-4 overflow-hidden relative">
                <img 
                  src={rentalProfile?.officePhoto || `https://picsum.photos/seed/${airport}/600/400`} 
                  alt="Mappa" 
                  className="w-full h-full object-cover opacity-80"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
                  <div className="bg-white/90 backdrop-blur px-4 py-2 rounded-full text-sm font-bold shadow-lg text-gray-800">
                    {t('demo.followSigns')}
                  </div>
                  {rentalProfile?.officeLocation && (
                    <a 
                      href={rentalProfile.officeLocation}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="bg-blue-600 text-white px-6 py-2 rounded-full text-sm font-bold shadow-xl flex items-center gap-2 hover:bg-blue-700 transition-all"
                    >
                      <MapPin size={16} /> Apri in Google Maps
                    </a>
                  )}
                </div>
              </div>
              <p className="text-gray-600 text-sm">
                {t('demo.officeDesc', { rent: rentalProfile?.rentName || rentName })}
              </p>
            </section>

            {/* Section 2: Photos */}
            <section className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center">
                  <Camera size={20} />
                </div>
                <h2 className="text-xl font-bold">{t('demo.photos')}</h2>
              </div>
              <p className="text-gray-500 text-xs mb-4">{t('demo.photosDesc')}</p>
              <div className="space-y-3 mb-6">
                {[
                  { id: 'front', label: t('demo.photo1') },
                  { id: 'back', label: t('demo.photo2') },
                  { id: 'sides', label: t('demo.photo3') },
                  { id: 'interior', label: t('demo.photo4') },
                  { id: 'fuel', label: t('demo.photo5') }
                ].map((item) => (
                  <label key={item.id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:bg-gray-50 cursor-pointer transition-all">
                    <input 
                      type="checkbox" 
                      className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      checked={photos[item.id as keyof typeof photos]}
                      onChange={() => setPhotos({...photos, [item.id]: !photos[item.id as keyof typeof photos]})}
                    />
                    <span className={`text-sm ${photos[item.id as keyof typeof photos] ? 'text-gray-400 line-through' : 'text-gray-700 font-medium'}`}>
                      {item.label}
                    </span>
                  </label>
                ))}
              </div>
              <button 
                onClick={handleConfirmPhotos}
                className="w-full bg-gray-900 text-white py-4 rounded-2xl font-bold hover:bg-black transition-all shadow-lg"
              >
                {t('demo.confirmPhotos')}
              </button>
            </section>

            {/* Section 3: WhatsApp */}
            <section className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-green-100 text-green-600 rounded-full flex items-center justify-center">
                  <MessageCircle size={20} />
                </div>
                <h2 className="text-xl font-bold">{t('demo.help')}</h2>
              </div>
              <p className="text-gray-600 text-sm mb-6">{t('demo.helpDesc')}</p>
              <a 
                href={waLink}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full bg-[#25D366] text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-3 hover:opacity-90 transition-all shadow-lg shadow-green-100"
              >
                <MessageCircle size={24} />
                {t('demo.waBtn')}
              </a>
            </section>

            {/* Section 4: Info */}
            <section className="grid grid-cols-2 gap-4">
              <div className="bg-red-50 p-4 rounded-3xl border border-red-100">
                <div className="flex items-center gap-2 mb-2 text-red-600">
                  <AlertTriangle size={18} />
                  <span className="font-bold text-sm">ZTL & Regole Locali</span>
                </div>
                <p className="text-[10px] text-red-800 leading-tight mb-3">
                  {rentalProfile?.ztlInfo || t('demo.ztl', { airport: airport })}
                </p>
                <a 
                  href={`https://www.google.com/maps/search/?api=1&query=ZTL+${airport}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[10px] font-bold text-red-600 hover:underline"
                >
                  <MapIcon size={12} /> Vedi su Google Maps
                </a>
              </div>
              <div className="bg-blue-50 p-4 rounded-3xl border border-blue-100">
                <div className="flex items-center gap-2 mb-2 text-blue-600">
                  <Fuel size={18} />
                  <span className="font-bold text-sm">{t('demo.fuelTitle') || 'Rifornimento'}</span>
                </div>
                <p className="text-[10px] text-blue-800 leading-tight">
                  {t('demo.fuel')}
                </p>
              </div>
            </section>

            {rentalProfile?.pois && rentalProfile.pois.length > 0 && (
              <section className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center">
                      <MapPin size={20} />
                    </div>
                    <h2 className="text-xl font-bold">Suggerimenti Locali</h2>
                  </div>
                  <a 
                    href={`https://www.google.com/maps/search/?api=1&query=Attrazioni+turistiche+${airport}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] font-bold text-purple-600 flex items-center gap-1 hover:underline"
                  >
                    <ExternalLink size={12} /> Google Maps
                  </a>
                </div>
                <div className="space-y-4">
                  {rentalProfile.pois.map((poi: any, idx: number) => (
                    <a 
                      key={idx}
                      href={poi.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block p-4 rounded-2xl border border-gray-50 hover:bg-purple-50 transition-all group"
                    >
                      <p className="font-bold text-gray-800 group-hover:text-purple-600 transition-colors">{poi.name}</p>
                      <p className="text-xs text-gray-500 mt-1">{poi.description}</p>
                    </a>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* Floating Chat Button */}
      <div className="fixed bottom-24 right-6 z-50 flex flex-col items-end gap-4">
        <AnimatePresence>
          {isChatOpen && (
            <motion.div 
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
              className="mb-2"
            >
              {sessionId ? (
                <Chat rentalUid={rentalUid} sessionId={sessionId} sender="customer" />
              ) : (
                <div className="bg-white p-6 rounded-3xl shadow-2xl border border-gray-100 w-80">
                  <h3 className="font-bold mb-4">Identificati per chattare</h3>
                  <p className="text-xs text-gray-500 mb-4">Inserisci il numero di telefono usato per il noleggio per collegarti all'assistenza.</p>
                  <input 
                    type="tel" 
                    placeholder="Il tuo numero di telefono"
                    className="w-full px-4 py-3 rounded-2xl bg-gray-50 border border-gray-100 outline-none focus:ring-2 focus:ring-blue-500 mb-4"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleStartChat((e.target as HTMLInputElement).value);
                      }
                      e.stopPropagation();
                    }}
                  />
                  <button 
                    onClick={(e) => {
                      const input = (e.currentTarget.previousSibling as HTMLInputElement);
                      handleStartChat(input.value);
                    }}
                    className="w-full bg-blue-600 text-white py-3 rounded-2xl font-bold hover:bg-blue-700 transition-all"
                  >
                    Inizia Chat
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        <button 
          onClick={() => setIsChatOpen(!isChatOpen)}
          className="w-16 h-16 bg-blue-600 text-white rounded-full shadow-2xl flex items-center justify-center hover:scale-110 transition-all border-4 border-white"
        >
          {isChatOpen ? <X size={28} /> : <MessageCircle size={28} />}
        </button>
      </div>

      {/* Bottom Nav Placeholder */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 px-6 py-4 flex justify-around items-center md:hidden">
        <Link to="/" className="text-gray-400 hover:text-blue-600 transition-colors"><Check size={24} /></Link>
        <div className="w-12 h-12 bg-blue-600 rounded-full -mt-10 border-4 border-gray-50 flex items-center justify-center text-white shadow-lg">
          <MessageCircle size={24} />
        </div>
        <button className="text-gray-400 hover:text-blue-600 transition-colors"><MapPin size={24} /></button>
      </div>
    </div>
  );
};

const Dashboard = () => {
  const { user, profile, loading } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  
  const [activeTab, setActiveTab] = useState<'config' | 'fleet' | 'rentals' | 'chats'>('config');
  const [cars, setCars] = useState<any[]>([]);
  const [rentals, setRentals] = useState<any[]>([]);
  const [isAddingCar, setIsAddingCar] = useState(false);
  const [isAddingRental, setIsAddingRental] = useState(false);
  const [newCar, setNewCar] = useState({ plate: '', model: '' });
  const [newRental, setNewRental] = useState({ carId: '', customerName: '', customerPhone: '', endDate: '' });
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  console.log("Dashboard: Rendering...", { user: user?.email, profile: !!profile, loading });

  useEffect(() => {
    if (!loading && !user) {
      console.log("Dashboard: No user, redirecting to home");
      navigate('/');
    }
  }, [user, loading, navigate]);

  // Fetch Cars
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'cars'), where('rentalUid', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedCars = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      console.log("Dashboard: Cars fetched", fetchedCars.length);
      setCars(fetchedCars);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'cars');
    });
    return () => unsubscribe();
  }, [user]);

  // Fetch Rentals
  useEffect(() => {
    if (!user) return;
    // Removed orderBy('endDate', 'asc') to avoid missing index error
    const q = query(collection(db, 'rentals'), where('rentalUid', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedRentals = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Sort in memory instead to avoid index requirement
      const sortedRentals = fetchedRentals.sort((a: any, b: any) => 
        new Date(a.endDate).getTime() - new Date(b.endDate).getTime()
      );
      console.log("Dashboard: Rentals fetched", sortedRentals.length);
      setRentals(sortedRentals);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'rentals');
    });
    return () => unsubscribe();
  }, [user]);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-white">
        <div className="animate-spin text-blue-600"><Languages size={48} /></div>
      </div>
    );
  }

  if (!user) return null;

  const [config, setConfig] = useState({
    rentName: '',
    whatsapp: '',
    airport: 'pisa',
    officeLocation: '',
    officePhoto: '',
    latitude: 0,
    longitude: 0,
    ztlInfo: '',
    pois: [] as { name: string, description: string, url: string }[]
  });
  const [isUploading, setIsUploading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [activeChats, setActiveChats] = useState<any[]>([]);
  const [selectedChat, setSelectedChat] = useState<string | null>(null);

  // Derived Chat List (FIFO)
  const chatList = React.useMemo(() => {
    const list = rentals.map(r => ({
      sessionId: r.customerPhone,
      customerName: r.customerName,
      carPlate: r.carPlate,
      carModel: r.carModel,
      rentalUid: r.rentalUid,
      lastMessage: '',
      timestamp: r.createdAt,
      isRental: true,
      status: r.status
    }));

    activeChats.forEach(ac => {
      const existing = list.find(l => l.sessionId === ac.sessionId);
      if (existing) {
        existing.lastMessage = ac.lastMessage;
        if (ac.timestamp) existing.timestamp = ac.timestamp;
      } else {
        list.push({
          sessionId: ac.sessionId,
          customerName: 'Cliente Sconosciuto',
          carPlate: 'N/A',
          carModel: 'N/A',
          rentalUid: ac.rentalUid,
          lastMessage: ac.lastMessage,
          timestamp: ac.timestamp,
          isRental: false,
          status: 'unknown'
        });
      }
    });

    // FIFO Sort (Oldest first)
    return list.sort((a, b) => {
      const timeA = a.timestamp?.toMillis?.() || a.timestamp?.seconds * 1000 || 0;
      const timeB = b.timestamp?.toMillis?.() || b.timestamp?.seconds * 1000 || 0;
      return timeA - timeB;
    });
  }, [rentals, activeChats]);

  useEffect(() => {
    if (profile) {
      setConfig({
        rentName: (profile as any).rentName || '',
        whatsapp: (profile as any).whatsapp || '',
        airport: (profile as any).airport || 'pisa',
        officeLocation: (profile as any).officeLocation || '',
        officePhoto: (profile as any).officePhoto || '',
        latitude: (profile as any).latitude || 0,
        longitude: (profile as any).longitude || 0,
        ztlInfo: (profile as any).ztlInfo || '',
        pois: (profile as any).pois || []
      });
    }
  }, [profile]);

  const generateCityInfo = async () => {
    if (!config.airport) return;
    
    // Instead of AI generation, we provide Google Maps search links
    const airportName = config.airport.charAt(0).toUpperCase() + config.airport.slice(1);
    const ztlSearchUrl = `https://www.google.com/maps/search/?api=1&query=ZTL+${airportName}+Car+Rental+Rules`;
    const poiSearchUrl = `https://www.google.com/maps/search/?api=1&query=Attrazioni+turistiche+vicino+a+${airportName}`;
    
    setConfig(prev => ({
      ...prev,
      ztlInfo: `Per informazioni aggiornate sulla ZTL e le regole di circolazione a ${airportName}, consulta Google Maps: ${ztlSearchUrl}`,
      pois: [
        { name: "Attrazioni principali", description: "Scopri i luoghi più visitati su Google Maps", url: poiSearchUrl },
        { name: "Ristoranti consigliati", description: "Trova i migliori posti dove mangiare", url: `https://www.google.com/maps/search/?api=1&query=Ristoranti+vicino+a+${airportName}` }
      ]
    }));
    
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 2000);
  };

  useEffect(() => {
    if (!user) return;
    // Query for both user's chats and demo chats for testing
    const q = query(
      collection(db, 'chats'),
      where('rentalUid', 'in', [user.uid, 'demo-uid'])
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const sessions = new Map();
      // Sort in memory
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any[];
      docs.sort((a, b) => (b.timestamp?.toMillis() || 0) - (a.timestamp?.toMillis() || 0));

      docs.forEach(data => {
        if (!sessions.has(data.sessionId)) {
          sessions.set(data.sessionId, {
            sessionId: data.sessionId,
            rentalUid: data.rentalUid,
            lastMessage: data.originalText,
            timestamp: data.timestamp
          });
        }
      });
      setActiveChats(Array.from(sessions.values()));
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'chats');
    });

    return () => unsubscribe();
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      // Salva solo i campi necessari per la configurazione del noleggio
      const { rentName, whatsapp, airport, officeLocation, officePhoto, latitude, longitude, ztlInfo, pois } = config;
      await setDoc(doc(db, 'users', user.uid), {
        rentName,
        whatsapp,
        airport,
        officeLocation,
        officePhoto,
        latitude,
        longitude,
        ztlInfo,
        pois
      }, { merge: true });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error("Errore salvataggio:", err);
      handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`);
    } finally {
      setIsSaving(false);
    }
  };

  const [deleteConfirm, setDeleteConfirm] = useState<{
    type: 'car' | 'rental' | 'chat';
    id: string;
    extraId?: string;
    label: string;
  } | null>(null);

  const handleDeleteCar = async (carId: string) => {
    setError(null);
    try {
      console.log("Dashboard: Eliminazione auto...", carId);
      await deleteDoc(doc(db, 'cars', carId));
      console.log("Dashboard: Auto eliminata");
      setDeleteConfirm(null);
    } catch (err: any) {
      console.error("Errore eliminazione auto:", err);
      handleFirestoreError(err, OperationType.DELETE, `cars/${carId}`);
    }
  };

  const handleDeleteRental = async (rentalId: string, carId: string) => {
    setError(null);
    try {
      console.log("Dashboard: Eliminazione noleggio...", rentalId);
      await deleteDoc(doc(db, 'rentals', rentalId));
      if (carId) {
        console.log("Dashboard: Ripristino stato auto...", carId);
        await updateDoc(doc(db, 'cars', carId), { status: 'available' });
      }
      console.log("Dashboard: Noleggio eliminato");
      setDeleteConfirm(null);
    } catch (err: any) {
      console.error("Errore eliminazione noleggio:", err);
      handleFirestoreError(err, OperationType.DELETE, `rentals/${rentalId}`);
    }
  };

  const handleDeleteChat = async (sessionId: string) => {
    if (!user) return;
    setError(null);
    try {
      console.log("Dashboard: Eliminazione chat...", sessionId);
      const q = query(
        collection(db, 'chats'), 
        where('sessionId', '==', sessionId),
        where('rentalUid', '==', user.uid)
      );
      const snapshot = await getDocs(q);
      if (snapshot.empty) {
        console.log("Dashboard: Nessun messaggio trovato per questa sessione");
        if (selectedChat === sessionId) setSelectedChat(null);
        setDeleteConfirm(null);
        return;
      }
      const batch = writeBatch(db);
      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      await batch.commit();
      console.log("Dashboard: Chat eliminata");
      if (selectedChat === sessionId) setSelectedChat(null);
      setDeleteConfirm(null);
    } catch (err: any) {
      console.error("Errore eliminazione chat:", err);
      handleFirestoreError(err, OperationType.DELETE, 'chats');
    }
  };

  const refreshData = async () => {
    if (!user) return;
    setIsSaving(true);
    setError(null);
    try {
      console.log("Dashboard: Manual refresh started...");
      const carsQ = query(collection(db, 'cars'), where('rentalUid', '==', user.uid));
      const carsSnap = await getDocs(carsQ);
      setCars(carsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));

      const rentalsQ = query(collection(db, 'rentals'), where('rentalUid', '==', user.uid));
      const rentalsSnap = await getDocs(rentalsQ);
      const fetchedRentals = rentalsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setRentals(fetchedRentals.sort((a: any, b: any) => 
        new Date(a.endDate).getTime() - new Date(b.endDate).getTime()
      ));
      
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
      console.log("Dashboard: Manual refresh completed");
    } catch (err: any) {
      console.error("Errore refresh dati:", err);
      setError(`Errore nel caricamento dati: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportChat = async (sessionId: string) => {
    if (!user) return;
    setError(null);
    try {
      console.log("Dashboard: Esportazione chat...", sessionId);
      const q = query(
        collection(db, 'chats'), 
        where('sessionId', '==', sessionId),
        where('rentalUid', '==', user.uid)
      );
      const snapshot = await getDocs(q);
      const messages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as any[];
      // Sort in memory
      messages.sort((a: any, b: any) => (a.timestamp?.toMillis() || 0) - (b.timestamp?.toMillis() || 0));
      
      const exportData = {
        sessionId,
        rentalUid: user.uid,
        exportedAt: new Date().toISOString(),
        messages: messages.map(m => ({
          sender: m.sender,
          originalText: m.originalText,
          translatedText: m.translatedText,
          originalLang: m.originalLang,
          timestamp: m.timestamp?.toDate ? m.timestamp.toDate().toISOString() : new Date().toISOString()
        }))
      };

      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", `chat_export_${sessionId}.json`);
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
      console.log("Dashboard: Chat esportata con successo");
    } catch (err: any) {
      console.error("Errore esportazione chat:", err);
      setError(`Errore nell'esportazione chat: ${err.message}`);
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = event.target?.result as string;
      
      // Extract EXIF
      EXIF.getData(file as any, function(this: any) {
        const lat = EXIF.getTag(this, "GPSLatitude");
        const lon = EXIF.getTag(this, "GPSLongitude");
        const latRef = EXIF.getTag(this, "GPSLatitudeRef") || "N";
        const lonRef = EXIF.getTag(this, "GPSLongitudeRef") || "E";

        if (lat && lon) {
          const latitude = (lat[0] + lat[1] / 60 + lat[2] / 3600) * (latRef === "S" ? -1 : 1);
          const longitude = (lon[0] + lon[1] / 60 + lon[2] / 3600) * (lonRef === "W" ? -1 : 1);
          
          setConfig(prev => ({
            ...prev,
            officePhoto: base64,
            latitude,
            longitude,
            officeLocation: `https://www.google.com/maps?q=${latitude},${longitude}`
          }));
          alert("Foto caricata! Coordinate GPS estratte con successo.");
        } else {
          setConfig(prev => ({ ...prev, officePhoto: base64 }));
          alert("Foto caricata, ma non sono stati trovati dati GPS. Inserisci la posizione manualmente.");
        }
        setIsUploading(false);
      });
    };
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      if (config.officeLocation && config.officeLocation.length > 3 && !config.officeLocation.startsWith('http')) {
        handleSearchLocation(config.officeLocation);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [config.officeLocation]);

  const handleSearchLocation = async (queryText: string) => {
    if (!queryText.trim()) return;
    setIsSearching(true);
    try {
      // Using a simple fetch to a public API for demo purposes
      // In a real app, you'd use Google Places Autocomplete
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(queryText)}`);
      const data = await response.json();
      setSuggestions(data.slice(0, 5));
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  };

  const selectSuggestion = (s: any) => {
    setConfig(prev => ({
      ...prev,
      officeLocation: `https://www.google.com/maps?q=${s.lat},${s.lon}`,
      latitude: parseFloat(s.lat),
      longitude: parseFloat(s.lon)
    }));
    setSuggestions([]);
  };

  const handleAddCar = async () => {
    if (!user || !newCar.plate || !newCar.model) {
      console.warn("handleAddCar: Dati mancanti", { user: !!user, plate: !!newCar.plate, model: !!newCar.model });
      setError("Inserisci targa e modello dell'auto.");
      return;
    }
    setIsSaving(true);
    setError(null);
    console.log("handleAddCar: Salvataggio auto...", { plate: newCar.plate, model: newCar.model, rentalUid: user.uid });
    try {
      const carData = {
        plate: newCar.plate.toUpperCase().trim(),
        model: newCar.model.trim(),
        rentalUid: user.uid,
        status: 'available',
        createdAt: serverTimestamp()
      };
      const docRef = await addDoc(collection(db, 'cars'), carData);
      console.log("handleAddCar: Auto salvata con successo, ID:", docRef.id);
      setNewCar({ plate: '', model: '' });
      setIsAddingCar(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err: any) {
      console.error("Errore aggiunta auto:", err);
      setError(`Errore nel salvataggio auto: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddRental = async () => {
    if (!user || !newRental.carId || !newRental.customerName || !newRental.customerPhone || !newRental.endDate) {
      console.warn("handleAddRental: Dati mancanti", { 
        carId: !!newRental.carId, 
        customer: !!newRental.customerName,
        phone: !!newRental.customerPhone,
        date: !!newRental.endDate
      });
      setError("Compila tutti i campi per creare il noleggio.");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const car = cars.find(c => c.id === newRental.carId);
      if (!car) {
        throw new Error("Auto non trovata nella flotta locale.");
      }

      const rentalData = {
        rentalUid: user.uid,
        carId: newRental.carId,
        carPlate: car.plate,
        carModel: car.model,
        customerName: newRental.customerName.trim(),
        customerPhone: newRental.customerPhone.trim().replace(/\D/g, ''),
        endDate: newRental.endDate,
        status: 'active',
        createdAt: serverTimestamp()
      };

      console.log("handleAddRental: Salvataggio noleggio...", rentalData);
      const docRef = await addDoc(collection(db, 'rentals'), rentalData);
      console.log("handleAddRental: Noleggio salvato, ID:", docRef.id);
      
      // Update car status
      console.log("handleAddRental: Aggiornamento stato auto...");
      await updateDoc(doc(db, 'cars', newRental.carId), { status: 'rented' });
      
      setNewRental({ carId: '', customerName: '', customerPhone: '', endDate: '' });
      setIsAddingRental(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err: any) {
      console.error("Errore aggiunta noleggio:", err);
      setError(`Errore nella creazione noleggio: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCompleteRental = async (rentalId: string, carId: string) => {
    try {
      await updateDoc(doc(db, 'rentals', rentalId), { status: 'completed' });
      await updateDoc(doc(db, 'cars', carId), { status: 'available' });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `rentals/${rentalId}`);
    }
  };

  const demoUrl = `${window.location.origin}/demo/${config.airport}?rent=${encodeURIComponent(config.rentName)}&wa=${config.whatsapp}&uid=${user.uid}`;

  if (!user) return <div className="pt-32 text-center">Accedi per visualizzare la dashboard.</div>;

  return (
    <div className="pt-24 pb-20 bg-gray-50 min-h-screen">
      <div className="max-w-7xl mx-auto px-4">
        <header className="mb-10">
          <h1 className="text-3xl font-bold text-gray-900">Bentornato, {profile?.firstName}! 👋</h1>
          <p className="text-gray-600">Gestisci qui il tuo Rental Companion e monitora l'utilità per il tuo business.</p>
        </header>

        <div className="grid lg:grid-cols-4 gap-8">
          {/* Sidebar Navigation */}
          <div className="lg:col-span-1 space-y-2">
            <button 
              onClick={() => setActiveTab('config')}
              className={`w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold transition-all ${activeTab === 'config' ? 'bg-blue-600 text-white shadow-lg shadow-blue-100' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              <Settings size={20} /> Configurazione
            </button>
            <button 
              onClick={() => setActiveTab('fleet')}
              className={`w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold transition-all ${activeTab === 'fleet' ? 'bg-blue-600 text-white shadow-lg shadow-blue-100' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              <Car size={20} /> Gestione Flotta
            </button>
            <button 
              onClick={() => setActiveTab('rentals')}
              className={`w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold transition-all ${activeTab === 'rentals' ? 'bg-blue-600 text-white shadow-lg shadow-blue-100' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              <ClipboardList size={20} /> Noleggi Attivi
            </button>
            <button 
              onClick={() => setActiveTab('chats')}
              className={`w-full flex items-center gap-3 px-6 py-4 rounded-2xl font-bold transition-all ${activeTab === 'chats' ? 'bg-blue-600 text-white shadow-lg shadow-blue-100' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              <MessageCircle size={20} /> Chat Clienti
              {activeChats.length > 0 && <span className="ml-auto bg-red-500 text-white text-[10px] px-2 py-0.5 rounded-full">{activeChats.length}</span>}
            </button>
          </div>

          <div className="lg:col-span-3 space-y-8">
            {error && (
              <div className="bg-red-50 border border-red-100 text-red-600 p-4 rounded-2xl flex items-center gap-3 animate-pulse">
                <AlertTriangle size={20} />
                <p className="text-sm font-bold">{error}</p>
                <button onClick={() => setError(null)} className="ml-auto p-1 hover:bg-red-100 rounded-full">
                  <X size={16} />
                </button>
              </div>
            )}

            <AnimatePresence>
              {deleteConfirm && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/50 backdrop-blur-sm">
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="bg-white p-8 rounded-3xl shadow-2xl max-w-sm w-full text-center"
                  >
                    <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-6">
                      <Trash2 size={32} />
                    </div>
                    <h3 className="text-xl font-bold mb-2">Conferma Eliminazione</h3>
                    <p className="text-gray-500 text-sm mb-8">
                      Sei sicuro di voler eliminare definitivamente <strong>{deleteConfirm.label}</strong>? Questa azione non può essere annullata.
                    </p>
                    <div className="flex gap-3">
                      <button 
                        onClick={() => setDeleteConfirm(null)}
                        className="flex-1 px-4 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-gray-200 transition-all"
                      >
                        Annulla
                      </button>
                      <button 
                        onClick={() => {
                          if (deleteConfirm.type === 'car') handleDeleteCar(deleteConfirm.id);
                          if (deleteConfirm.type === 'rental') handleDeleteRental(deleteConfirm.id, deleteConfirm.extraId || '');
                          if (deleteConfirm.type === 'chat') handleDeleteChat(deleteConfirm.id);
                        }}
                        className="flex-1 px-4 py-3 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all"
                      >
                        Elimina
                      </button>
                    </div>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
            {activeTab === 'config' && (
              <>
                <section className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
                  <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                    <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center"><User size={18} /></div>
                    Configurazione del tuo Rental
                  </h2>
                  <div className="grid md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Nome del Noleggio (es: Maggiore)</label>
                      <input 
                        type="text" 
                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                        value={config.rentName}
                        onChange={e => setConfig({...config, rentName: e.target.value})}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">WhatsApp Assistenza (es: 39347...)</label>
                      <input 
                        type="tel" 
                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                        value={config.whatsapp}
                        onChange={e => setConfig({...config, whatsapp: e.target.value})}
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Aeroporto di Riferimento</label>
                      <select 
                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                        value={config.airport}
                        onChange={e => setConfig({...config, airport: e.target.value})}
                      >
                        <option value="pisa">Pisa (PSA)</option>
                        <option value="roma">Roma Fiumicino (FCO)</option>
                        <option value="milano">Milano Malpensa (MXP)</option>
                        <option value="napoli">Napoli (NAP)</option>
                        <option value="catania">Catania (CTA)</option>
                      </select>
                    </div>
                    <div className="md:col-span-2 relative">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Cerca Posizione Ufficio</label>
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          className="flex-1 px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                          value={config.officeLocation}
                          onChange={e => setConfig({...config, officeLocation: e.target.value})}
                          placeholder="Cerca indirizzo o incolla link Maps"
                        />
                        {isSearching && <div className="absolute right-4 top-10 animate-spin text-blue-600"><Languages size={20} /></div>}
                      </div>
                      {suggestions.length > 0 && (
                        <div className="absolute z-50 left-0 right-0 mt-2 bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden">
                          {suggestions.map((s, i) => (
                            <button 
                              key={i}
                              onClick={() => selectSuggestion(s)}
                              className="w-full text-left px-4 py-3 hover:bg-blue-50 transition-all border-b border-gray-50 last:border-none text-sm"
                            >
                              <div className="font-bold">{s.display_name.split(',')[0]}</div>
                              <div className="text-[10px] text-gray-400 truncate">{s.display_name}</div>
                            </button>
                          ))}
                        </div>
                      )}
                      <p className="text-[10px] text-gray-400 mt-1 italic">Cerca l'indirizzo o usa il caricamento foto con GPS sotto.</p>
                    </div>
                    <div className="md:col-span-2">
                      <div className="flex items-center justify-between mb-2">
                        <label className="block text-sm font-medium text-gray-700">Informazioni ZTL e Traffico</label>
                        <button 
                          onClick={generateCityInfo}
                          className="text-[10px] bg-blue-100 text-blue-600 px-2 py-1 rounded-lg font-bold hover:bg-blue-200 transition-all flex items-center gap-1"
                        >
                          <Search size={10} /> Genera Link Google Maps
                        </button>
                      </div>
                      <textarea 
                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none h-24 text-sm"
                        value={config.ztlInfo}
                        onChange={e => setConfig({...config, ztlInfo: e.target.value})}
                        placeholder="Inserisci info su zone a traffico limitato, parcheggi consigliati, etc."
                      />
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Punti di Interesse Suggeriti</label>
                      <div className="space-y-3">
                        {config.pois.map((poi, idx) => (
                          <div key={idx} className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex items-start gap-3">
                            <div className="flex-1">
                              <input 
                                type="text"
                                className="w-full bg-transparent font-bold text-sm outline-none mb-1"
                                value={poi.name}
                                onChange={e => {
                                  const newPois = [...config.pois];
                                  newPois[idx].name = e.target.value;
                                  setConfig({...config, pois: newPois});
                                }}
                                placeholder="Nome Luogo"
                              />
                              <textarea 
                                className="w-full bg-transparent text-xs text-gray-500 outline-none h-12"
                                value={poi.description}
                                onChange={e => {
                                  const newPois = [...config.pois];
                                  newPois[idx].description = e.target.value;
                                  setConfig({...config, pois: newPois});
                                }}
                                placeholder="Breve descrizione per il turista"
                              />
                            </div>
                            <button 
                              onClick={() => {
                                const newPois = config.pois.filter((_, i) => i !== idx);
                                setConfig({...config, pois: newPois});
                              }}
                              className="p-1 text-gray-300 hover:text-red-500 transition-colors"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                        <button 
                          onClick={() => setConfig({...config, pois: [...config.pois, { name: '', description: '', url: '' }]})}
                          className="w-full py-3 border-2 border-dashed border-gray-200 rounded-2xl text-xs font-bold text-gray-400 hover:border-blue-500 hover:text-blue-600 transition-all"
                        >
                          + Aggiungi Punto di Interesse
                        </button>
                      </div>
                    </div>

                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">URL Foto Ufficio (o carica sotto)</label>
                      <input 
                        type="text" 
                        className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:ring-2 focus:ring-blue-500 outline-none"
                        value={config.officePhoto}
                        onChange={e => setConfig({...config, officePhoto: e.target.value})}
                        placeholder="Incolla qui l'URL di un'immagine o usa il caricamento"
                      />
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-2">Carica Foto con GPS</label>
                      <div className="flex items-center gap-4">
                        <label className="flex-1 flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-2xl p-6 hover:border-blue-500 hover:bg-blue-50 transition-all cursor-pointer group">
                          <Camera className="text-gray-400 group-hover:text-blue-600 mb-2" size={32} />
                          <span className="text-sm font-bold text-gray-500 group-hover:text-blue-600">
                            {isUploading ? 'Analisi in corso...' : 'Seleziona Foto Ufficio'}
                          </span>
                          <input type="file" className="hidden" accept="image/*" onChange={handlePhotoUpload} />
                        </label>
                        {config.officePhoto && (
                          <div className="w-24 h-24 rounded-2xl overflow-hidden border border-gray-100 shadow-sm">
                            <img src={config.officePhoto} alt="Preview" className="w-full h-full object-cover" />
                          </div>
                        )}
                      </div>
                      <p className="text-[10px] text-gray-400 mt-2 italic">
                        Caricando una foto scattata in ufficio, l'app estrarrà automaticamente le coordinate GPS per il cliente.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-4 mt-8">
                    <button 
                      onClick={handleSave}
                      disabled={isSaving}
                      className={`flex-1 px-8 py-3 rounded-xl font-bold transition-all disabled:opacity-50 flex items-center justify-center gap-2 ${saveSuccess ? 'bg-green-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                    >
                      {isSaving ? 'Salvataggio...' : saveSuccess ? <><Check size={20} /> Salvato!</> : 'Salva Configurazione'}
                    </button>
                    <button 
                      onClick={() => setConfig({
                        rentName: 'Sicily on Wheels',
                        whatsapp: '393331234567',
                        airport: 'catania',
                        officeLocation: '',
                        officePhoto: '',
                        latitude: 0,
                        longitude: 0
                      })}
                      className="px-8 py-3 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-gray-200 transition-all"
                    >
                      Simula con Dati Esempio
                    </button>
                  </div>
                </section>

                {/* QR Code Section */}
                <section className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
                  <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                    <div className="w-8 h-8 bg-purple-100 text-purple-600 rounded-lg flex items-center justify-center"><Camera size={18} /></div>
                    Il tuo QR Code Personalizzato
                  </h2>
                  <div className="flex flex-col md:flex-row items-center gap-10">
                    <div className="bg-white p-4 border-4 border-gray-50 rounded-2xl shadow-inner">
                      <QRCodeSVG value={demoUrl} size={180} />
                    </div>
                    <div className="flex-1 space-y-4">
                      <p className="text-gray-600 text-sm">
                        Stampa questo QR Code e inseriscilo nel **contratto di noleggio** o sul **portachiavi**. 
                        Il cliente lo scansionerà e avrà tutte le info senza chiamarti.
                      </p>
                      <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 break-all text-xs font-mono text-blue-600">
                        {demoUrl}
                      </div>
                      <div className="flex gap-3">
                        <button 
                          onClick={() => window.open(demoUrl, '_blank')}
                          className="flex-1 bg-blue-600 text-white px-6 py-3 rounded-xl text-sm font-bold hover:bg-blue-700 transition-all flex items-center justify-center gap-2"
                        >
                          <ExternalLink size={16} /> Apri Demo
                        </button>
                        <button 
                          onClick={() => {
                            navigator.clipboard.writeText(demoUrl);
                            setSaveSuccess(true);
                            setTimeout(() => setSaveSuccess(false), 2000);
                          }}
                          className="flex-1 bg-gray-100 text-gray-600 px-6 py-3 rounded-xl text-sm font-bold hover:bg-gray-200 transition-all flex items-center justify-center gap-2"
                        >
                          <Copy size={16} /> {saveSuccess ? 'Copiato!' : 'Copia Link'}
                        </button>
                      </div>
                    </div>
                  </div>
                </section>
              </>
            )}

            {activeTab === 'fleet' && (
              <section className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center"><Car size={18} /></div>
                    Gestione Flotta
                  </h2>
                  <div className="flex gap-2">
                    <button 
                      onClick={refreshData}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                      title="Aggiorna dati"
                    >
                      <Languages size={18} className={isSaving ? 'animate-spin' : ''} />
                    </button>
                    <button 
                      onClick={() => setIsAddingCar(!isAddingCar)}
                      className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-blue-700 transition-all"
                    >
                      {isAddingCar ? 'Annulla' : '+ Aggiungi Auto'}
                    </button>
                  </div>
                </div>

                {isAddingCar && (
                  <div className="bg-gray-50 p-6 rounded-2xl mb-8 border border-gray-100 grid md:grid-cols-3 gap-4 items-end">
                    <div>
                      <label className="block text-xs font-bold text-gray-400 mb-1 uppercase">Targa</label>
                      <input 
                        type="text" 
                        className="w-full px-4 py-2 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-blue-500"
                        value={newCar.plate}
                        onChange={e => setNewCar({...newCar, plate: e.target.value.toUpperCase()})}
                        placeholder="es: AB123CD"
                        maxLength={15}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 mb-1 uppercase">Modello</label>
                      <input 
                        type="text" 
                        className="w-full px-4 py-2 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-blue-500"
                        value={newCar.model}
                        onChange={e => setNewCar({...newCar, model: e.target.value})}
                        placeholder="es: Fiat 500 Hybrid"
                        maxLength={50}
                      />
                    </div>
                    <button 
                      onClick={handleAddCar}
                      disabled={isSaving}
                      className={`bg-blue-600 text-white py-2 rounded-xl font-bold hover:bg-blue-700 transition-all flex items-center justify-center gap-2 ${isSaving ? 'opacity-70 cursor-not-allowed' : ''}`}
                    >
                      {isSaving ? (
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      ) : saveSuccess ? (
                        <Check size={18} />
                      ) : null}
                      {isSaving ? 'Salvataggio...' : saveSuccess ? 'Salvato!' : 'Salva Auto'}
                    </button>
                  </div>
                )}

                <div className="grid sm:grid-cols-2 gap-4">
                  {cars.length === 0 && <p className="text-gray-400 text-sm col-span-2 text-center py-10">Nessuna auto in flotta. Aggiungine una!</p>}
                  {cars.map(car => (
                    <div key={car.id} className="p-4 rounded-2xl border border-gray-100 flex items-center justify-between hover:border-blue-200 transition-all group">
                      <div>
                        <p className="text-xs font-bold text-blue-600 mb-0.5">{car.plate}</p>
                        <p className="font-bold text-gray-800">{car.model}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase ${car.status === 'available' ? 'bg-green-100 text-green-600' : 'bg-orange-100 text-orange-600'}`}>
                          {car.status === 'available' ? 'Disponibile' : 'Noleggiata'}
                        </div>
                        <button 
                          onClick={() => setDeleteConfirm({
                            type: 'car',
                            id: car.id,
                            label: `l'auto ${car.plate} (${car.model})`
                          })}
                          className="p-2 text-gray-300 hover:text-red-600 transition-colors"
                          title="Elimina auto"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {activeTab === 'rentals' && (
              <section className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center"><Users size={18} /></div>
                    Noleggi Attivi
                  </h2>
                  <div className="flex gap-2">
                    <button 
                      onClick={refreshData}
                      className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                      title="Aggiorna dati"
                    >
                      <Languages size={18} className={isSaving ? 'animate-spin' : ''} />
                    </button>
                    <button 
                      onClick={() => setIsAddingRental(!isAddingRental)}
                      className="bg-blue-600 text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-blue-700 transition-all"
                    >
                      {isAddingRental ? 'Annulla' : '+ Nuovo Noleggio'}
                    </button>
                  </div>
                </div>

                {isAddingRental && (
                  <div className="bg-gray-50 p-6 rounded-2xl mb-8 border border-gray-100 grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-400 mb-1 uppercase">Seleziona Auto (Targa)</label>
                      <select 
                        className="w-full px-4 py-2 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-blue-500"
                        value={newRental.carId}
                        onChange={e => setNewRental({...newRental, carId: e.target.value})}
                      >
                        <option value="">Seleziona...</option>
                        {cars.filter(c => c.status === 'available').map(c => (
                          <option key={c.id} value={c.id}>{c.plate} - {c.model}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 mb-1 uppercase">Nome Cliente</label>
                      <input 
                        type="text" 
                        className="w-full px-4 py-2 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-blue-500"
                        value={newRental.customerName}
                        onChange={e => setNewRental({...newRental, customerName: e.target.value})}
                        placeholder="es: Mario Rossi"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 mb-1 uppercase">Cellulare Cliente</label>
                      <input 
                        type="tel" 
                        className="w-full px-4 py-2 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-blue-500"
                        value={newRental.customerPhone}
                        onChange={e => setNewRental({...newRental, customerPhone: e.target.value})}
                        placeholder="es: 3471234567"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 mb-1 uppercase">Data Fine Noleggio</label>
                      <input 
                        type="datetime-local" 
                        className="w-full px-4 py-2 rounded-xl border border-gray-200 outline-none focus:ring-2 focus:ring-blue-500"
                        value={newRental.endDate}
                        onChange={e => setNewRental({...newRental, endDate: e.target.value})}
                      />
                    </div>
                    <button 
                      onClick={handleAddRental}
                      disabled={isSaving}
                      className={`md:col-span-2 bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 transition-all flex items-center justify-center gap-2 ${isSaving ? 'opacity-70 cursor-not-allowed' : ''}`}
                    >
                      {isSaving ? (
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      ) : saveSuccess ? (
                        <Check size={18} />
                      ) : null}
                      {isSaving ? 'Creazione...' : saveSuccess ? 'Creato!' : 'Crea Noleggio'}
                    </button>
                  </div>
                )}

                <div className="space-y-4">
                  {rentals.length === 0 && <p className="text-gray-400 text-sm text-center py-10">Nessun noleggio attivo.</p>}
                  {rentals.map(rental => (
                    <div key={rental.id} className="p-6 rounded-2xl border border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-blue-200 transition-all group">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center">
                          <User size={24} />
                        </div>
                        <div>
                          <p className="font-bold text-gray-900">{rental.customerName}</p>
                          <p className="text-xs text-gray-400">{rental.customerPhone}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <p className="text-xs font-bold text-blue-600">{rental.carPlate}</p>
                          <p className="text-[10px] text-gray-400 uppercase">Scade: {new Date(rental.endDate).toLocaleDateString()}</p>
                        </div>
                        <div className="px-3 py-1 bg-green-100 text-green-600 rounded-full text-[10px] font-bold uppercase">
                          {rental.status}
                        </div>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => {
                              setActiveTab('chats');
                              const cleanPhone = rental.customerPhone.replace(/\D/g, '');
                              setSelectedChat(cleanPhone);
                              // Scroll to chat section
                              setTimeout(() => {
                                const chatEl = document.getElementById('chat-section');
                                if (chatEl) {
                                  chatEl.scrollIntoView({ behavior: 'smooth' });
                                } else {
                                  window.scrollTo({ top: 0, behavior: 'smooth' });
                                }
                              }, 100);
                            }}
                            className="px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 flex items-center gap-2"
                          >
                            <MessageCircle size={14} /> Verifica Noleggio
                          </button>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirm({
                                type: 'rental',
                                id: rental.id,
                                extraId: rental.carId,
                                label: `il noleggio di ${rental.customerName}`
                              });
                            }}
                            className="p-2 bg-red-50 text-red-400 hover:text-red-600 rounded-xl transition-all border border-red-100"
                            title="Elimina noleggio"
                          >
                            <X size={18} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {activeTab === 'chats' && (
              <section id="chat-section" className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-lg flex items-center justify-center"><MessageCircle size={18} /></div>
                    Chat Live con i Clienti
                  </h2>
                  <div className="bg-blue-50 px-4 py-2 rounded-xl text-[10px] text-blue-600 font-bold flex items-center gap-2">
                    <CheckCircle2 size={14} />
                    <span>Lista ordinata FIFO (dal più vecchio al più recente)</span>
                  </div>
                </div>
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2">
                    {chatList.length === 0 ? (
                      <p className="text-gray-400 text-sm py-10 text-center">Nessun noleggio o chat attiva.</p>
                    ) : (
                      chatList.map(chat => (
                        <div 
                          key={chat.sessionId}
                          onClick={() => setSelectedChat(selectedChat === chat.sessionId ? null : chat.sessionId)}
                          className={`w-full text-left p-4 rounded-2xl border transition-all relative group cursor-pointer ${selectedChat === chat.sessionId ? 'border-blue-600 bg-blue-50' : 'border-gray-100 hover:bg-gray-50'}`}
                        >
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex flex-col">
                              <div className="flex items-center gap-2 mb-1">
                                <p className="font-bold text-sm text-gray-900">{chat.customerName}</p>
                                {chat.rentalUid === 'demo-uid' && <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-600 font-bold uppercase">Demo</span>}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded uppercase">{chat.carPlate}</span>
                                <span className="text-[10px] text-gray-400">{chat.carModel}</span>
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="text-[9px] text-gray-400">{chat.timestamp?.toDate ? chat.timestamp.toDate().toLocaleString() : ''}</p>
                              <p className="text-[9px] font-bold text-gray-300 mt-1">{chat.sessionId}</p>
                            </div>
                          </div>
                          
                          <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-50">
                            <p className="text-xs text-gray-500 truncate italic flex-1">
                              {chat.lastMessage || 'Nessun messaggio ancora'}
                            </p>
                            <div className="flex gap-1 ml-2">
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleExportChat(chat.sessionId);
                                }}
                                className="p-1.5 text-gray-400 hover:text-blue-600 transition-colors"
                                title="Esporta"
                              >
                                <Download size={14} />
                              </button>
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteConfirm({
                                    type: 'chat',
                                    id: chat.sessionId,
                                    label: `la chat di ${chat.customerName}`
                                  });
                                }}
                                className="p-1.5 text-gray-400 hover:text-red-600 transition-colors"
                                title="Elimina"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>

                          {selectedChat === chat.sessionId && (
                            <motion.div 
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              className="mt-4 pt-4 border-t border-blue-100 md:hidden"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <Chat rentalUid={user.uid} sessionId={chat.sessionId} sender="rental" showCustomerCard={true} />
                            </motion.div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                  <div className="hidden md:block h-[600px] border border-gray-100 rounded-3xl overflow-hidden sticky top-24">
                    {selectedChat ? (
                      <Chat rentalUid={user.uid} sessionId={selectedChat} sender="rental" showCustomerCard={true} />
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-gray-400 p-10 text-center">
                        <MessageCircle size={48} className="mb-4 opacity-20" />
                        <p className="text-sm font-medium">Seleziona un cliente o un'auto dalla lista per iniziare a chattare.</p>
                        <p className="text-[10px] mt-2 opacity-60">La lista include tutti i noleggi attivi in ordine di arrivo.</p>
                      </div>
                    )}
                  </div>
                </div>
              </section>
            )}
          </div>

          <div className="lg:col-span-1 space-y-8">
            <section className="bg-gradient-to-br from-blue-600 to-blue-800 text-white p-8 rounded-3xl shadow-xl shadow-blue-100 relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-10">
                <TrendingUp size={120} />
              </div>
              <h2 className="text-xl font-bold mb-6 relative z-10">Impatto Operativo Stimato</h2>
              <div className="space-y-6 relative z-10">
                <div>
                  <p className="text-blue-100 text-xs mb-1 uppercase tracking-widest font-bold">Efficienza Desk</p>
                  <p className="text-4xl font-black">+65%</p>
                  <p className="text-[10px] text-blue-200 mt-1">Riduzione tempi di check-in manuale</p>
                </div>
                <div className="h-px bg-blue-500/50"></div>
                <div>
                  <p className="text-blue-100 text-xs mb-1 uppercase tracking-widest font-bold">Chiamate Assistenza</p>
                  <p className="text-4xl font-black">-40%</p>
                  <p className="text-[10px] text-blue-200 mt-1">Grazie alle FAQ e ZTL info automatiche</p>
                </div>
                <div className="h-px bg-blue-500/50"></div>
                <div>
                  <p className="text-blue-100 text-xs mb-1 uppercase tracking-widest font-bold">Customer Satisfaction</p>
                  <p className="text-4xl font-black">4.9<span className="text-lg font-normal">/5</span></p>
                  <p className="text-[10px] text-blue-200 mt-1">Media feedback post-noleggio digitale</p>
                </div>
              </div>
              <div className="mt-8 p-4 bg-white/10 rounded-2xl border border-white/10 backdrop-blur-sm">
                <p className="text-[10px] italic leading-relaxed">
                  "L'automazione delle informazioni ZTL e la chat multilingua riducono drasticamente l'attrito operativo, permettendo al tuo staff di concentrarsi sulla vendita di servizi extra."
                </p>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};
export default function App() {
  const { loading } = useAuth();

  console.log("App: Rendering...", { loading });

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen font-sans text-gray-900 selection:bg-blue-100">
      <Navbar />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/demo/:airport" element={<DemoPage />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </div>
  );
}

export function AppWrapper() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <App />
      </AuthProvider>
    </ErrorBoundary>
  );
}
