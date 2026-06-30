"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { Languages, LogIn, Mail, Lock, Loader2 } from "lucide-react";

export default function LoginPage() {
  const { user, userRole, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  // Redirect if already logged in
  useEffect(() => {
    if (!loading && user) {
      if (userRole === "ADMIN") {
        router.push("/admin/users");
      } else {
        router.push("/");
      }
    }
  }, [user, userRole, loading, router]);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSigningIn(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // AuthContext state update will trigger redirect
    } catch (err: any) {
      console.error("Login error:", err);
      if (err.code === "auth/invalid-credential" || err.code === "auth/user-not-found" || err.code === "auth/wrong-password") {
        setError("이메일 또는 비밀번호가 올바르지 않습니다. (에러 코드: " + err.code + ")");
      } else if (err.code === "auth/invalid-email") {
        setError("올바른 이메일 형식이 아닙니다. (에러 코드: " + err.code + ")");
      } else {
        setError("로그인 중 오류가 발생했습니다: " + (err.message || err.toString()) + " (에러 코드: " + err.code + ")");
      }
      setSigningIn(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError("");
    setSigningIn(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      // AuthContext state update will trigger redirect
    } catch (err: any) {
      console.error("Google login error:", err);
      setError("구글 로그인에 실패했습니다: " + (err.message || err.toString()) + " (에러 코드: " + err.code + ")");
      setSigningIn(false);
    }
  };

  if (loading || (user && userRole)) {
    return (
      <div className="min-h-screen bg-[#0f111a] flex flex-col items-center justify-center text-white">
        <Loader2 className="animate-spin text-blue-500 mb-4" size={40} />
        <p className="text-gray-400 font-medium">로그인 세션 확인 중...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0f111a] flex items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative background blur objects */}
      <div className="absolute top-1/4 left-1/4 w-80 h-80 bg-blue-500/10 rounded-full blur-[100px] pointer-events-none"></div>
      <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-purple-500/10 rounded-full blur-[100px] pointer-events-none"></div>

      <div className="max-w-md w-full bg-white/5 border border-white/10 backdrop-blur-xl rounded-2xl shadow-2xl p-8 z-10 transition-all duration-300">
        <div className="text-center mb-8">
          <div className="inline-flex p-3 bg-blue-500/10 rounded-2xl mb-4 border border-blue-500/20 shadow-[0_0_20px_rgba(59,130,246,0.15)]">
            <Languages className="text-blue-400" size={36} />
          </div>
          <h2 className="text-2xl font-extrabold text-white tracking-tight">UNICON Creator</h2>
          <p className="text-gray-400 text-sm mt-1.5">AI 기반 스마트 다국어 자막 편집 플랫폼</p>
        </div>

        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleEmailLogin} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-gray-300 uppercase tracking-wider mb-2">이메일</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg pl-10 pr-4 py-3 text-white placeholder-gray-500 text-sm focus:border-blue-500 focus:bg-white/10 outline-none transition-all duration-200"
                placeholder="email@unicon.com"
                required
                disabled={signingIn}
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-300 uppercase tracking-wider mb-2">비밀번호</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg pl-10 pr-4 py-3 text-white placeholder-gray-500 text-sm focus:border-blue-500 focus:bg-white/10 outline-none transition-all duration-200"
                placeholder="••••••••"
                required
                disabled={signingIn}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={signingIn}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 text-white py-3 rounded-lg font-bold text-base transition-colors flex items-center justify-center gap-2 mt-8 shadow-lg shadow-blue-600/10"
          >
            {signingIn ? (
              <Loader2 className="animate-spin" size={18} />
            ) : (
              <LogIn size={18} />
            )}
            로그인
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-white/10">
          <p className="text-center text-xs text-gray-500 mb-4 uppercase tracking-widest font-semibold">간편 로그인</p>
          <button
            onClick={handleGoogleLogin}
            disabled={signingIn}
            type="button"
            className="w-full flex justify-center items-center py-2.5 px-4 bg-white/5 border border-white/10 hover:bg-white/10 text-white rounded-lg transition-colors font-bold text-sm gap-2"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" className="mr-1">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            구글 계정으로 로그인
          </button>
        </div>
      </div>
    </div>
  );
}
