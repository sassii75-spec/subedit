"use client";

import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, deleteDoc, doc, query, orderBy } from 'firebase/firestore';
import { ArrowLeft, Download, Trash2, Languages, Calendar, X, List, Eye, Clipboard, Check, Play, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Loader2 } from 'lucide-react';

interface SubtitleProject {
  id: string;
  title: string;
  targetLang: string;
  originalSubtitles: any[];
  translatedSubtitles: any[];
  translations?: Record<string, any[]>;
  createdAt: any;
}

interface ExamProject {
  id: string;
  title: string;
  subtitle: string;
  quizzes: any[];
  createdAt: any;
}

export default function HistoryPage() {
  const { user, userRole, loading, logout } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  const [activeTab, setActiveTab] = useState<'translations' | 'exams'>('translations');
  const [projects, setProjects] = useState<SubtitleProject[]>([]);
  const [exams, setExams] = useState<ExamProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [previewProject, setPreviewProject] = useState<SubtitleProject | null>(null);
  const [viewFileModal, setViewFileModal] = useState<{ project: SubtitleProject, isOriginal: boolean, format: 'SRT' | 'SMI', content: string, langCode?: string } | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [previewLang, setPreviewLang] = useState<string>('');

  const getTranslatedLanguages = (project: SubtitleProject) => {
    if (project.translations && Object.keys(project.translations).length > 0) {
      return Object.keys(project.translations);
    }
    if (project.targetLang && project.translatedSubtitles && project.translatedSubtitles.length > 0) {
      return [project.targetLang];
    }
    return [];
  };

  const handleOpenPreview = (project: SubtitleProject) => {
    setPreviewProject(project);
    const langs = getTranslatedLanguages(project);
    setPreviewLang(langs[0] || project.targetLang || 'en');
  };

  // 인쇄 전용 모달 상태
  const [printExam, setPrintExam] = useState<ExamProject | null>(null);
  const [printColumnCount, setPrintColumnCount] = useState<1 | 2>(2);
  const [printShowAnswers, setPrintShowAnswers] = useState(true);
  const [printShowTranslatedQuestion, setPrintShowTranslatedQuestion] = useState(true);

  const fetchHistory = async () => {
    try {
      const q = query(collection(db, 'subedit_history'), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      const data: SubtitleProject[] = [];
      querySnapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as SubtitleProject);
      });
      setProjects(data);

      const qExams = query(collection(db, 'unicon_exams'), orderBy('createdAt', 'desc'));
      const examSnap = await getDocs(qExams);
      const examData: ExamProject[] = [];
      examSnap.forEach((doc) => {
        examData.push({ id: doc.id, ...doc.data() } as ExamProject);
      });
      setExams(examData);
    } catch (err) {
      console.error('Error fetching history:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-[#0f111a] flex flex-col items-center justify-center text-white">
        <Loader2 className="animate-spin text-blue-500 mb-4" size={40} />
        <p className="text-gray-400 font-medium">세션 확인 중...</p>
      </div>
    );
  }

  if (userRole === 'BANNED') {
    return (
      <div className="min-h-screen bg-[#0f111a] flex flex-col items-center justify-center text-white p-6 text-center">
        <ShieldAlert className="text-red-500 mb-4 animate-bounce" size={48} />
        <h2 className="text-2xl font-bold text-red-500 mb-2">접근 제한됨</h2>
        <p className="text-gray-400 max-w-md mb-6 text-sm">관리자에 의해 이 계정의 이용이 제한되었습니다. 관리자에게 문의해 주세요.</p>
        <button
          onClick={async () => {
            await logout();
            router.push('/login');
          }}
          className="bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 rounded-lg font-bold transition-colors cursor-pointer"
        >
          로그아웃 후 다시 로그인
        </button>
      </div>
    );
  }

  const handleDelete = async (id: string, isExam: boolean = false) => {
    if (confirm('이 내역을 삭제하시겠습니까?')) {
      try {
        if (isExam) {
          await deleteDoc(doc(db, 'unicon_exams', id));
          setExams(exams.filter(e => e.id !== id));
        } else {
          await deleteDoc(doc(db, 'subedit_history', id));
          setProjects(projects.filter(p => p.id !== id));
        }
      } catch (err) {
        console.error('Error deleting doc:', err);
        alert('삭제 중 오류가 발생했습니다.');
      }
    }
  };

  // 다운로드 공통 로직
  const formatSrtTime = (timeStr: string) => {
    const parts = timeStr.split(':');
    if (parts.length === 2) return `00:${timeStr},000`; // MM:SS
    return `${timeStr},000`; // HH:MM:SS
  };

  const parseMs = (timeStr: string) => {
    const parts = timeStr.split(':').map(Number);
    if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
    if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
    return 0;
  };

  const getFormattedDate = () => {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${mm}${dd}_${hh}${min}`;
  };

  const generateSRTContent = (project: SubtitleProject, isOriginal: boolean = false, langCode?: string) => {
    let srtContent = '';
    let targetSubtitles = [];
    if (isOriginal) {
      targetSubtitles = project.originalSubtitles || [];
    } else if (langCode && project.translations && project.translations[langCode]) {
      targetSubtitles = project.translations[langCode];
    } else {
      targetSubtitles = project.translatedSubtitles || [];
    }
    targetSubtitles.forEach((sub, idx) => {
      srtContent += `${idx + 1}\n`;
      srtContent += `${formatSrtTime(sub.start)} --> ${formatSrtTime(sub.end)}\n`;
      srtContent += `${sub.text}\n\n`;
    });
    return srtContent;
  };

  const generateSMIContent = (project: SubtitleProject, isOriginal: boolean = false, langCode?: string) => {
    let targetSubtitles = [];
    if (isOriginal) {
      targetSubtitles = project.originalSubtitles || [];
    } else if (langCode && project.translations && project.translations[langCode]) {
      targetSubtitles = project.translations[langCode];
    } else {
      targetSubtitles = project.translatedSubtitles || [];
    }
    const activeLangCode = isOriginal ? 'ko' : (langCode || project.targetLang);

    let smiContent = `<SAMI>\n<HEAD>\n<TITLE>${project.title}</TITLE>\n<STYLE TYPE="text/css">\n<!--\nP { font-family: Arial; font-size: 14pt; text-align: center; color: #FFFFFF; }\n.TRANS { Name: Subtitle; lang: ${activeLangCode}; SAMIType: CC; }\n-->\n</STYLE>\n</HEAD>\n<BODY>\n`;

    targetSubtitles.forEach((sub) => {
      const msStart = parseMs(sub.start);
      const msEnd = parseMs(sub.end);
      smiContent += `<SYNC Start=${msStart}><P Class=TRANS>${sub.text}\n`;
      smiContent += `<SYNC Start=${msEnd}><P Class=TRANS>&nbsp;\n`;
    });

    smiContent += `</BODY>\n</SAMI>`;
    return smiContent;
  };

  const downloadSRT = (project: SubtitleProject, isOriginal: boolean = false, langCode?: string) => {
    const content = generateSRTContent(project, isOriginal, langCode);
    const langSuffix = isOriginal ? '원본' : (langCode || project.targetLang);
    
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${project.title}_${langSuffix}_${getFormattedDate()}.srt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadSMI = (project: SubtitleProject, isOriginal: boolean = false, langCode?: string) => {
    const content = generateSMIContent(project, isOriginal, langCode);
    const langSuffix = isOriginal ? '원본' : (langCode || project.targetLang);
    
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${project.title}_${langSuffix}_${getFormattedDate()}.smi`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleOpenViewer = (project: SubtitleProject, isOriginal: boolean, format: 'SRT' | 'SMI', langCode?: string) => {
    const content = format === 'SRT' 
      ? generateSRTContent(project, isOriginal, langCode) 
      : generateSMIContent(project, isOriginal, langCode);
    setViewFileModal({ project, isOriginal, format, content, langCode });
    setIsCopied(false);
  };

  // 언어명 매핑
  const langMap: Record<string, string> = { 'en': '영어', 'zh': '중국어', 'ja': '일본어', 'vi': '베트남어', 'my': '미얀마어', 'bn': '벵골어', 'mn': '몽골어' };

  // Iframe 기반 독립 인쇄 함수 (크롬 무한 로딩 버그 방지)
  const handleIframePrint = (printAreaId: string) => {
    const printContent = document.getElementById(printAreaId);
    if (!printContent) return;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const iframeWindow = iframe.contentWindow;
    if (!iframeWindow) return;
    const iframeDocument = iframeWindow.document;

    iframeDocument.open();
    iframeDocument.write('<html><head><title>시험지 인쇄</title>');

    // 현재 페이지의 모든 스타일 태그 복사 (Tailwind 적용)
    const styles = document.querySelectorAll('style, link[rel="stylesheet"]');
    styles.forEach((style) => {
      iframeDocument.write(style.outerHTML);
    });

    iframeDocument.write(`
      <style>
        @media print {
          @page { size: A4 portrait; margin: 0; }
          body { 
            -webkit-print-color-adjust: exact !important; 
            print-color-adjust: exact !important; 
            background-color: white !important; 
          }
        }
        body { 
          background-color: white; 
          margin: 0; 
          padding: 0; 
        }
        #\${printAreaId} {
          padding: 0 !important;
          height: auto !important;
          overflow: visible !important;
        }
      </style>
    `);
    
    iframeDocument.write('</head><body>');
    iframeDocument.write(printContent.outerHTML);
    iframeDocument.write('</body></html>');
    iframeDocument.close();

    setTimeout(() => {
      iframeWindow.focus();
      iframeWindow.print();
      setTimeout(() => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
      }, 1000);
    }, 500);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      <header className="px-6 py-4 bg-white border-b border-gray-200 flex items-center shadow-sm sticky top-0 z-10 print:hidden">
        <Link href="/" className="flex items-center text-gray-600 hover:text-gray-900 transition-colors mr-6">
          <ArrowLeft size={20} className="mr-2" />
          <span className="font-semibold">에디터로 돌아가기</span>
        </Link>
        <h1 className="text-xl font-bold text-gray-800 tracking-tight border-l pl-6 border-gray-300">작업 내역 보관함</h1>
        
        <div className="ml-8 flex bg-gray-100 p-1 rounded-lg">
          <button 
            onClick={() => setActiveTab('translations')}
            className={`px-4 py-1.5 text-sm font-bold rounded-md transition-colors ${activeTab === 'translations' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            영상 번역 내역
          </button>
          <button 
            onClick={() => setActiveTab('exams')}
            className={`px-4 py-1.5 text-sm font-bold rounded-md transition-colors ${activeTab === 'exams' ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            시험지 보관함
          </button>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-gray-600 bg-gray-100 px-2.5 py-1 rounded font-medium">
            {user?.email} ({userRole === "ADMIN" ? "관리자" : "일반 유저"})
          </span>
          {userRole === 'ADMIN' && (
            <Link href="/admin/users" className="text-xs font-bold text-red-655 hover:underline">
              어드민 포털
            </Link>
          )}
          <button
            onClick={async () => {
              if (confirm('로그아웃 하시겠습니까?')) {
                await logout();
                router.push('/login');
              }
            }}
            className="text-xs text-gray-500 hover:text-red-500 font-semibold transition-colors cursor-pointer"
          >
            로그아웃
          </button>
        </div>
      </header>

      <main className="flex-1 p-8 max-w-7xl mx-auto w-full print:p-0 print:max-w-none">
        {isLoading ? (
          <div className="flex justify-center items-center h-64 print:hidden">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : activeTab === 'translations' ? (
          projects.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400 print:hidden">
              <Languages size={48} className="mb-4 text-gray-300" />
              <p className="text-lg">저장된 자막 작업 내역이 없습니다.</p>
              <Link href="/" className="mt-4 text-blue-600 font-semibold hover:underline">새로운 자막 만들기</Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 print:hidden">
              {projects.map((project) => (
                <div key={project.id} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <h2 className="text-lg font-bold text-gray-800 line-clamp-1 flex-1 mr-4" title={project.title}>
                      {project.title}
                    </h2>
                    <span className="bg-blue-50 text-blue-700 text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap border border-blue-100">
                      {langMap[project.targetLang] || project.targetLang} 번역
                    </span>
                  </div>
                  
                  <div className="flex items-center text-gray-500 text-sm mb-4">
                    <Calendar size={14} className="mr-1.5" />
                    {project.createdAt?.seconds 
                      ? new Date(project.createdAt.seconds * 1000).toLocaleString() 
                      : '날짜 정보 없음'}
                  </div>

                  <div 
                    onClick={() => handleOpenPreview(project)}
                    className="bg-gray-50 p-3 rounded-lg text-sm text-gray-600 mb-5 border border-gray-200 h-20 overflow-hidden relative cursor-pointer hover:bg-gray-100 hover:border-blue-300 transition-colors group"
                    title="전체 자막 미리보기"
                  >
                    <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-gray-50 group-hover:from-gray-100 to-transparent flex items-end justify-center pb-1">
                      <span className="text-[10px] font-bold text-blue-500 bg-white/80 px-2 py-0.5 rounded-full shadow-sm">전체 보기 클릭</span>
                    </div>
                    <span className="font-semibold text-gray-700">미리보기: </span>
                    {(() => {
                      if (project.translatedSubtitles?.[0]?.text) {
                        return project.translatedSubtitles[0].text;
                      }
                      if (project.translations) {
                        const keys = Object.keys(project.translations);
                        if (keys.length > 0) {
                          const firstLangSubs = project.translations[keys[0]];
                          if (firstLangSubs && firstLangSubs[0]?.text) {
                            return firstLangSubs[0].text;
                          }
                        }
                      }
                      return '번역 내용 없음...';
                    })()}
                  </div>
                  
                  <div className="flex flex-col gap-2 mt-auto">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-500 w-10 shrink-0 text-center bg-gray-100 rounded py-1">원본</span>
                      {/* SRT Split Download & Preview */}
                      <div className="flex-1 flex items-center border border-gray-300 rounded-md overflow-hidden bg-white">
                        <button 
                          onClick={() => downloadSRT(project, true)}
                          className="flex-1 py-1.5 px-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 border-r border-gray-200 transition-colors flex items-center justify-center gap-1"
                          title="SRT 파일 직접 다운로드"
                        >
                          <Download size={11} /> .SRT
                        </button>
                        <button 
                          onClick={() => handleOpenViewer(project, true, 'SRT')}
                          className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors shrink-0"
                          title="SRT 파일 내용 미리보기"
                        >
                          <Eye size={12} />
                        </button>
                      </div>
                      {/* SMI Split Download & Preview */}
                      <div className="flex-1 flex items-center border border-gray-300 rounded-md overflow-hidden bg-white">
                        <button 
                          onClick={() => downloadSMI(project, true)}
                          className="flex-1 py-1.5 px-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 border-r border-gray-200 transition-colors flex items-center justify-center gap-1"
                          title="SMI 파일 직접 다운로드"
                        >
                          <Download size={11} /> .SMI
                        </button>
                        <button 
                          onClick={() => handleOpenViewer(project, true, 'SMI')}
                          className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors shrink-0"
                          title="SMI 파일 내용 미리보기"
                        >
                          <Eye size={12} />
                        </button>
                      </div>
                    </div>
                    
                    {getTranslatedLanguages(project).map((langCode) => (
                      <div key={langCode} className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-blue-650 w-10 shrink-0 text-center bg-blue-50 border border-blue-100 rounded py-1 whitespace-nowrap overflow-hidden text-ellipsis font-bold" title={langMap[langCode] || langCode}>
                          {langMap[langCode] || langCode}
                        </span>
                        {/* SRT Split Download & Preview */}
                        <div className="flex-1 flex items-center border border-blue-200 rounded-md overflow-hidden bg-white">
                          <button 
                            onClick={() => downloadSRT(project, false, langCode)}
                            className="flex-1 py-1.5 px-1 text-[11px] font-semibold text-blue-750 hover:bg-blue-50 border-r border-blue-100 transition-colors flex items-center justify-center gap-1"
                            title={`${langMap[langCode] || langCode} SRT 번역본 직접 다운로드`}
                          >
                            <Download size={11} /> .SRT
                          </button>
                          <button 
                            onClick={() => handleOpenViewer(project, false, 'SRT', langCode)}
                            className="p-1 text-gray-400 hover:text-blue-655 hover:bg-blue-50 transition-colors shrink-0"
                            title={`${langMap[langCode] || langCode} SRT 번역본 내용 미리보기`}
                          >
                            <Eye size={12} />
                          </button>
                        </div>
                        {/* SMI Split Download & Preview */}
                        <div className="flex-1 flex items-center border border-blue-200 rounded-md overflow-hidden bg-white">
                          <button 
                            onClick={() => downloadSMI(project, false, langCode)}
                            className="flex-1 py-1.5 px-1 text-[11px] font-semibold text-blue-750 hover:bg-blue-50 border-r border-blue-100 transition-colors flex items-center justify-center gap-1"
                            title={`${langMap[langCode] || langCode} SMI 번역본 직접 다운로드`}
                          >
                            <Download size={11} /> .SMI
                          </button>
                          <button 
                            onClick={() => handleOpenViewer(project, false, 'SMI', langCode)}
                            className="p-1 text-gray-400 hover:text-blue-655 hover:bg-blue-50 transition-colors shrink-0"
                            title={`${langMap[langCode] || langCode} SMI 번역본 내용 미리보기`}
                          >
                            <Eye size={12} />
                          </button>
                        </div>
                      </div>
                    ))}

                    <Link 
                      href={`/?projectId=${project.id}`}
                      className="mt-2 flex justify-center items-center gap-1.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors text-sm font-bold shadow-sm"
                    >
                      <Play size={14} className="fill-current" /> 편집기로 불러오기
                    </Link>

                    <button 
                      onClick={() => handleDelete(project.id, false)}
                      className="mt-1 flex justify-center items-center gap-1.5 py-2 border border-red-200 text-red-500 rounded-md hover:bg-red-50 transition-colors text-sm font-semibold w-full"
                    >
                      <Trash2 size={16} /> 기록 삭제
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          )
        ) : (
          /* 시험지 보관함 탭 */
          exams.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400 print:hidden">
              <List size={48} className="mb-4 text-purple-300" />
              <p className="text-lg">보관된 시험지가 없습니다.</p>
              <Link href="/" className="mt-4 text-purple-600 font-semibold hover:underline">영상 편집기에서 시험지 생성하기</Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 print:hidden">
              {exams.map((exam) => (
                <div key={exam.id} className="bg-white rounded-xl shadow-sm border border-purple-100 overflow-hidden hover:shadow-md transition-shadow">
                  <div className="p-5 flex flex-col h-full">
                    <div className="flex items-start justify-between mb-3">
                      <h2 className="text-xl font-black text-purple-900 line-clamp-1 flex-1 mr-4" title={exam.title}>
                        {exam.title || '제목 없음'}
                      </h2>
                      <span className="bg-purple-50 text-purple-700 text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap border border-purple-100">
                        {exam.quizzes?.length || 0}문항
                      </span>
                    </div>
                    {exam.subtitle && <p className="text-sm font-bold text-gray-500 mb-4 line-clamp-1">{exam.subtitle}</p>}
                    
                    <div className="flex items-center text-gray-400 text-sm mb-5">
                      <Calendar size={14} className="mr-1.5" />
                      {exam.createdAt?.seconds 
                        ? new Date(exam.createdAt.seconds * 1000).toLocaleString() 
                        : '날짜 정보 없음'}
                    </div>

                    <div className="flex flex-col gap-2 mt-auto">
                      <button 
                        onClick={() => setPrintExam(exam)}
                        className="flex justify-center items-center gap-1.5 py-2.5 bg-gray-900 text-white rounded-lg hover:bg-black transition-colors text-sm font-bold shadow-sm"
                      >
                        <Download size={16} /> 다시 인쇄하기 (PDF)
                      </button>
                      <button 
                        onClick={() => handleDelete(exam.id, true)}
                        className="flex justify-center items-center gap-1.5 py-2 border border-red-200 text-red-500 rounded-lg hover:bg-red-50 transition-colors text-sm font-semibold"
                      >
                        <Trash2 size={16} /> 삭제
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </main>

      {/* 미리보기 모달 */}
      {previewProject && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center gap-3">
                <List className="text-blue-600" size={24} />
                <div>
                  <h2 className="text-lg font-bold text-gray-800 line-clamp-1">{previewProject.title}</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-gray-500">번역 언어 선택:</span>
                    <select
                      value={previewLang}
                      onChange={(e) => setPreviewLang(e.target.value)}
                      className="text-xs font-bold text-gray-700 bg-white rounded px-2 py-1 outline-none border border-gray-200 cursor-pointer focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    >
                      {getTranslatedLanguages(previewProject).map((lang) => (
                        <option key={lang} value={lang}>
                          {langMap[lang] || lang}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
              <button 
                onClick={() => setPreviewProject(null)} 
                className="p-2 text-gray-500 hover:bg-gray-200 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="flex-1 overflow-auto p-0 bg-gray-50">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-white shadow-sm z-10 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-4 py-3 border-b border-gray-200 font-semibold w-32 text-center">타임스탬프</th>
                    <th className="px-4 py-3 border-b border-gray-200 font-semibold w-1/2">원본 자막</th>
                    <th className="px-4 py-3 border-b border-gray-200 font-semibold w-1/2 text-blue-600">번역 자막</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {previewProject.originalSubtitles?.map((origSub, idx) => {
                    let transText = '';
                    if (previewProject.translations && previewProject.translations[previewLang]) {
                      transText = previewProject.translations[previewLang][idx]?.text || '';
                    } else if (previewLang === previewProject.targetLang) {
                      transText = previewProject.translatedSubtitles?.[idx]?.text || '';
                    }
                    return (
                      <tr key={origSub.id || idx} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-xs font-mono text-gray-400 text-center whitespace-nowrap align-top pt-4">
                          {origSub.start}
                          <br/><span className="text-[10px] text-gray-300">|</span><br/>
                          {origSub.end}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-700 leading-relaxed align-top">
                          {origSub.text}
                        </td>
                        <td className="px-4 py-3 text-[15px] font-medium text-gray-900 leading-relaxed align-top bg-blue-50/30">
                          {transText}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
      {/* 자막 파일 내용 미리보기 뷰어 모달 */}
      {viewFileModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl h-[75vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center gap-3">
                <Languages className="text-purple-600" size={22} />
                <div>
                  <h2 className="text-base font-bold text-gray-800 line-clamp-1">
                    {viewFileModal.project.title}
                  </h2>
                  <p className="text-xs text-gray-500">
                    파일 포맷: <span className="font-extrabold text-purple-700">{viewFileModal.format}</span> • 구분: <span className="font-bold text-gray-700">{viewFileModal.isOriginal ? '원본 자막' : (langMap[viewFileModal.langCode || viewFileModal.project.targetLang] || viewFileModal.langCode || viewFileModal.project.targetLang) + ' 번역본'}</span>
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setViewFileModal(null)} 
                className="p-2 text-gray-500 hover:bg-gray-200 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            {/* RAW Content Monospace Viewport */}
            <div className="flex-1 overflow-auto p-4 bg-gray-900 relative">
              <pre className="text-sm font-mono text-gray-200 whitespace-pre-wrap leading-relaxed select-all">
                {viewFileModal.content}
              </pre>
            </div>

            {/* Modal Actions */}
            <div className="p-4 border-t border-gray-250 bg-gray-50 flex items-center justify-between gap-3 shrink-0">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(viewFileModal.content);
                  setIsCopied(true);
                  setTimeout(() => setIsCopied(false), 2000);
                }}
                className={`flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-bold border rounded-lg transition-all shadow-sm active:scale-95 ${isCopied ? 'bg-green-600 border-green-600 text-white' : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-100'}`}
              >
                {isCopied ? <Check size={16} /> : <Clipboard size={16} />}
                {isCopied ? '복사 완료!' : '클립보드 복사'}
              </button>
              
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (viewFileModal.format === 'SRT') {
                      downloadSRT(viewFileModal.project, viewFileModal.isOriginal, viewFileModal.langCode);
                    } else {
                      downloadSMI(viewFileModal.project, viewFileModal.isOriginal, viewFileModal.langCode);
                    }
                  }}
                  className="flex items-center justify-center gap-1.5 px-5 py-2 text-sm font-bold text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-all shadow-sm active:scale-95"
                >
                  <Download size={16} />
                  자막 파일 다운로드
                </button>
                <button 
                  onClick={() => setViewFileModal(null)}
                  className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-200 hover:bg-gray-300 rounded-lg transition-colors"
                >
                  닫기
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 시험지 다시 인쇄하기(미리보기) 모달 */}
      {printExam && (
        <div className="fixed inset-0 bg-gray-100 z-50 flex flex-col overflow-hidden print:bg-white">
          <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shadow-sm z-10 shrink-0 print:hidden">
            <div className="flex items-center gap-6">
              <h2 className="text-xl font-bold text-gray-800">보관함 시험지 인쇄</h2>
              <div className="flex items-center gap-4 bg-gray-50 px-4 py-2 rounded-lg border border-gray-200">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-gray-700">레이아웃</span>
                  <select 
                    value={printColumnCount} 
                    onChange={(e) => setPrintColumnCount(Number(e.target.value) as 1 | 2)}
                    className="border border-gray-300 rounded px-2 py-1 text-sm outline-none font-medium bg-white"
                  >
                    <option value={1}>1단 (기본)</option>
                    <option value={2}>2단 (모의고사 폼)</option>
                  </select>
                </div>
                <div className="w-px h-5 bg-gray-300"></div>
                <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-gray-700">
                  <input type="checkbox" checked={printShowAnswers} onChange={(e) => setPrintShowAnswers(e.target.checked)} className="w-4 h-4 accent-blue-600" />
                  정답 및 해설 표시
                </label>
                <div className="w-px h-5 bg-gray-300"></div>
                <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-gray-700">
                  <input type="checkbox" checked={printShowTranslatedQuestion} onChange={(e) => setPrintShowTranslatedQuestion(e.target.checked)} className="w-4 h-4 accent-purple-600" />
                  발문 번역 표시
                </label>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <button 
                onClick={() => setPrintExam(null)}
                className="px-4 py-2 text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                닫기
              </button>
              <button 
                onClick={() => handleIframePrint('history-print-area')}
                className="px-5 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm flex items-center gap-2"
              >
                PDF 출력 및 저장하기
              </button>
            </div>
          </div>
          
          <div id="history-print-area" className="flex-1 overflow-y-auto p-8 flex flex-col items-center gap-10 bg-gray-100 print:p-0 print:bg-white print:overflow-visible print:block print:relative print:w-full">
            {/* 1. 문제지 페이지 (페이지 분할 적용) */}
            {(() => {
              const selectedQuizzes = printExam.quizzes.filter(q => q.isSelected);
              const chunkSize = printColumnCount === 2 ? 10 : 6;
              const pages = [];
              for (let i = 0; i < selectedQuizzes.length; i += chunkSize) {
                pages.push({ items: selectedQuizzes.slice(i, i + chunkSize), startIndex: i });
              }
              
              return pages.map((page, pageIdx) => (
                <div 
                  key={`history-quiz-page-${pageIdx}`}
                  className={`bg-white shadow-xl border border-gray-200 p-[15mm] shrink-0 print:shadow-none print:border-none print:p-0 print:w-full print:max-w-none print:m-0 relative ${pageIdx > 0 ? 'break-before-page' : ''}`}
                  style={{ width: '210mm', minHeight: '297mm', fontFamily: '"Batang", "KoPub Batang", serif', pageBreakBefore: pageIdx > 0 ? 'always' : 'auto', breakBefore: pageIdx > 0 ? 'page' : 'auto' }}
                >
                  {/* Header (모든 페이지에 동일한 포맷 적용) */}
                  <div className="mb-8 border-b-2 border-black pb-4 text-center">
                    <h1 className="w-full text-center text-3xl font-black mb-2">{printExam.title || '제목 없음'}</h1>
                    <h2 className="w-full text-center text-lg font-bold text-gray-600">{printExam.subtitle || ''}</h2>
                  </div>

                  {/* Questions Container (Flexbox 2단) */}
                  <div className={`flex ${printColumnCount === 2 ? 'gap-[12mm]' : 'flex-col'}`}>
                    {/* Left Column (또는 1단 전체) */}
                    <div className="flex-1 flex flex-col">
                      {(printColumnCount === 2 ? page.items.slice(0, 5) : page.items).map((q, localIdx) => {
                        const absoluteIdx = page.startIndex + localIdx;
                        return (
                          <div key={q.id} className="mb-8">
                            <p className="font-bold text-black mb-3 text-[15px] leading-relaxed">
                              <span className="mr-1">{absoluteIdx + 1}.</span> {q.question}
                              {printShowTranslatedQuestion && q.questionTranslated && (
                                <span className="block text-[13px] font-normal text-gray-600 mt-1 leading-snug">{q.questionTranslated}</span>
                              )}
                            </p>
                            <div className="space-y-2 pl-4">
                              {q.choices.map((choice: string, cIdx: number) => (
                                <div key={cIdx} className="flex gap-2 text-black text-[14px]">
                                  <span className="shrink-0">{['①', '②', '③', '④', '⑤'][cIdx]}</span>
                                  <span>{choice}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Divider (항상 세로줄 표시) */}
                    {printColumnCount === 2 && (
                      <div className="w-0 shrink-0 border-l border-[#ccc]"></div>
                    )}

                    {/* Right Column */}
                    {printColumnCount === 2 && (
                      <div className="flex-1 flex flex-col">
                        {page.items.length > 5 && page.items.slice(5, 10).map((q, localIdx) => {
                          const absoluteIdx = page.startIndex + 5 + localIdx;
                          return (
                            <div key={q.id} className="mb-8">
                              <p className="font-bold text-black mb-3 text-[15px] leading-relaxed">
                                <span className="mr-1">{absoluteIdx + 1}.</span> {q.question}
                                {printShowTranslatedQuestion && q.questionTranslated && (
                                  <span className="block text-[13px] font-normal text-gray-600 mt-1 leading-snug">{q.questionTranslated}</span>
                                )}
                              </p>
                              <div className="space-y-2 pl-4">
                                {q.choices.map((choice: string, cIdx: number) => (
                                  <div key={cIdx} className="flex gap-2 text-black text-[14px]">
                                    <span className="shrink-0">{['①', '②', '③', '④', '⑤'][cIdx]}</span>
                                    <span>{choice}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  
                  {/* 하단 페이지 번호 (인쇄 시에만 표시) */}
                  <div className="hidden print:block absolute bottom-4 w-full text-center text-[12px] text-gray-500 font-bold left-0">
                    - {pageIdx + 1} -
                  </div>
                </div>
              ));
            })()}

            {/* 2. 해설지 페이지 (새 페이지로 분리 및 분할) */}
            {(() => {
              if (!printShowAnswers) return null;
              const selectedQuizzes = printExam.quizzes.filter(q => q.isSelected);
              if (selectedQuizzes.length === 0) return null;
              
              const chunkSize = printColumnCount === 2 ? 10 : 6;
              const pages = [];
              for (let i = 0; i < selectedQuizzes.length; i += chunkSize) {
                pages.push({ items: selectedQuizzes.slice(i, i + chunkSize), startIndex: i });
              }
              
              return pages.map((page, pageIdx) => (
                <div 
                  key={`history-answer-page-${pageIdx}`}
                  className="bg-white shadow-xl border border-gray-200 p-[15mm] shrink-0 print:shadow-none print:border-none print:p-0 print:w-full print:max-w-none print:m-0 break-before-page relative"
                  style={{ width: '210mm', minHeight: '297mm', fontFamily: '"Batang", "KoPub Batang", serif', pageBreakBefore: 'always', breakBefore: 'page' }}
                >
                  {/* 정답 페이지 Header (모든 페이지에 동일 포맷 적용) */}
                  <div className="mb-8 border-b-2 border-black pb-4 text-center">
                    <h2 className="text-3xl font-black mb-2">정답 및 해설</h2>
                    <div className="text-lg font-bold text-gray-600">{printExam.title || '문제지 제목'}</div>
                  </div>
                  <div className={`flex ${printColumnCount === 2 ? 'gap-[12mm]' : 'flex-col'}`}>
                    {/* Left Column */}
                    <div className="flex-1 flex flex-col">
                      {(printColumnCount === 2 ? page.items.slice(0, 5) : page.items).map((q, localIdx) => {
                        const absoluteIdx = page.startIndex + localIdx;
                        return (
                          <div key={q.id} className="mb-6">
                            <div className="font-bold text-black mb-1 flex gap-2">
                              <span className="bg-black text-white w-5 h-5 flex items-center justify-center rounded-full text-xs shrink-0">{absoluteIdx + 1}</span>
                              <span>정답: {q.answer}</span>
                            </div>
                            <p className="text-sm text-gray-700 leading-relaxed bg-gray-50 p-3 rounded-lg border border-gray-100">
                              {q.explanation}
                            </p>
                          </div>
                        );
                      })}
                    </div>

                    {/* Divider (항상 세로줄 표시) */}
                    {printColumnCount === 2 && (
                      <div className="w-0 shrink-0 border-l border-[#ccc]"></div>
                    )}

                    {/* Right Column */}
                    {printColumnCount === 2 && (
                      <div className="flex-1 flex flex-col">
                        {page.items.length > 5 && page.items.slice(5, 10).map((q, localIdx) => {
                          const absoluteIdx = page.startIndex + 5 + localIdx;
                          return (
                            <div key={q.id} className="mb-6">
                              <div className="font-bold text-black mb-1 flex gap-2">
                                <span className="bg-black text-white w-5 h-5 flex items-center justify-center rounded-full text-xs shrink-0">{absoluteIdx + 1}</span>
                                <span>정답: {q.answer}</span>
                              </div>
                              <p className="text-sm text-gray-700 leading-relaxed bg-gray-50 p-3 rounded-lg border border-gray-100">
                                {q.explanation}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="hidden print:block absolute bottom-4 w-full text-center text-[12px] text-gray-500 font-bold left-0">
                    - 정답 {pageIdx + 1} -
                  </div>
                </div>
              ));
            })()}
            
            {/* 인쇄용 고정 푸터 */}
            <div className="hidden print:block fixed bottom-4 w-full text-center text-[11px] text-gray-500 font-bold" style={{ fontFamily: '"Batang", "KoPub Batang", serif' }}>
              - {printExam.title || '시험지'} -
            </div>
          </div>
        </div>
      )}

      {/* Print Styles */}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          /* 크롬 인쇄 무한로딩 방지용 레이아웃 리셋 */
          .overflow-hidden { overflow: visible !important; }
          .overflow-y-auto { overflow: visible !important; }
          .h-screen { height: auto !important; }
          .fixed { position: absolute !important; }

          .print\\:block, .print\\:block * {
            visibility: visible;
          }
          .print\\:bg-white {
            background-color: white !important;
          }
          .break-before-page {
            page-break-before: always !important;
            break-before: page !important;
          }
        }
      `}</style>
    </div>
  );
}
