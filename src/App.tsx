/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { Send, Upload, BookOpen, MessageSquare, LogIn, UserPlus, Copy, Database, Trash2 } from 'lucide-react';
import { db, auth } from './firebase';
import { collection, addDoc, getDocs, query, orderBy, onSnapshot } from 'firebase/firestore';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, User } from 'firebase/auth';
import * as pdfjsLib from 'pdfjs-dist';

// Set worker source for PDF parsing
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

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
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
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
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLogin, setIsLogin] = useState(true);

  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<{role: 'user' | 'assistant', content: string}[]>([]);
  const [activeTab, setActiveTab] = useState<'chat' | 'knowledge'>('chat');
  const [manualKnowledge, setManualKnowledge] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return onAuthStateChanged(auth, setUser);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  useEffect(() => {
    if (user) {
      const q = query(
        collection(db, 'users', user.uid, 'chat'),
        orderBy('createdAt')
      );
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const loadedMessages = snapshot.docs.map(doc => ({
          role: doc.data().role,
          content: doc.data().content
        }));
        setMessages(loadedMessages);
      }, (error) => handleFirestoreError(error, OperationType.LIST, 'chat'));
      return () => unsubscribe();
    } else {
      setMessages([]);
    }
  }, [user]);

  const handleAuth = async () => {
    try {
        if (isLogin) {
            await signInWithEmailAndPassword(auth, email, password);
        } else {
            await createUserWithEmailAndPassword(auth, email, password);
        }
    } catch (e) {
        alert(e instanceof Error ? e.message : 'Auth error');
    }
  };

  if (!user) {
      return (
        <div className="flex h-screen items-center justify-center bg-gray-50 p-4">
            <div className="w-full max-w-sm bg-white p-8 rounded-2xl shadow-sm border border-gray-100 flex flex-col gap-4">
                <h1 className="text-2xl font-bold text-center">{isLogin ? 'Sign In' : 'Sign Up'}</h1>
                <input className="px-4 py-3 rounded-xl border" type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
                <input className="px-4 py-3 rounded-xl border" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
                <button className="px-4 py-3 bg-black text-white rounded-xl font-medium" onClick={handleAuth}>{isLogin ? 'Sign In' : 'Sign Up'}</button>
                <button className="text-sm text-gray-500 underline text-center" onClick={() => setIsLogin(!isLogin)}>{isLogin ? 'Need an account? Sign up' : 'Have an account? Sign in'}</button>
            </div>
        </div>
      );
  }
  
  const sendMessage = async () => {
    if (!input.trim() || !user) return;
    
    setIsThinking(true);
    try {
        await addDoc(collection(db, 'users', user.uid, 'chat'), {
           role: 'user',
           content: input,
           createdAt: new Date().toISOString()
        });
    } catch (error) {
        handleFirestoreError(error, OperationType.CREATE, 'chat');
    }
    
    setInput('');

    // Fetch knowledge base (unchanged part)
    let knowledgeContext = "";
    if (user) {
        let querySnapshot;
        try {
            querySnapshot = await getDocs(collection(db, 'users', user.uid, 'knowledge'));
        } catch (error) {
            handleFirestoreError(error, OperationType.GET, 'knowledge');
        }
        if (querySnapshot) {
            querySnapshot.forEach((doc) => {
                knowledgeContext += `\nDocument: ${doc.data().filename}\nContent:\n${doc.data().content}\n`;
            });
        }
    }

    // Build context
    const messagesWithContext = [
        { role: 'system', content: "You have access to a long-term memory database managed in Firebase (Firestore, both chat history and uploaded documents). Use this information to maintain continuity and provide personalized answers based on previous interactions and documents. Use the following knowledge base if relevant: " + knowledgeContext + " | Context context: aiprogectkorzh1" },
        ...messages.map(m => ({ role: m.role, content: m.content })),
        { role: 'user', content: input }
    ];

    // Fetch from backend
    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: messagesWithContext })
        });
        const data = await res.json();
        
        if (data.choices && data.choices.length > 0) {
            // Save AI response to Firestore
            try {
                await addDoc(collection(db, 'users', user.uid, 'chat'), {
                   role: 'assistant',
                   content: data.choices[0].message.content,
                   createdAt: new Date().toISOString()
                });
            } catch (error) {
                handleFirestoreError(error, OperationType.CREATE, 'chat');
            }
        } else if(data.error) {
            console.error(data.error);
        }
    } catch (e) {
        console.error(e);
    } finally {
        setIsThinking(false);
    }
  };

  const saveToKnowledge = async (filename: string, content: string) => {
    if (!user) return;
    try {
        await addDoc(collection(db, 'users', user.uid, 'knowledge'), {
           filename: filename,
           content: content,
           createdAt: new Date().toISOString()
        });
        alert("Saved to knowledge base.");
    } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, 'knowledge');
    }
  };

  return (
    <div className="flex h-screen bg-gray-50 font-sans text-gray-900">
      <nav className="w-16 bg-white border-r flex flex-col items-center py-6 gap-6">
        <button onClick={() => setActiveTab('chat')} className={`p-3 rounded-xl ${activeTab === 'chat' ? 'bg-black text-white' : 'text-gray-400'}`}>
          <MessageSquare size={24} />
        </button>
        <button onClick={() => setActiveTab('knowledge')} className={`p-3 rounded-xl ${activeTab === 'knowledge' ? 'bg-black text-white' : 'text-gray-400'}`}>
          <BookOpen size={24} />
        </button>
      </nav>

      <main className="flex-1 flex flex-col p-4">
        {activeTab === 'chat' ? (
          <>
            <header className="py-2 text-center text-sm font-semibold text-gray-500 uppercase tracking-widest">
              Assistant
            </header>
            
            <div className="flex-1 overflow-y-auto space-y-4 py-4">
              {messages.map((m, i) => (
                <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'} gap-1`}>
                  <div className={`px-4 py-2 rounded-2xl max-w-[80%] ${m.role === 'user' ? 'bg-black text-white' : 'bg-white shadow-sm'}`}>
                    {m.content}
                  </div>
                  {m.role === 'assistant' && (
                    <div className="flex gap-2">
                        <button onClick={() => navigator.clipboard.writeText(m.content)} className="p-1 text-gray-400 hover:text-black">
                        <Copy size={16} />
                        </button>
                        <button onClick={() => saveToKnowledge("Saved from chat " + new Date().toLocaleString(), m.content)} className="p-1 text-gray-400 hover:text-black">
                        <Database size={16} />
                        </button>
                    </div>
                  )}
                </div>
              ))}
              {isThinking && (
                  <div className="flex justify-start">
                    <div className="px-4 py-2 rounded-2xl bg-white shadow-sm text-gray-400">
                        Thinking...
                    </div>
                  </div>
              )}
              <div ref={scrollRef} />
            </div>

            <div className="sticky bottom-0 pt-2 flex items-center gap-2">
              <button onClick={() => setMessages([])} className="p-3 text-gray-400 hover:text-black">
                <Trash2 size={20} />
              </button>
              <div className="flex bg-white rounded-full p-1 shadow-md border border-gray-100 flex-1">
                <input
                  className="flex-1 px-4 py-3 bg-transparent outline-none"
                  placeholder="Talk to your assistant..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                />
                <button onClick={sendMessage} className="p-3 bg-black text-white rounded-full">
                  <Send size={20} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center p-6 gap-6 text-center w-full max-w-2xl mx-auto">
            <h2 className="text-2xl font-medium">Knowledge Base Editor</h2>
            <textarea 
                className="w-full h-64 p-4 rounded-xl border border-gray-200 outline-none"
                placeholder="Paste text, scripts, or information here..."
                value={manualKnowledge}
                onChange={(e) => setManualKnowledge(e.target.value)}
            />
            <div className="flex gap-4">
                <button 
                  className="px-6 py-3 bg-black text-white rounded-full font-medium"
                  onClick={async () => {
                      if (!manualKnowledge.trim()) return;
                      await saveToKnowledge("Manual Entry " + new Date().toLocaleString(), manualKnowledge);
                      setManualKnowledge('');
                  }}
                >
                  Save Text
                </button>
                <div className="text-gray-400 py-3">or</div>
                <button 
                  className="px-6 py-3 bg-white border border-gray-200 rounded-full font-medium"
                  onClick={() => document.getElementById('file-upload')?.click()}
                >
                  Upload File
                </button>
            </div>
            <input 
              type="file" 
              id="file-upload" 
              className="hidden" 
              accept=".txt,.md,.pdf,.json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file || !user) return;
                
                const reader = new FileReader();
                reader.onload = async (e) => {
                    let content = '';
                    try {
                        if (file.type === 'application/pdf') {
                            const typedarray = new Uint8Array(e.target?.result as ArrayBuffer);
                            const pdf = await pdfjsLib.getDocument(typedarray).promise;
                            for (let i = 1; i <= pdf.numPages; i++) {
                                const page = await pdf.getPage(i);
                                const textContent = await page.getTextContent();
                                content += textContent.items.map((item: any) => item.str).join(' ');
                            }
                        } else if (file.type === 'application/json') {
                            content = JSON.stringify(JSON.parse(e.target?.result as string));
                        } else {
                            content = e.target?.result as string;
                        }
                        
                        await saveToKnowledge(file.name, content);
                    } catch (err) {
                        alert("Error processing file.");
                        console.error(err);
                    }
                };
                
                if (file.type === 'application/pdf') {
                    reader.readAsArrayBuffer(file);
                } else {
                    reader.readAsText(file);
                }
              }}
            />
          </div>
        )}
      </main>
    </div>
  );
}
