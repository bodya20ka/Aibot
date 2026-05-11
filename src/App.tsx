/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { Send, Upload, BookOpen, MessageSquare } from 'lucide-react';
import { db, auth } from './firebase';
import { collection, addDoc, getDocs, query, orderBy, onSnapshot } from 'firebase/firestore';

export default function App() {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<{role: 'user' | 'assistant', content: string}[]>([]);
  const [activeTab, setActiveTab] = useState<'chat' | 'knowledge'>('chat');

  useEffect(() => {
    if (auth.currentUser) {
      const q = query(
        collection(db, 'users', auth.currentUser.uid, 'chat'),
        orderBy('createdAt')
      );
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const loadedMessages = snapshot.docs.map(doc => ({
          role: doc.data().role,
          content: doc.data().content
        }));
        setMessages(loadedMessages);
      });
      return () => unsubscribe();
    }
  }, []);

  const sendMessage = async () => {
    if (!input.trim() || !auth.currentUser) return;
    
    // Save user message to Firestore
    await addDoc(collection(db, 'users', auth.currentUser.uid, 'chat'), {
       role: 'user',
       content: input,
       createdAt: new Date().toISOString()
    });
    
    setInput('');

    // Fetch knowledge base (unchanged part)
    let knowledgeContext = "";
    if (auth.currentUser) {
        const querySnapshot = await getDocs(collection(db, 'users', auth.currentUser.uid, 'knowledge'));
        querySnapshot.forEach((doc) => {
            knowledgeContext += `\nDocument: ${doc.data().filename}\nContent:\n${doc.data().content}\n`;
        });
    }

    // Build context
    const messagesWithContext = [
        { role: 'system', content: "Use the following knowledge base if relevant: " + knowledgeContext },
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
            await addDoc(collection(db, 'users', auth.currentUser.uid, 'chat'), {
               role: 'assistant',
               content: data.choices[0].message.content,
               createdAt: new Date().toISOString()
            });
        } else if(data.error) {
            console.error(data.error);
        }
    } catch (e) {
        console.error(e);
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
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`px-4 py-2 rounded-2xl max-w-[80%] ${m.role === 'user' ? 'bg-black text-white' : 'bg-white shadow-sm'}`}>
                    {m.content}
                  </div>
                </div>
              ))}
            </div>

            <div className="sticky bottom-0 pt-2">
              <div className="flex bg-white rounded-full p-1 shadow-md border border-gray-100">
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
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <div className="w-20 h-20 bg-gray-100 rounded-3xl flex items-center justify-center text-gray-400">
              <Upload size={32} />
            </div>
            <h2 className="text-xl font-medium">Knowledge Base</h2>
            <p className="text-gray-500 max-w-sm">Upload files or documents for the AI to analyze and learn from. Currently supporting TXT and Markdown.</p>
            <input 
              type="file" 
              id="file-upload" 
              className="hidden" 
              accept=".txt,.md"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = async (e) => {
                        const content = e.target?.result as string;
                        if(auth.currentUser) {
                           try {
                             await addDoc(collection(db, 'users', auth.currentUser.uid, 'knowledge'), {
                               filename: file.name,
                               content: content,
                               createdAt: new Date().toISOString()
                             });
                             alert(`Successfully saved ${file.name}`);
                           } catch (err) {
                             console.error("Error saving to Firestore:", err);
                             alert("Failed to save to database.");
                           }
                        } else {
                            alert("Please sign in to upload files.");
                        }
                    };
                    reader.readAsText(file);
                }
              }}
            />
            <button 
              className="px-6 py-3 bg-black text-white rounded-full font-medium"
              onClick={() => document.getElementById('file-upload')?.click()}
            >
              Upload File
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
