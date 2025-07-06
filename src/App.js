import React, { useState, useEffect, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, addDoc, runTransaction, setLogLevel } from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { Copy, Link, Check, XCircle, Loader2 } from 'lucide-react';

// --- Firebase Configuration (Production Ready) ---
// Reads configuration from environment variables (.env.local file for development).
const firebaseConfig = {
  apiKey: process.env.REACT_APP_API_KEY,
  authDomain: process.env.REACT_APP_AUTH_DOMAIN,
  projectId: process.env.REACT_APP_PROJECT_ID,
  storageBucket: process.env.REACT_APP_STORAGE_BUCKET,
  messagingSenderId: process.env.REACT_APP_MESSAGING_SENDER_ID,
  appId: process.env.REACT_APP_APP_ID
};

// --- Firebase Initialization (Best Practice) ---
// Initialize Firebase ONCE, outside of the component.
let app, db, auth;
try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    setLogLevel('error');
} catch (error) {
    console.error("Firebase initialization failed. Check your environment variables.", error);
}


// --- App ID ---
// Using the Project ID as a unique identifier for the database path.
const appId = process.env.REACT_APP_PROJECT_ID || 'local-dev-app';

// --- Main App Component ---
export default function App() {
    // --- State Management ---
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [page, setPage] = useState('create'); // 'create', 'redirecting', 'invalid'
    const [targetUrl, setTargetUrl] = useState('');
    const [generatedLink, setGeneratedLink] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [copySuccess, setCopySuccess] = useState(false);

    // --- Firebase Auth Initialization ---
    useEffect(() => {
        if (!auth) {
            setError("Firebase 服务初始化失败，请检查配置。");
            return;
        }

        const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                console.log("Auth state changed: User is signed in.", user.uid);
                setIsAuthReady(true);
            } else {
                console.log("Auth state changed: User is signed out.");
                setIsAuthReady(false);
            }
        });

        const signIn = async () => {
            if (auth.currentUser) {
                setIsAuthReady(true);
                return;
            }
            try {
                await signInAnonymously(auth);
            } catch (authError) {
                console.error("Sign-in failed:", authError);
                setError("身份验证失败，请检查 Firebase 配置和网络连接。");
            }
        };

        signIn();
        return () => unsubscribe(); // Cleanup on unmount
    }, []);

    // --- Link Consumption Logic ---
    const handleRedirect = useCallback(async (linkId) => {
        setPage('redirecting');
        const linkDocRef = doc(db, `artifacts/${appId}/public/data/onetime_links`, linkId);

        try {
            const urlToRedirect = await runTransaction(db, async (transaction) => {
                const linkDoc = await transaction.get(linkDocRef);
                if (!linkDoc.exists()) {
                    throw new Error("Link does not exist or has already been used.");
                }
                const data = linkDoc.data();
                transaction.delete(linkDocRef);
                return data.targetUrl;
            });

            window.top.location.href = urlToRedirect;

        } catch (e) {
            console.error("Redirect failed:", e.message);
            setPage('invalid');
        }
    }, []);

    // --- URL Routing ---
    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const linkId = urlParams.get('id');
        if (linkId && isAuthReady) {
            handleRedirect(linkId);
        }
    }, [isAuthReady, handleRedirect]);

    // --- Link Creation Logic ---
    const handleCreateLink = async (e) => {
        e.preventDefault();
        setError('');
        setGeneratedLink('');

        if (!targetUrl) {
            setError('请输入目标网址。');
            return;
        }

        let finalUrl = targetUrl.trim();
        if (!/^https?:\/\//i.test(finalUrl)) {
            finalUrl = 'https://' + finalUrl;
        }
        
        try {
            new URL(finalUrl);
        } catch (_) {
            setError('请输入一个有效的网址 (例如 www.google.com)。');
            return;
        }

        if (!isAuthReady) {
            setError('服务尚未准备就绪，请稍候。');
            return;
        }

        setIsLoading(true);

        try {
            const linksCollection = collection(db, `artifacts/${appId}/public/data/onetime_links`);
            const docRef = await addDoc(linksCollection, {
                targetUrl: finalUrl,
                createdAt: new Date(),
            });

            const currentUrl = new URL(window.location.href);
            currentUrl.search = `?id=${docRef.id}`;
            setGeneratedLink(currentUrl.href);
            setTargetUrl('');

        } catch (e) {
            console.error("Error creating link:", e);
            setError('创建链接失败，权限不足或网络错误。');
        } finally {
            setIsLoading(false);
        }
    };

    // --- Copy to Clipboard ---
    const handleCopy = () => {
        const textArea = document.createElement('textarea');
        textArea.value = generatedLink;
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand('copy');
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 2000);
        } catch (err) {
            console.error('Failed to copy: ', err);
            setError('复制失败，请手动复制。');
        }
        document.body.removeChild(textArea);
    };

    // --- Render Logic ---
    if (!auth) {
         return (
            <div className="flex items-center justify-center min-h-screen bg-red-50 font-sans p-4">
                <div className="w-full max-w-lg text-center text-red-700">
                    <h1 className="text-2xl font-bold">初始化失败</h1>
                    <p className="mt-2">无法加载 Firebase 配置。请检查您的 `.env.local` 文件是否正确配置。</p>
                </div>
            </div>
        );
    }

    if (page === 'redirecting') {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-slate-100 font-sans p-4">
                <div className="w-full max-w-md text-center">
                    <Loader2 className="h-12 w-12 text-blue-500 animate-spin mx-auto" />
                    <h1 className="text-2xl font-bold text-slate-700 mt-4">正在跳转...</h1>
                    <p className="text-slate-500 mt-2">请稍候，我们正在安全地将您重定向到目标页面。</p>
                </div>
            </div>
        );
    }

    if (page === 'invalid') {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen bg-slate-100 font-sans p-4">
                <div className="w-full max-w-md text-center bg-white p-8 rounded-xl shadow-lg">
                    <XCircle className="h-16 w-16 text-red-500 mx-auto" />
                    <h1 className="text-3xl font-bold text-slate-800 mt-4">链接无效</h1>
                    <p className="text-slate-600 mt-2">此链接可能已被使用或已过期。一次性链接只能访问一次。</p>
                    <button
                        onClick={() => window.location.href = window.location.pathname}
                        className="mt-6 w-full bg-blue-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-600 transition-colors duration-300 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-opacity-75"
                    >
                        创建新的链接
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-50 font-sans p-4">
            <div className="w-full max-w-lg mx-auto">
                <div className="bg-white rounded-2xl shadow-xl p-8">
                    <div className="flex items-center mb-6">
                        <Link className="h-8 w-8 text-blue-500" />
                        <h1 className="ml-3 text-2xl font-bold text-gray-800">一次性链接生成器</h1>
                    </div>
                    <p className="text-gray-600 mb-6">
                        创建一个安全的、只能访问一次的链接。访问后，链接将自动销毁。
                    </p>

                    <form onSubmit={handleCreateLink}>
                        <div className="mb-4">
                            <label htmlFor="url-input" className="block text-sm font-medium text-gray-700 mb-1">
                                目标网址
                            </label>
                            <input
                                id="url-input"
                                type="text"
                                value={targetUrl}
                                onChange={(e) => setTargetUrl(e.target.value)}
                                placeholder="www.google.com"
                                className="w-full px-4 py-2 text-gray-700 bg-gray-100 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition"
                                required
                            />
                        </div>

                        {error && <p className="text-red-500 text-sm mb-4">{error}</p>}

                        <button
                            type="submit"
                            disabled={isLoading || !isAuthReady}
                            className="w-full bg-blue-500 text-white font-bold py-3 px-4 rounded-lg hover:bg-blue-600 disabled:bg-blue-300 disabled:cursor-not-allowed flex items-center justify-center transition-all duration-300"
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="animate-spin h-5 w-5 mr-3" />
                                    正在生成...
                                </>
                            ) : (
                                '生成一次性链接'
                            )}
                        </button>
                         {!isAuthReady && <p className="text-xs text-center text-gray-500 mt-2">正在连接服务...</p>}
                    </form>

                    {generatedLink && (
                        <div className="mt-8 p-4 bg-blue-50 border-l-4 border-blue-400 rounded-r-lg">
                            <p className="text-sm font-medium text-blue-800">链接已生成:</p>
                            <div className="flex items-center mt-2">
                                <input
                                    type="text"
                                    value={generatedLink}
                                    readOnly
                                    className="w-full p-2 text-sm text-blue-900 bg-transparent focus:outline-none"
                                />
                                <button
                                    onClick={handleCopy}
                                    className={`p-2 rounded-md transition-colors ${copySuccess ? 'bg-green-500 text-white' : 'bg-blue-100 hover:bg-blue-200 text-blue-700'}`}
                                    aria-label="复制链接"
                                >
                                    {copySuccess ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
                <p className="text-center text-xs text-gray-400 mt-6">
                    App ID: {appId}
                </p>
            </div>
        </div>
    );
}
