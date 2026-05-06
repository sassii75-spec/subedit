"use client";

import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, deleteDoc, doc, query, orderBy } from 'firebase/firestore';
import { ArrowLeft, Download, Trash2, Languages, Calendar } from 'lucide-react';
import Link from 'next/link';

interface SubtitleProject {
  id: string;
  title: string;
  targetLang: string;
  originalSubtitles: any[];
  translatedSubtitles: any[];
  createdAt: any;
}

export default function HistoryPage() {
  const [projects, setProjects] = useState<SubtitleProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchHistory = async () => {
    try {
      const q = query(collection(db, 'subedit_history'), orderBy('createdAt', 'desc'));
      const querySnapshot = await getDocs(q);
      const data: SubtitleProject[] = [];
      querySnapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as SubtitleProject);
      });
      setProjects(data);
    } catch (err) {
      console.error('Error fetching history:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, []);

  const handleDelete = async (id: string) => {
    if (confirm('이 작업 내역을 삭제하시겠습니까?')) {
      try {
        await deleteDoc(doc(db, 'subedit_history', id));
        setProjects(projects.filter(p => p.id !== id));
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

  const downloadSRT = (project: SubtitleProject) => {
    let srtContent = '';
    project.translatedSubtitles.forEach((sub, idx) => {
      srtContent += `${idx + 1}\n`;
      srtContent += `${formatSrtTime(sub.start)} --> ${formatSrtTime(sub.end)}\n`;
      srtContent += `${sub.text}\n\n`;
    });

    const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${project.title}_${project.targetLang}_${getFormattedDate()}.srt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadSMI = (project: SubtitleProject) => {
    let smiContent = `<SAMI>\n<HEAD>\n<TITLE>${project.title}</TITLE>\n<STYLE TYPE="text/css">\n<!--\nP { font-family: Arial; font-size: 14pt; text-align: center; color: #FFFFFF; }\n.TRANS { Name: Translated; lang: ${project.targetLang}; SAMIType: CC; }\n-->\n</STYLE>\n</HEAD>\n<BODY>\n`;

    project.translatedSubtitles.forEach((sub) => {
      const msStart = parseMs(sub.start);
      const msEnd = parseMs(sub.end);
      smiContent += `<SYNC Start=${msStart}><P Class=TRANS>${sub.text}\n`;
      smiContent += `<SYNC Start=${msEnd}><P Class=TRANS>&nbsp;\n`;
    });

    smiContent += `</BODY>\n</SAMI>`;

    const blob = new Blob([smiContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${project.title}_${project.targetLang}_${getFormattedDate()}.smi`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // 언어명 매핑
  const langMap: Record<string, string> = { 'en': '영어', 'zh': '중국어', 'ja': '일본어', 'vi': '베트남어' };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      <header className="px-6 py-4 bg-white border-b border-gray-200 flex items-center shadow-sm sticky top-0 z-10">
        <Link href="/" className="flex items-center text-gray-600 hover:text-gray-900 transition-colors mr-6">
          <ArrowLeft size={20} className="mr-2" />
          <span className="font-semibold">에디터로 돌아가기</span>
        </Link>
        <h1 className="text-xl font-bold text-gray-800 tracking-tight border-l pl-6 border-gray-300">작업 내역 히스토리</h1>
      </header>

      <main className="flex-1 p-8 max-w-7xl mx-auto w-full">
        {isLoading ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <Languages size={48} className="mb-4 text-gray-300" />
            <p className="text-lg">저장된 자막 작업 내역이 없습니다.</p>
            <Link href="/" className="mt-4 text-blue-600 font-semibold hover:underline">새로운 자막 만들기</Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
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

                  <div className="bg-gray-50 p-3 rounded-lg text-sm text-gray-600 mb-5 border border-gray-100 h-20 overflow-hidden relative">
                    <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-gray-50 to-transparent"></div>
                    <span className="font-semibold text-gray-700">미리보기: </span>
                    {project.translatedSubtitles?.[0]?.text || '번역 내용 없음...'}
                  </div>
                  
                  <div className="flex items-center gap-2 mt-auto">
                    <button 
                      onClick={() => downloadSRT(project)}
                      className="flex-1 flex justify-center items-center gap-1.5 py-2 px-3 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors text-sm font-semibold"
                    >
                      <Download size={14} /> .SRT
                    </button>
                    <button 
                      onClick={() => downloadSMI(project)}
                      className="flex-1 flex justify-center items-center gap-1.5 py-2 px-3 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 transition-colors text-sm font-semibold"
                    >
                      <Download size={14} /> .SMI
                    </button>
                    <button 
                      onClick={() => handleDelete(project.id)}
                      className="p-2 border border-red-200 text-red-500 rounded-md hover:bg-red-50 transition-colors"
                      title="작업 내역 삭제"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
