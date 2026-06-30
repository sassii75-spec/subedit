"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { db, firebaseConfig } from "@/lib/firebase";
import { collection, getDocs, doc, updateDoc, deleteDoc, setDoc, query, orderBy } from "firebase/firestore";
import { initializeApp, getApps, deleteApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword } from "firebase/auth";
import { ArrowLeft, UserPlus, Trash2, Edit2, Search, X, Shield, ShieldAlert, Check, Loader2 } from "lucide-react";
import Link from "next/link";

interface UserProfile {
  uid: string;
  email: string;
  name: string;
  role: string;
  createdAt: string;
}

export default function AdminUsersPage() {
  const { user, userRole, loading, logout } = useAuth();
  const router = useRouter();
  
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [fetching, setFetching] = useState(true);

  // User creation modal states
  const [isOpen, setIsOpen] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "USER" });

  // Edit User modal states
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [editForm, setEditForm] = useState({ name: "", role: "" });
  const [editLoading, setEditLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  // Guard routing: ADMIN only
  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.push("/login");
      } else if (userRole !== "ADMIN") {
        alert("관리자 권한이 필요합니다.");
        router.push("/");
      }
    }
  }, [user, userRole, loading, router]);

  const fetchUsers = async () => {
    setFetching(true);
    try {
      const q = query(collection(db, "subedit_users"), orderBy("createdAt", "desc"));
      const snapshot = await getDocs(q);
      const list: UserProfile[] = [];
      snapshot.forEach((docSnap) => {
        list.push(docSnap.data() as UserProfile);
      });
      setUsers(list);
    } catch (err) {
      console.error("Error fetching users:", err);
    } finally {
      setFetching(false);
    }
  };

  useEffect(() => {
    if (user && userRole === "ADMIN") {
      fetchUsers();
    }
  }, [user, userRole]);

  // Handle changing user role in Firestore
  const handleRoleChange = async (uid: string, newRole: string) => {
    if (uid === user?.uid) {
      alert("자신의 권한은 직접 수정할 수 없습니다.");
      return;
    }
    
    try {
      const userRef = doc(db, "subedit_users", uid);
      await updateDoc(userRef, { role: newRole });
      alert("권한이 성공적으로 수정되었습니다.");
      
      // Update local state
      setUsers(prev => prev.map(u => u.uid === uid ? { ...u, role: newRole } : u));
    } catch (err: any) {
      console.error("Error updating role:", err);
      alert("권한 수정에 실패했습니다: " + err.message);
    }
  };

  // Handle deleting Firestore record
  const handleDeleteUser = async (uid: string, email: string) => {
    if (uid === user?.uid) {
      alert("자기 자신은 삭제할 수 없습니다.");
      return;
    }

    if (!confirm(`정말로 ${email} 사용자의 DB 기록을 삭제하시겠습니까?\n(인증 정보는 유지되나 일반 권한 접근이 차단됩니다.)`)) {
      return;
    }

    try {
      await deleteDoc(doc(db, "subedit_users", uid));
      alert("성공적으로 삭제되었습니다.");
      setUsers(prev => prev.filter(u => u.uid !== uid));
    } catch (err: any) {
      console.error("Error deleting user:", err);
      alert("삭제 실패: " + err.message);
    }
  };

  const handleOpenEditModal = (u: UserProfile) => {
    setEditingUser(u);
    setEditForm({ name: u.name, role: u.role });
    setIsEditOpen(true);
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    
    setEditLoading(true);
    try {
      const userRef = doc(db, "subedit_users", editingUser.uid);
      await updateDoc(userRef, {
        name: editForm.name,
        role: editForm.role
      });
      
      alert("회원 정보가 성공적으로 수정되었습니다.");
      setIsEditOpen(false);
      fetchUsers(); // Refresh list
    } catch (err: any) {
      console.error("Error updating user details:", err);
      alert("회원 정보 수정 실패: " + err.message);
    } finally {
      setEditLoading(false);
    }
  };

  const handleSendResetEmail = async () => {
    if (!editingUser) return;
    
    if (!confirm(`${editingUser.email} 사용자의 비밀번호 초기화 메일을 발송하시겠습니까?`)) {
      return;
    }
    
    setResetLoading(true);
    try {
      const { sendPasswordResetEmail } = await import("firebase/auth");
      const { auth } = await import("@/lib/firebase");
      await sendPasswordResetEmail(auth, editingUser.email);
      alert("비밀번호 초기화 메일이 성공적으로 전송되었습니다.");
    } catch (err: any) {
      console.error("Error sending reset email:", err);
      alert("비밀번호 초기화 메일 전송 실패: " + err.message);
    } finally {
      setResetLoading(false);
    }
  };

  // Create new user using the Secondary App trick
  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email || !form.password) {
      return alert("이메일과 비밀번호는 필수 입력사항입니다.");
    }
    
    setCreateLoading(true);
    try {
      const appName = "SecondaryAdminRegisterApp";
      
      // Clean up previous app instance if it exists
      const existingApps = getApps();
      const matchedApp = existingApps.find(app => app.name === appName);
      if (matchedApp) {
        await deleteApp(matchedApp);
      }
      
      // Initialize secondary app for creating user without logging out the admin
      const secondaryApp = initializeApp(firebaseConfig, appName);
      const secondaryAuth = getAuth(secondaryApp);

      // Create new user in Firebase Auth
      const userCredential = await createUserWithEmailAndPassword(secondaryAuth, form.email, form.password);
      const newUid = userCredential.user.uid;

      // Register profile in primary Firestore database
      const userDocRef = doc(db, "subedit_users", newUid);
      await setDoc(userDocRef, {
        uid: newUid,
        email: form.email,
        name: form.name || form.email.split("@")[0],
        role: form.role,
        createdAt: new Date().toISOString()
      });

      // Cleanup
      await deleteApp(secondaryApp);

      alert(`계정이 발급되었습니다!\n아이디: ${form.email}\n권한: ${form.role}`);
      setIsOpen(false);
      setForm({ name: "", email: "", password: "", role: "USER" });
      
      // Refresh list
      fetchUsers();
    } catch (err: any) {
      console.error("User registration error:", err);
      let errMsg = err.message || "계정 생성 중 오류가 발생했습니다.";
      if (err.code === "auth/email-already-in-use") {
        errMsg = "이미 가입되어 있는 이메일 주소입니다.";
      } else if (err.code === "auth/weak-password") {
        errMsg = "비밀번호는 최소 6자 이상이어야 합니다.";
      }
      alert(errMsg);
    } finally {
      setCreateLoading(false);
    }
  };

  // Filter users based on query
  const filteredUsers = users.filter(u => 
    u.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    u.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading || !user || userRole !== "ADMIN") {
    return (
      <div className="min-h-screen bg-[#0f111a] flex flex-col items-center justify-center text-white">
        <Loader2 className="animate-spin text-blue-500 mb-4" size={40} />
        <p className="text-gray-400 font-medium">관리자 확인 중...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-gray-900">
      {/* Header */}
      <header className="px-6 py-4 bg-white border-b border-gray-200 flex items-center shadow-sm sticky top-0 z-10">
        <Link href="/" className="flex items-center text-gray-650 hover:text-gray-900 transition-colors mr-6">
          <ArrowLeft size={20} className="mr-2" />
          <span className="font-semibold">에디터로 돌아가기</span>
        </Link>
        <h1 className="text-xl font-bold text-gray-800 tracking-tight border-l pl-6 border-gray-300">관리자 포털</h1>
        
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-gray-600 bg-gray-100 px-2.5 py-1 rounded font-medium">
            {user?.email} (관리자)
          </span>
          <button
            onClick={async () => {
              if (confirm("로그아웃 하시겠습니까?")) {
                await logout();
                router.push("/login");
              }
            }}
            className="text-xs text-gray-500 hover:text-red-500 font-semibold transition-colors cursor-pointer"
          >
            로그아웃
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-8 max-w-6xl mx-auto w-full">
        <div className="space-y-6">
          {/* Section Header */}
          <div className="flex justify-between items-center flex-wrap gap-4">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <ShieldAlert className="text-purple-600" size={24} />
                권한 및 계정 관리
              </h2>
              <p className="mt-1 text-sm text-gray-500">UNICON Creator 플랫폼 회원의 계정 권한을 추가 및 설정합니다.</p>
            </div>
            
            <button 
              onClick={() => setIsOpen(true)}
              className="flex items-center gap-2 bg-[#025096] text-white px-4 py-2.5 rounded-lg font-bold hover:bg-[#023b70] transition-colors shadow-sm cursor-pointer"
            >
              <UserPlus size={18} /> 새 계정 발급
            </button>
          </div>

          {/* Search bar & Filter summary */}
          <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="이름 또는 이메일로 검색..."
                className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-blue-500 focus:bg-white text-sm transition-all"
              />
            </div>
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery("")}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-150 rounded-lg transition-colors"
              >
                <X size={16} />
              </button>
            )}
            <span className="text-xs text-gray-400 font-mono">
              총 {filteredUsers.length}개 결과
            </span>
          </div>

          {/* Users Table */}
          <div className="bg-white shadow-sm rounded-xl overflow-hidden border border-gray-200">
            {fetching ? (
              <div className="flex flex-col items-center justify-center p-20 text-gray-400">
                <Loader2 className="animate-spin text-blue-500 mb-3" size={28} />
                <p className="text-sm">사용자 정보를 불러오는 중...</p>
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="p-20 text-center text-gray-450">
                <p className="text-lg font-medium">등록되거나 매칭되는 계정이 없습니다.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-gray-50 text-gray-700 font-bold border-b border-gray-200">
                    <tr>
                      <th className="p-4 font-semibold">이름</th>
                      <th className="p-4 font-semibold">이메일</th>
                      <th className="p-4 font-semibold">권한 (Role) 설정</th>
                      <th className="p-4 font-semibold">가입일자</th>
                      <th className="p-4 font-semibold text-center">동작</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredUsers.map((u) => (
                      <tr key={u.uid} className="hover:bg-gray-50/50 transition-colors">
                        <td className="p-4 text-gray-900 font-bold">{u.name}</td>
                        <td className="p-4 text-gray-500 font-mono text-xs">{u.email}</td>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <Shield className={`size-4 ${u.role === 'ADMIN' ? 'text-red-500' : u.role === 'BANNED' ? 'text-gray-500' : 'text-green-500'}`} />
                            <select
                              value={u.role}
                              disabled={u.uid === user?.uid}
                              onChange={(e) => handleRoleChange(u.uid, e.target.value)}
                              className={`text-xs font-bold px-2.5 py-1.5 rounded-lg border outline-none cursor-pointer bg-white transition-all focus:ring-1 focus:ring-blue-500
                                ${u.role === 'ADMIN' 
                                  ? 'border-red-200 text-red-700 hover:bg-red-50/20' 
                                  : u.role === 'BANNED'
                                  ? 'border-gray-300 text-gray-700 bg-gray-100 hover:bg-gray-200'
                                  : 'border-green-200 text-green-700 hover:bg-green-50/20'}`}
                            >
                              <option value="USER">일반 사용자 (USER)</option>
                              <option value="ADMIN">시스템 관리자 (ADMIN)</option>
                              <option value="BANNED">사용 정지 (BANNED)</option>
                            </select>
                          </div>
                        </td>
                        <td className="p-4 text-gray-400 font-mono text-xs">
                          {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "-"}
                        </td>
                        <td className="p-4 text-center">
                          <button
                            onClick={() => handleOpenEditModal(u)}
                            className="p-1.5 text-gray-400 hover:text-blue-650 hover:bg-blue-55 rounded-lg transition-all cursor-pointer mr-1"
                            title="회원 정보 수정 및 초기화"
                          >
                            <Edit2 size={16} />
                          </button>
                          <button
                            onClick={() => handleDeleteUser(u.uid, u.email)}
                            disabled={u.uid === user?.uid}
                            className="p-1.5 text-gray-400 hover:text-red-650 hover:bg-red-50 rounded-lg transition-all disabled:opacity-30 cursor-pointer"
                            title="계정 기록 삭제"
                          >
                            <Trash2 size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Account issuance Modal */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden relative border border-gray-150">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="font-bold text-lg text-gray-800 flex items-center gap-1.5">
                <Shield className="text-blue-600" size={20} />
                새로운 계정 직접 발급
              </h3>
              <button 
                onClick={() => setIsOpen(false)} 
                className="text-gray-400 hover:text-gray-900 p-1 rounded-full hover:bg-gray-200 transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleCreateUser} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">사용자 이름</label>
                <input 
                  type="text" 
                  value={form.name} 
                  onChange={e => setForm({ ...form, name: e.target.value })} 
                  className="w-full border border-gray-300 rounded-lg p-2.5 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm transition-all" 
                  placeholder="예) 홍길동" 
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">이메일 (로그인 ID)</label>
                <input 
                  type="email" 
                  value={form.email} 
                  onChange={e => setForm({ ...form, email: e.target.value })} 
                  className="w-full border border-gray-300 rounded-lg p-2.5 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm transition-all" 
                  placeholder="user@unicon.com" 
                  required 
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">초기 비밀번호</label>
                <input 
                  type="text" 
                  value={form.password} 
                  onChange={e => setForm({ ...form, password: e.target.value })} 
                  className="w-full border border-gray-300 rounded-lg p-2.5 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm font-mono transition-all" 
                  placeholder="6자 이상 비밀번호 입력" 
                  required 
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">권한 수준 (Role)</label>
                <select 
                  value={form.role} 
                  onChange={e => setForm({ ...form, role: e.target.value })} 
                  className="w-full border border-gray-300 rounded-lg p-2.5 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm cursor-pointer bg-white transition-all"
                >
                  <option value="USER">일반 사용자 (USER)</option>
                  <option value="ADMIN">시스템 관리자 (ADMIN)</option>
                </select>
              </div>
              
              <button 
                disabled={createLoading} 
                type="submit" 
                className="w-full mt-6 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-md cursor-pointer"
              >
                {createLoading ? (
                  <>
                    <Loader2 className="animate-spin" size={18} />
                    발급 처리 중...
                  </>
                ) : (
                  <>
                    <Check size={18} />
                    계정 등록 완료
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {isEditOpen && editingUser && (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden relative border border-gray-150">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="font-bold text-lg text-gray-800 flex items-center gap-1.5">
                <Edit2 className="text-blue-600" size={20} />
                회원 상세 정보 수정
              </h3>
              <button 
                onClick={() => setIsEditOpen(false)} 
                className="text-gray-400 hover:text-gray-900 p-1 rounded-full hover:bg-gray-200 transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleUpdateUser} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">이메일 계정 (수정 불가)</label>
                <input 
                  type="text" 
                  value={editingUser.email} 
                  disabled
                  className="w-full bg-gray-100 border border-gray-200 rounded-lg p-2.5 text-sm text-gray-500 cursor-not-allowed font-mono" 
                />
              </div>
              
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">사용자 이름</label>
                <input 
                  type="text" 
                  value={editForm.name} 
                  onChange={e => setEditForm({ ...editForm, name: e.target.value })} 
                  className="w-full border border-gray-300 rounded-lg p-2.5 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm transition-all" 
                  placeholder="사용자 이름 입력" 
                  required
                />
              </div>
              
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">권한 수준 (Role)</label>
                <select 
                  value={editForm.role} 
                  disabled={editingUser.uid === user?.uid}
                  onChange={e => setEditForm({ ...editForm, role: e.target.value })} 
                  className="w-full border border-gray-300 rounded-lg p-2.5 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm cursor-pointer bg-white transition-all"
                >
                  <option value="USER">일반 사용자 (USER)</option>
                  <option value="ADMIN">시스템 관리자 (ADMIN)</option>
                  <option value="BANNED">사용 정지 (BANNED)</option>
                </select>
              </div>

              <div className="pt-4 border-t border-gray-100">
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">비밀번호 관리</label>
                <button
                  type="button"
                  disabled={resetLoading}
                  onClick={handleSendResetEmail}
                  className="w-full bg-gray-100 hover:bg-gray-200 disabled:bg-gray-50 text-gray-700 border border-gray-300 py-2.5 rounded-lg font-bold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"
                >
                  {resetLoading ? (
                    <Loader2 className="animate-spin" size={14} />
                  ) : (
                    <ShieldAlert size={14} className="text-amber-500" />
                  )}
                  비밀번호 재설정(초기화) 메일 전송
                </button>
                <p className="text-[10px] text-gray-400 mt-1.5 leading-relaxed">
                  사용자 이메일로 비밀번호 재설정 링크가 포함된 메일을 발송합니다. 사용자가 메일의 링크를 통해 직접 안전하게 새 비밀번호를 설정할 수 있습니다.
                </p>
              </div>
              
              <div className="flex gap-2 pt-4">
                <button 
                  type="button"
                  onClick={() => setIsEditOpen(false)}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold py-2.5 rounded-lg transition-colors text-sm cursor-pointer"
                >
                  취소
                </button>
                <button 
                  disabled={editLoading} 
                  type="submit" 
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-md cursor-pointer text-sm"
                >
                  {editLoading ? (
                    <Loader2 className="animate-spin" size={16} />
                  ) : (
                    "저장 완료"
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
