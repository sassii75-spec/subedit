"use client";

import { useState, useRef, useEffect } from 'react';
import { Upload, Languages, Download, Play, Pause, Settings, Mic, Loader2, Scissors, Combine, X, Volume2, VolumeX, BookOpen, List, Check, ShieldAlert } from 'lucide-react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { db, auth } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp, doc, updateDoc, getDoc, getDocs, query, orderBy, setDoc } from 'firebase/firestore';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

export type QuizItem = {
  id: string;
  question: string;
  choices: string[];
  answer: string;
  explanation: string;
  isSelected: boolean;
  questionTranslated?: string;
};

// 초 단위(float)를 HH:MM:SS 형식으로 변환하는 헬퍼 함수
const formatTime = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const parseMs = (timeStr: string) => {
  const parts = timeStr.split(':').map(Number);
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  return 0;
};

const parseSmi = (text: string): { id: number, start: string, end: string, text: string }[] => {
  const syncRegex = /<SYNC\s+Start\s*=\s*["']?(\d+)["']?[^>]*>([\s\S]*?)(?=<SYNC|<\/BODY|<\/SAMI|$)/gi;
  const items: { startMs: number; text: string }[] = [];
  let match;
  while ((match = syncRegex.exec(text)) !== null) {
    const startMs = parseInt(match[1], 10);
    let rawText = match[2];
    let cleanedText = rawText.replace(/<br\s*\/?>/gi, '\n');
    cleanedText = cleanedText.replace(/<[^>]+>/g, '');
    cleanedText = cleanedText
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .trim();
    items.push({ startMs, text: cleanedText });
  }

  const subtitles: { id: number, start: string, end: string, text: string }[] = [];
  let currentSub: { id: number, start: string, startMs: number, text: string } | null = null;
  let globalId = 0;

  const formatMsTime = (ms: number) => {
    const seconds = ms / 1000;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const hasText = item.text && item.text !== ' ' && item.text !== '';

    if (currentSub) {
      const endStr = formatMsTime(item.startMs);
      if (currentSub.text) {
        subtitles.push({
          id: currentSub.id,
          start: currentSub.start,
          end: endStr,
          text: currentSub.text
        });
      }
      currentSub = null;
    }

    if (hasText) {
      currentSub = {
        id: globalId++,
        start: formatMsTime(item.startMs),
        startMs: item.startMs,
        text: item.text
      };
    }
  }

  if (currentSub && currentSub.text) {
    subtitles.push({
      id: currentSub.id,
      start: currentSub.start,
      end: formatMsTime(currentSub.startMs + 3000),
      text: currentSub.text
    });
  }

  return subtitles;
};

const parseSrt = (text: string): { id: number, start: string, end: string, text: string }[] => {
  const blocks = text.trim().split(/\r?\n\r?\n/);
  const subtitles: { id: number, start: string, end: string, text: string }[] = [];
  let globalId = 0;

  const formatSecTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) {
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const parseSrtTimestamp = (timeStr: string): number => {
    const [hms, msStr] = timeStr.trim().replace('.', ',').split(',');
    const parts = hms.split(':').map(Number);
    let seconds = 0;
    if (parts.length === 3) {
      seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    } else if (parts.length === 2) {
      seconds = parts[0] * 60 + parts[1];
    }
    const ms = msStr ? parseInt(msStr, 10) : 0;
    return seconds + ms / 1000;
  };

  blocks.forEach((block) => {
    const lines = block.split(/\r?\n/);
    if (lines.length >= 2) {
      const timeLineIdx = lines.findIndex(line => line.includes('-->'));
      if (timeLineIdx !== -1) {
        const timeLine = lines[timeLineIdx];
        const textLines = lines.slice(timeLineIdx + 1);
        const [startStr, endStr] = timeLine.split('-->');

        if (startStr && endStr) {
          const startSeconds = parseSrtTimestamp(startStr);
          const endSeconds = parseSrtTimestamp(endStr);

          subtitles.push({
            id: globalId++,
            start: formatSecTime(startSeconds),
            end: formatSecTime(endSeconds),
            text: textLines.join('\n').trim()
          });
        }
      }
    }
  });

  return subtitles;
};


export default function Home() {
  const { user, userRole, loading, logout } = useAuth();
  const router = useRouter();

  // Redirect if not logged in
  useEffect(() => {
    if (!loading && !user) {
      router.push('/login');
    }
  }, [user, loading, router]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [originalSubtitles, setOriginalSubtitles] = useState<{id: number, start: string, end: string, text: string}[]>([]);

  const [translatedSubtitles, setTranslatedSubtitles] = useState<{id: number, start: string, end: string, text: string}[]>([]);
  const [translationsCache, setTranslationsCache] = useState<Record<string, {id: number, start: string, end: string, text: string}[]>>({});

  const [targetLang, setTargetLang] = useState('en');
  const targetLangRef = useRef(targetLang);

  // targetLang 상태가 변경될 때마다 ref도 업데이트하여 비동기 콜백에서 최신 값을 참조할 수 있게 함
  useEffect(() => {
    targetLangRef.current = targetLang;
  }, [targetLang]);

  const [isTranslating, setIsTranslating] = useState(false);
  const [translateProgressMsg, setTranslateProgressMsg] = useState('AI 전체 번역');
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [activeSubtitleId, setActiveSubtitleId] = useState<number | null>(null);
  const [currentOverlay, setCurrentOverlay] = useState<string | null>(null);
  const [isClipping, setIsClipping] = useState<number | null>(null);
  
  // 멀티 클립 병합용 상태
  const [selectedSubtitles, setSelectedSubtitles] = useState<Set<number>>(new Set());
  const [isMerging, setIsMerging] = useState(false);
  
  // 수동 컷편집용 상태
  const [isManualClipOpen, setIsManualClipOpen] = useState(false);
  const [manualClipStart, setManualClipStart] = useState('00:00:00');
  const [manualClipEnd, setManualClipEnd] = useState('00:00:10');
  const [isManualClipping, setIsManualClipping] = useState(false);
  const [isFullDownloading, setIsFullDownloading] = useState(false);
  
  // 퀴즈(시험지) 상태
  const [isQuizEditorOpen, setIsQuizEditorOpen] = useState(false);
  const [quizCount, setQuizCount] = useState<number>(5);
  const [quizChoiceCount, setQuizChoiceCount] = useState<4 | 5>(4);
  const [quizTargetLang, setQuizTargetLang] = useState<string>('none');
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false);
  const [quizzes, setQuizzes] = useState<QuizItem[]>([]);
  
  // 시험지 미리보기 팝업 상태
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [examTitle, setExamTitle] = useState('문제지 제목 입력');
  const [examSubtitle, setExamSubtitle] = useState(''); 
  const [columnCount, setColumnCount] = useState<1 | 2>(2);
  const [showAnswers, setShowAnswers] = useState(true);
  const [printShowTranslatedQuestion, setPrintShowTranslatedQuestion] = useState(true);
  
  // 실시간 더빙 상태
  const [isLiveDubbing, setIsLiveDubbing] = useState(false);
  
  // --- New states for tracking and saving edits ---
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectTitle, setProjectTitle] = useState<string | null>(null);
  const [initialOriginalSubtitles, setInitialOriginalSubtitles] = useState<{id: number, start: string, end: string, text: string}[]>([]);
  const [initialTranslatedSubtitles, setInitialTranslatedSubtitles] = useState<{id: number, start: string, end: string, text: string}[]>([]);
  const [detectedOriginalSubtitles, setDetectedOriginalSubtitles] = useState<{id: number, start: string, end: string, text: string}[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [detectedTranslatedSubtitles, setDetectedTranslatedSubtitles] = useState<{id: number, start: string, end: string, text: string}[]>([]);
  const [detectedTranslationsCache, setDetectedTranslationsCache] = useState<Record<string, {id: number, start: string, end: string, text: string}[]>>({});
  const [isDragging, setIsDragging] = useState(false);
  const [projectVersions, setProjectVersions] = useState<any[]>([]);
  const [isVersionsOpen, setIsVersionsOpen] = useState(false);

  // Authorization checks are placed at the bottom of the component to respect React's Rules of Hooks

  // Reactive effect to dynamically build baseline for original subtitles chunk-by-chunk
  useEffect(() => {
    if (originalSubtitles.length > 0) {
      setInitialOriginalSubtitles(prev => {
        if (prev.length === 0) return JSON.parse(JSON.stringify(originalSubtitles));
        const updated = [...prev];
        let hasNew = false;
        originalSubtitles.forEach(sub => {
          if (!prev.some(p => p.id === sub.id)) {
            updated.push(JSON.parse(JSON.stringify(sub)));
            hasNew = true;
          }
        });
        return hasNew ? updated : prev;
      });
    } else {
      setInitialOriginalSubtitles([]);
    }
  }, [originalSubtitles]);

  // Reactive effect to dynamically build baseline for raw detected subtitles chunk-by-chunk (Version 0)
  useEffect(() => {
    if (originalSubtitles.length > 0) {
      setDetectedOriginalSubtitles(prev => {
        if (prev.length === 0) return JSON.parse(JSON.stringify(originalSubtitles));
        const updated = [...prev];
        let hasNew = false;
        originalSubtitles.forEach(sub => {
          if (!prev.some(p => p.id === sub.id)) {
            updated.push(JSON.parse(JSON.stringify(sub)));
            hasNew = true;
          }
        });
        return hasNew ? updated : prev;
      });
    } else {
      setDetectedOriginalSubtitles([]);
    }
  }, [originalSubtitles]);

  // Reactive effect to dynamically build baseline for translated subtitles chunk-by-chunk
  useEffect(() => {
    if (translatedSubtitles.length > 0) {
      setInitialTranslatedSubtitles(prev => {
        if (prev.length === 0) return JSON.parse(JSON.stringify(translatedSubtitles));
        const updated = [...prev];
        let hasNew = false;
        translatedSubtitles.forEach(sub => {
          if (!prev.some(p => p.id === sub.id)) {
            updated.push(JSON.parse(JSON.stringify(sub)));
            hasNew = true;
          }
        });
        return hasNew ? updated : prev;
      });
    } else {
      setInitialTranslatedSubtitles([]);
    }
  }, [translatedSubtitles]);

  // Reactive effect to dynamically build baseline for raw translated subtitles chunk-by-chunk (Version 0 translation)
  useEffect(() => {
    if (translatedSubtitles.length > 0) {
      setDetectedTranslatedSubtitles(prev => {
        if (prev.length === 0) return JSON.parse(JSON.stringify(translatedSubtitles));
        const updated = [...prev];
        let hasNew = false;
        translatedSubtitles.forEach(sub => {
          if (!prev.some(p => p.id === sub.id)) {
            updated.push(JSON.parse(JSON.stringify(sub)));
            hasNew = true;
          }
        });
        if (hasNew) {
          // Update baseline cache as well
          setDetectedTranslationsCache(cache => ({
            ...cache,
            [targetLang]: updated
          }));
        }
        return hasNew ? updated : prev;
      });
    } else {
      setDetectedTranslatedSubtitles([]);
    }
  }, [translatedSubtitles, targetLang]);

  // URL에서 projectId 파라미터를 읽어 Firebase로부터 프로젝트 데이터를 로드
  useEffect(() => {
    const fetchProject = async () => {
      if (typeof window === 'undefined') return;
      const params = new URLSearchParams(window.location.search);
      const id = params.get('projectId');
      if (id) {
        setIsProcessing(true);
        setProgressMsg('프로젝트 데이터를 가져오는 중...');
        try {
          const docRef = doc(db, 'subedit_history', id);
          const docSnap = await getDoc(docRef);
          if (docSnap.exists()) {
            const data = docSnap.data();
            setProjectId(id);
            setProjectTitle(data.title || '불러온 자막 작업');
            setTargetLang(data.targetLang || 'en');
            
            const orig = data.originalSubtitles || [];
            const transMap = data.translations || {};
            const detectedTransMap = data.detectedTranslations || {};
            const currentLang = data.targetLang || 'en';

            // fallback for legacy single translation data
            if (Object.keys(transMap).length === 0 && data.translatedSubtitles && data.translatedSubtitles.length > 0) {
              transMap[currentLang] = data.translatedSubtitles;
            }
            if (Object.keys(detectedTransMap).length === 0 && data.detectedTranslatedSubtitles && data.detectedTranslatedSubtitles.length > 0) {
              detectedTransMap[currentLang] = data.detectedTranslatedSubtitles;
            } else if (Object.keys(detectedTransMap).length === 0 && data.translatedSubtitles && data.translatedSubtitles.length > 0) {
              detectedTransMap[currentLang] = data.translatedSubtitles;
            }

            const trans = transMap[currentLang] || [];
            const detectedTrans = detectedTransMap[currentLang] || [];
            const detected = data.detectedOriginalSubtitles || (data.versions?.[0]?.originalSubtitles) || orig;
            
            setOriginalSubtitles(orig);
            setTranslatedSubtitles(trans);
            setDetectedOriginalSubtitles(JSON.parse(JSON.stringify(detected)));
            setDetectedTranslatedSubtitles(JSON.parse(JSON.stringify(detectedTrans)));
            
            // 기준점도 불러온 데이터로 동기화
            setInitialOriginalSubtitles(JSON.parse(JSON.stringify(orig)));
            setInitialTranslatedSubtitles(JSON.parse(JSON.stringify(trans)));
            
            // 버전 목록 설정 (서브컬렉션에서 로드 및 레거시 데이터 마이그레이션)
            const versionsCol = collection(db, 'subedit_history', id, 'versions');
            const versionsQuery = query(versionsCol, orderBy('savedAt', 'asc'));
            const versionsSnap = await getDocs(versionsQuery);
            const loadedVersions: any[] = [];
            versionsSnap.forEach(vDoc => {
              loadedVersions.push(vDoc.data());
            });

            let finalVersions = loadedVersions;
            if (finalVersions.length === 0 && data.versions && data.versions.length > 0) {
              finalVersions = data.versions;
              data.versions.forEach(async (ver: any) => {
                try {
                  const verDocRef = doc(collection(db, 'subedit_history', id, 'versions'), ver.versionId || Math.random().toString(36).substring(7));
                  await setDoc(verDocRef, ver);
                } catch (migErr) {
                  console.error("Migration error for version:", ver.versionId, migErr);
                }
              });
            }

            setProjectVersions(finalVersions);
            
            // 번역 캐시 업데이트
            setTranslationsCache(JSON.parse(JSON.stringify(transMap)));
            setDetectedTranslationsCache(JSON.parse(JSON.stringify(detectedTransMap)));
            
            alert(`"${data.title || '작업'}" 프로젝트를 성공적으로 불러왔습니다.`);
          } else {
            alert('보관함에서 해당 프로젝트를 찾을 수 없습니다.');
          }
        } catch (err: any) {
          console.error('Error fetching project:', err);
          alert('프로젝트를 불러오는 중 오류가 발생했습니다: ' + err.message);
        } finally {
          setIsProcessing(false);
        }
      }
    };
    fetchProject();
  }, []);

  const isOriginalModified = (id: number, text: string) => {
    const init = detectedOriginalSubtitles.find(i => i.id === id);
    return init ? (text || '').trim() !== (init.text || '').trim() : false;
  };

  const isTranslatedModified = (id: number, text: string) => {
    const init = detectedTranslatedSubtitles.find(i => i.id === id);
    return init ? (text || '').trim() !== (init.text || '').trim() : false;
  };

  const handleResetOriginal = () => {
    if (detectedOriginalSubtitles.length === 0) {
      alert("되돌릴 최초 감지 자막이 없습니다.");
      return;
    }
    if (confirm("원본 자막을 최초 감지된 상태(버전 0)로 되돌리시겠습니까? (수정한 모든 내용이 최초 감지 대본으로 복구됩니다.)")) {
      setOriginalSubtitles(JSON.parse(JSON.stringify(detectedOriginalSubtitles)));
    }
  };

  const handleResetTranslated = () => {
    if (detectedTranslatedSubtitles.length === 0) {
      alert("되돌릴 최초 번역 자막이 없습니다.");
      return;
    }
    if (confirm("번역 자막을 최초 번역된 상태로 되돌리시겠습니까? (수정한 모든 내용이 최초 번역 대본으로 복구됩니다.)")) {
      const resetSubs = JSON.parse(JSON.stringify(detectedTranslatedSubtitles));
      setTranslatedSubtitles(resetSubs);
      setTranslationsCache(prev => ({
        ...prev,
        [targetLang]: resetSubs
      }));
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      if (file.type.startsWith('video/')) {
        await processFile(file);
      } else {
        const ext = file.name.toLowerCase().split('.').pop();
        if (ext === 'smi' || ext === 'srt') {
          await processSubtitleFile(file);
        } else {
          alert('영상 파일 또는 SMI/SRT 자막 파일만 업로드할 수 있습니다.');
        }
      }
    }
  };
  
  // 스크롤 동기화를 위한 ref
  const originalListRef = useRef<HTMLDivElement>(null);
  const translatedListRef = useRef<HTMLDivElement>(null);
  
  // 실시간 캡션 관련 상태
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const isListeningRef = useRef(isListening);
  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);
  const [liveOriginalTexts, setLiveOriginalTexts] = useState<{id: number, text: string}[]>([]);
  const [liveTranslatedTexts, setLiveTranslatedTexts] = useState<{id: number, text: string}[]>([]);
  const [interimText, setInterimText] = useState('');
  const [sourceLang, setSourceLang] = useState('ko-KR');
  const sourceLangRef = useRef(sourceLang);
  useEffect(() => {
    sourceLangRef.current = sourceLang;
    if (isListening && recognitionRef.current) {
      recognitionRef.current.stop();
    }
  }, [sourceLang, isListening]);
  const recognitionRef = useRef<any>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const ffmpegRef = useRef<any>(null);

  const loadFFmpeg = async () => {
    if (!ffmpegRef.current) {
      ffmpegRef.current = new FFmpeg();
    }
    const ffmpeg = ffmpegRef.current;
    if (ffmpeg.loaded) return;
    
    setProgressMsg('FFmpeg 엔진 로딩 중...');
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
    
    ffmpeg.on('log', ({ message }: { message: string }) => {
      console.log('FFmpeg:', message);
    });

    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });
  };

  const processFile = async (file: File) => {
    // Reset project state for new video
    setProjectId(null);
    setProjectTitle(null);
    setProjectVersions([]);
    setOriginalSubtitles([]);
    setTranslatedSubtitles([]);
    setInitialOriginalSubtitles([]);
    setInitialTranslatedSubtitles([]);
    setDetectedOriginalSubtitles([]);
    setDetectedTranslatedSubtitles([]);
    setTranslationsCache({});
    setDetectedTranslationsCache({});

    // 1. 영상 미리보기 및 길이 측정 설정
    const objectUrl = URL.createObjectURL(file);
    setVideoSrc(objectUrl);

    // 비디오 길이를 구하기 위해 임시 엘리먼트 사용
    const videoEl = document.createElement('video');
    videoEl.src = objectUrl;
    await new Promise((resolve) => {
      videoEl.onloadedmetadata = () => resolve(videoEl.duration);
    });
    const duration = videoEl.duration;

    // 2. FFmpeg로 오디오 추출 시작
    setIsProcessing(true);
    try {
      await loadFFmpeg();
      const ffmpeg = ffmpegRef.current;
      
      setProgressMsg('영상 로드 중...');
      await ffmpeg.writeFile('input.mp4', await fetchFile(file));
      
      // Vercel Serverless 최대 4.5MB 제한을 피하기 위해 분할 처리 (Chunking) 4분(240초) 단위로 축소
      const CHUNK_SIZE = 4 * 60;
      const totalChunks = Math.ceil(duration / CHUNK_SIZE);
      let allSegments: any[] = [];
      let globalSegmentId = 0;

      for (let i = 0; i < totalChunks; i++) {
        const startSec = i * CHUNK_SIZE;
        const currentChunkDuration = Math.min(CHUNK_SIZE, duration - startSec);
        
        setProgressMsg(`[${i + 1}/${totalChunks}] 조각 오디오 추출 중...`);
        const chunkFileName = `chunk_${i}.mp3`;
        await ffmpeg.exec([
          '-ss', String(startSec), 
          '-t', String(currentChunkDuration), 
          '-i', 'input.mp4', 
          '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', 
          chunkFileName
        ]);
        
        setProgressMsg(`[${i + 1}/${totalChunks}] 조각 오디오 완성 중...`);
        const data = await ffmpeg.readFile(chunkFileName);
        const audioBlob = new Blob([data as any], { type: 'audio/mp3' });
        
        setProgressMsg(`[${i + 1}/${totalChunks}] 조각 서버 전송 중... (AI 자막 생성)`);
        const formData = new FormData();
        formData.append('file', audioBlob, 'audio.mp3');
        
        const response = await fetch('/api/whisper', {
          method: 'POST',
          body: formData,
        });
        
        const contentType = response.headers.get('content-type');
        let result;
        if (contentType && contentType.includes('application/json')) {
          result = await response.json();
        } else {
          const text = await response.text();
          throw new Error(`API 오류 (${response.status}): ${text.substring(0, 100)}`);
        }

        if (!response.ok) {
          throw new Error(result.error || 'API 요청 실패');
        }

        if (result.segments && result.segments.length > 0) {
          const formattedSegments = result.segments.map((seg: any) => {
            const absoluteStart = seg.start + startSec;
            const absoluteEnd = seg.end + startSec;
            return {
              id: globalSegmentId++,
              start: formatTime(absoluteStart),
              end: formatTime(absoluteEnd),
              text: seg.text.trim(),
            };
          });
          allSegments = [...allSegments, ...formattedSegments];
          // 부분 자막이라도 실시간으로 화면에 업데이트하여 로딩 체감을 줄임
          setOriginalSubtitles([...allSegments]);
        }
        
        // 브라우저 메모리 관리를 위해 사용 끝난 파일 즉시 삭제
        await ffmpeg.deleteFile(chunkFileName);
      }
      
      setProgressMsg('자막 생성 완료!');
      setDetectedOriginalSubtitles(JSON.parse(JSON.stringify(allSegments)));
      setTimeout(() => setIsProcessing(false), 2000);
      
    } catch (err: any) {
      console.error(err);
      alert('오류가 발생했습니다: ' + (err.message || err));
      setIsProcessing(false);
    }
  };

  const processSubtitleFile = async (file: File) => {
    // Reset project state for new subtitles
    setProjectId(null);
    setProjectTitle(file.name.replace(/\.(smi|srt)$/i, ''));
    setProjectVersions([]);
    setOriginalSubtitles([]);
    setTranslatedSubtitles([]);
    setInitialOriginalSubtitles([]);
    setInitialTranslatedSubtitles([]);
    setDetectedOriginalSubtitles([]);
    setDetectedTranslatedSubtitles([]);
    setTranslationsCache({});
    setDetectedTranslationsCache({});
    setVideoSrc(null); // No video

    setIsProcessing(true);
    setProgressMsg('자막 파일 읽는 중...');

    try {
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const result = e.target?.result;
          if (typeof result === 'string') resolve(result);
          else reject(new Error('파일 읽기 실패'));
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file, 'utf-8');
      });

      const isSmi = file.name.toLowerCase().endsWith('.smi');
      setProgressMsg(isSmi ? 'SMI 자막 분석 중...' : 'SRT 자막 분석 중...');
      
      const parsedSubs = isSmi ? parseSmi(text) : parseSrt(text);

      if (parsedSubs.length === 0) {
        throw new Error('자막 파일에서 자막을 찾을 수 없거나 올바르지 않은 형식입니다.');
      }

      setOriginalSubtitles(parsedSubs);
      setDetectedOriginalSubtitles(JSON.parse(JSON.stringify(parsedSubs)));
      setInitialOriginalSubtitles(JSON.parse(JSON.stringify(parsedSubs)));

      setProgressMsg('자막 로드 완료!');
      setTimeout(() => setIsProcessing(false), 1000);
    } catch (err: any) {
      console.error(err);
      alert('자막 파일 처리 중 오류가 발생했습니다: ' + err.message);
      setIsProcessing(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const ext = file.name.toLowerCase().split('.').pop();
      if (ext === 'smi' || ext === 'srt') {
        await processSubtitleFile(file);
      } else {
        await processFile(file);
      }
    }
  };

  const handleTranslate = async () => {
    if (originalSubtitles.length === 0) {
      alert('먼저 영상이나 자막 파일을 업로드하여 원본 자막을 등록해주세요.');
      return;
    }

    setIsTranslating(true);
    setTranslateProgressMsg('번역 준비 중...');
    
    try {
      const CHUNK_SIZE = 50;
      const totalChunks = Math.ceil(originalSubtitles.length / CHUNK_SIZE);
      let translatedAcc: any[] = [];

      for (let i = 0; i < totalChunks; i++) {
        setTranslateProgressMsg(`[${i + 1}/${totalChunks}] 번역 중...`);
        const chunk = originalSubtitles.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
        
        const response = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subtitles: chunk,
            targetLanguage: targetLang,
          }),
        });

        const contentType = response.headers.get('content-type');
        let result;
        if (contentType && contentType.includes('application/json')) {
          result = await response.json();
        } else {
          const text = await response.text();
          throw new Error(`번역 API 오류 (${response.status}): ${text.substring(0, 100)}`);
        }

        if (!response.ok) {
          throw new Error(result.error || 'API 요청 실패');
        }

        if (result.translatedSubtitles) {
          translatedAcc = [...translatedAcc, ...result.translatedSubtitles];
          setTranslatedSubtitles([...translatedAcc]); // 실시간 화면 반영
        }
      }
      
      // 번역 완료 시 캐시에 저장
      setTranslationsCache(prev => ({
        ...prev,
        [targetLang]: translatedAcc
      }));
      setDetectedTranslationsCache(prev => ({
        ...prev,
        [targetLang]: JSON.parse(JSON.stringify(translatedAcc))
      }));
      
      setTranslateProgressMsg('번역 완료!');
      setTimeout(() => setTranslateProgressMsg('AI 전체 번역'), 2000);
    } catch (err: any) {
      console.error(err);
      alert('번역 중 오류가 발생했습니다: ' + err.message);
      setTranslateProgressMsg('AI 전체 번역');
    } finally {
      setIsTranslating(false);
    }
  };

  const handleOriginalSubtitleEdit = (id: number, newText: string) => {
    setOriginalSubtitles(prev => prev.map(sub => 
      sub.id === id ? { ...sub, text: newText } : sub
    ));
  };

  const handleSubtitleEdit = (id: number, newText: string) => {
    setTranslatedSubtitles(prev => {
      const updated = prev.map(sub => 
        sub.id === id ? { ...sub, text: newText } : sub
      );
      // 수동 편집 시 캐시도 동시에 업데이트 (즉시 반영)
      setTranslationsCache(cache => ({
        ...cache,
        [targetLang]: updated
      }));
      return updated;
    });
  };

  const handleGenerateQuiz = async () => {
    if (originalSubtitles.length === 0) {
      alert('원본 자막 대본이 없습니다. 먼저 영상이나 자막 파일을 업로드해주세요.');
      return;
    }
    setIsGeneratingQuiz(true);
    setProgressMsg('AI 시험지 출제 중...');
    
    try {
      const fullTranscript = originalSubtitles.map(s => s.text).join(' ');
      const response = await fetch('/api/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: fullTranscript, choiceCount: quizChoiceCount, questionCount: quizCount, timestamp: Date.now(), targetLang: quizTargetLang })
      });
      
      const contentType = response.headers.get('content-type');
      let result;
      if (contentType && contentType.includes('application/json')) {
        result = await response.json();
      } else {
        const text = await response.text();
        throw new Error(`퀴즈 API 오류 (${response.status}): ${text.substring(0, 100)}`);
      }

      if (!response.ok) throw new Error(result.error || '시험지 생성 실패');
      
      if (result.quizzes) {
        const enrichedQuizzes = result.quizzes.map((q: any) => ({
          ...q,
          id: Math.random().toString(36).substring(7),
          isSelected: true
        }));
        setQuizzes(enrichedQuizzes);
      }
    } catch (e: any) {
      console.error(e);
      alert('시험지 생성 중 오류가 발생했습니다: ' + e.message);
    } finally {
      setIsGeneratingQuiz(false);
      setProgressMsg('');
    }
  };

  const handleSaveQuizToHistory = async () => {
    if (quizzes.length === 0) return;
    try {
      await addDoc(collection(db, 'unicon_exams'), {
        title: examTitle || '제목 없음',
        subtitle: examSubtitle || '',
        quizzes: quizzes,
        createdAt: serverTimestamp(),
      });
      alert('시험지가 보관함에 저장되었습니다. 히스토리에서 확인할 수 있습니다.');
    } catch (e: any) {
      console.error(e);
      alert('시험지 저장 중 오류가 발생했습니다: ' + e.message);
    }
  };

  const handleQuizChange = (id: string, field: keyof QuizItem, value: any, choiceIdx?: number) => {
    setQuizzes(prev => prev.map(q => {
      if (q.id === id) {
        if (field === 'choices' && choiceIdx !== undefined) {
          const newChoices = [...q.choices];
          newChoices[choiceIdx] = value;
          return { ...q, choices: newChoices };
        }
        return { ...q, [field]: value };
      }
      return q;
    }));
  };

  const getModifiedOriginalCount = () => {
    if (initialOriginalSubtitles.length === 0) return 0;
    return originalSubtitles.filter(sub => {
      const init = initialOriginalSubtitles.find(i => i.id === sub.id);
      return init && (sub.text || '').trim() !== (init.text || '').trim();
    }).length;
  };

  const getModifiedTranslatedCount = () => {
    if (initialTranslatedSubtitles.length === 0) return 0;
    return translatedSubtitles.filter(sub => {
      const init = initialTranslatedSubtitles.find(i => i.id === sub.id);
      return init && (sub.text || '').trim() !== (init.text || '').trim();
    }).length;
  };

  const createNewVersion = (note: string, orig: any[], transCache: Record<string, any[]>) => {
    return {
      versionId: Math.random().toString(36).substring(7),
      versionName: note || `버전 ${projectVersions.length + 1}`,
      originalSubtitles: JSON.parse(JSON.stringify(orig)),
      translatedSubtitles: JSON.parse(JSON.stringify(transCache[targetLang] || [])),
      translations: JSON.parse(JSON.stringify(transCache)),
      savedAt: new Date().toISOString()
    };
  };

  const handleSaveOriginal = async () => {
    console.log("handleSaveOriginal called!");
    if (originalSubtitles.length === 0) {
      alert("저장할 원본 자막이 없습니다.");
      return;
    }
    
    console.log("Calculating modified count...");
    let modifiedCount = 0;
    try {
      modifiedCount = getModifiedOriginalCount();
      console.log("Modified count calculated:", modifiedCount);
    } catch (e: any) {
      console.error("Error in getModifiedOriginalCount:", e);
      alert("getModifiedOriginalCount 에러 발생: " + e.message);
    }
    
    const confirmMsg = modifiedCount > 0 
      ? `원본 자막 총 ${modifiedCount}개가 수정되었습니다. 저장하시겠습니까?`
      : "수정된 원본 자막이 없습니다. 그래도 현재 상태를 저장하시겠습니까?";
      
    if (!confirm(confirmMsg)) return;

    console.log("Asking for versionNote...");
    const versionNote = prompt("이번 저장 버전의 설명을 입력하세요 (예: 1차 원본 수정, 초안 완성 등):", "원본 자막 수정");
    if (versionNote === null) return; // 취소

    setIsSaving(true);
    try {
      console.log("projectId:", projectId);
      if (projectId) {
        console.log("Creating new version...");
        const newVer = createNewVersion(versionNote, originalSubtitles, translationsCache);
        console.log("New version created:", newVer);
        
        const verDocRef = doc(collection(db, 'subedit_history', projectId, 'versions'), newVer.versionId);
        await setDoc(verDocRef, newVer);

        console.log("docRef initializing...");
        const docRef = doc(db, 'subedit_history', projectId);
        console.log("updateDoc calling...");
        await updateDoc(docRef, {
          targetLang,
          originalSubtitles,
          translatedSubtitles,
          translations: translationsCache,
          detectedTranslations: detectedTranslationsCache,
          lastSavedAt: serverTimestamp(),
          versions: [], // clear main document versions field to avoid 1MB limit
          detectedOriginalSubtitles,
          detectedTranslatedSubtitles
        });
        console.log("updateDoc completed.");
        const updatedVersions = [...projectVersions, newVer];
        setProjectVersions(updatedVersions);
        alert(`원본 자막이 성공적으로 저장되었습니다.\n(총 ${modifiedCount}개 자막 수정 반영 완료 및 새 버전 등록)`);
        setInitialOriginalSubtitles(JSON.parse(JSON.stringify(originalSubtitles)));
        setInitialTranslatedSubtitles(JSON.parse(JSON.stringify(translatedSubtitles)));
      } else {
        const title = prompt("저장할 작업의 제목을 입력하세요:", "새로운 번역 작업");
        if (!title) {
          setIsSaving(false);
          return;
        }
        
        const ver0 = {
          versionId: "ver_0",
          versionName: "버전 0 (최초 감지 원본)",
          originalSubtitles: JSON.parse(JSON.stringify(detectedOriginalSubtitles)),
          translatedSubtitles: [],
          savedAt: new Date().toISOString()
        };
        const ver1 = createNewVersion(versionNote || "최초 저장", originalSubtitles, translationsCache);

        const docRef = await addDoc(collection(db, 'subedit_history'), {
          title,
          targetLang,
          originalSubtitles,
          translatedSubtitles,
          translations: translationsCache,
          detectedTranslations: detectedTranslationsCache,
          createdAt: serverTimestamp(),
          versions: [],
          detectedOriginalSubtitles,
          detectedTranslatedSubtitles
        });
        
        const newProjId = docRef.id;

        const ver0Ref = doc(collection(db, 'subedit_history', newProjId, 'versions'), ver0.versionId);
        await setDoc(ver0Ref, ver0);
        const ver1Ref = doc(collection(db, 'subedit_history', newProjId, 'versions'), ver1.versionId);
        await setDoc(ver1Ref, ver1);

        const updatedVersions = [ver0, ver1];
        setProjectId(newProjId);
        setProjectTitle(title);
        setProjectVersions(updatedVersions);
        alert(`성공적으로 저장되었습니다!\n(프로젝트명: "${title}" | 총 ${modifiedCount}개 자막 수정 반영 및 버전 0/버전 1 등록 완료)`);
        setInitialOriginalSubtitles(JSON.parse(JSON.stringify(originalSubtitles)));
        setInitialTranslatedSubtitles(JSON.parse(JSON.stringify(translatedSubtitles)));
      }
    } catch (err: any) {
      console.error('Save Original Error:', err);
      alert('저장 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveTranslated = async () => {
    if (translatedSubtitles.length === 0) {
      alert("저장할 번역 자막이 없습니다. 먼저 번역을 진행해주세요.");
      return;
    }
    
    const modifiedCount = getModifiedTranslatedCount();
    
    const confirmMsg = modifiedCount > 0 
      ? `번역 자막 총 ${modifiedCount}개가 수정되었습니다. 저장하시겠습니까?`
      : "수정된 번역 자막이 없습니다. 그래도 현재 상태를 저장하시겠습니까?";
      
    if (!confirm(confirmMsg)) return;

    const versionNote = prompt("이번 저장 버전의 설명을 입력하세요 (예: 번역 수정본, 검수 완료 등):", "번역 자막 수정");
    if (versionNote === null) return; // 취소

    setIsSaving(true);
    try {
      if (projectId) {
        const newVer = createNewVersion(versionNote, originalSubtitles, translationsCache);
        
        const verDocRef = doc(collection(db, 'subedit_history', projectId, 'versions'), newVer.versionId);
        await setDoc(verDocRef, newVer);

        const docRef = doc(db, 'subedit_history', projectId);
        await updateDoc(docRef, {
          targetLang,
          originalSubtitles,
          translatedSubtitles,
          translations: translationsCache,
          detectedTranslations: detectedTranslationsCache,
          lastSavedAt: serverTimestamp(),
          versions: [], // clear main document versions field to avoid 1MB limit
          detectedOriginalSubtitles,
          detectedTranslatedSubtitles
        });
        const updatedVersions = [...projectVersions, newVer];
        setProjectVersions(updatedVersions);
        alert(`번역 자막이 성공적으로 저장되었습니다.\n(총 ${modifiedCount}개 자막 수정 반영 완료 및 새 버전 등록)`);
        setInitialOriginalSubtitles(JSON.parse(JSON.stringify(originalSubtitles)));
        setInitialTranslatedSubtitles(JSON.parse(JSON.stringify(translatedSubtitles)));
      } else {
        const title = prompt("저장할 작업의 제목을 입력하세요:", "새로운 번역 작업");
        if (!title) {
          setIsSaving(false);
          return;
        }
        
        const ver0 = {
          versionId: "ver_0",
          versionName: "버전 0 (최초 감지 원본)",
          originalSubtitles: JSON.parse(JSON.stringify(detectedOriginalSubtitles)),
          translatedSubtitles: [],
          savedAt: new Date().toISOString()
        };
        const ver1 = createNewVersion(versionNote || "최초 저장", originalSubtitles, translationsCache);

        const docRef = await addDoc(collection(db, 'subedit_history'), {
          title,
          targetLang,
          originalSubtitles,
          translatedSubtitles,
          translations: translationsCache,
          detectedTranslations: detectedTranslationsCache,
          createdAt: serverTimestamp(),
          versions: [],
          detectedOriginalSubtitles,
          detectedTranslatedSubtitles
        });
        
        const newProjId = docRef.id;

        const ver0Ref = doc(collection(db, 'subedit_history', newProjId, 'versions'), ver0.versionId);
        await setDoc(ver0Ref, ver0);
        const ver1Ref = doc(collection(db, 'subedit_history', newProjId, 'versions'), ver1.versionId);
        await setDoc(ver1Ref, ver1);

        const updatedVersions = [ver0, ver1];
        setProjectId(newProjId);
        setProjectTitle(title);
        setProjectVersions(updatedVersions);
        alert(`성공적으로 저장되었습니다!\n(프로젝트명: "${title}" | 총 ${modifiedCount}개 자막 수정 반영 및 버전 0/버전 1 등록 완료)`);
        setInitialOriginalSubtitles(JSON.parse(JSON.stringify(originalSubtitles)));
        setInitialTranslatedSubtitles(JSON.parse(JSON.stringify(translatedSubtitles)));
      }
    } catch (err: any) {
      console.error('Save Translated Error:', err);
      alert('저장 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveToHistory = async () => {
    if (originalSubtitles.length === 0 || translatedSubtitles.length === 0) {
      alert('저장할 자막 데이터가 없습니다. 먼저 번역을 진행해주세요.');
      return;
    }

    const title = prompt("저장할 작업의 제목을 입력하세요:", projectId ? (projectTitle || "새로운 번역 작업") : "새로운 번역 작업");
    if (!title) return;

    const versionNote = prompt("이번 저장 버전의 설명을 입력하세요 (예: 최종 저장, 다운로드용 등):", "전체 저장");
    if (versionNote === null) return; // 취소

    setIsSaving(true);
    try {
      if (projectId) {
        const newVer = createNewVersion(versionNote, originalSubtitles, translationsCache);
        
        const verDocRef = doc(collection(db, 'subedit_history', projectId, 'versions'), newVer.versionId);
        await setDoc(verDocRef, newVer);

        const docRef = doc(db, 'subedit_history', projectId);
        await updateDoc(docRef, {
          title,
          targetLang,
          originalSubtitles,
          translatedSubtitles,
          translations: translationsCache,
          detectedTranslations: detectedTranslationsCache,
          lastSavedAt: serverTimestamp(),
          versions: [], // clear main document versions field to avoid 1MB limit
          detectedOriginalSubtitles,
          detectedTranslatedSubtitles
        });
        const updatedVersions = [...projectVersions, newVer];
        setProjectVersions(updatedVersions);
        setProjectTitle(title);
        setInitialOriginalSubtitles(JSON.parse(JSON.stringify(originalSubtitles)));
        setInitialTranslatedSubtitles(JSON.parse(JSON.stringify(translatedSubtitles)));
        alert('성공적으로 저장 및 업데이트되었습니다!\n(새 버전 등록 완료)\n이제 우측 상단의 [히스토리 보기] 메뉴에서 자막 파일을 다운로드할 수 있습니다.');
      } else {
        const ver0 = {
          versionId: "ver_0",
          versionName: "버전 0 (최초 감지 원본)",
          originalSubtitles: JSON.parse(JSON.stringify(detectedOriginalSubtitles)),
          translatedSubtitles: [],
          savedAt: new Date().toISOString()
        };
        const ver1 = createNewVersion(versionNote || "최초 저장", originalSubtitles, translationsCache);

        const docRef = await addDoc(collection(db, 'subedit_history'), {
          title,
          targetLang,
          originalSubtitles,
          translatedSubtitles,
          translations: translationsCache,
          detectedTranslations: detectedTranslationsCache,
          createdAt: serverTimestamp(),
          versions: [],
          detectedOriginalSubtitles,
          detectedTranslatedSubtitles
        });
        
        const newProjId = docRef.id;

        const ver0Ref = doc(collection(db, 'subedit_history', newProjId, 'versions'), ver0.versionId);
        await setDoc(ver0Ref, ver0);
        const ver1Ref = doc(collection(db, 'subedit_history', newProjId, 'versions'), ver1.versionId);
        await setDoc(ver1Ref, ver1);

        const updatedVersions = [ver0, ver1];
        setProjectId(newProjId);
        setProjectTitle(title);
        setProjectVersions(updatedVersions);
        setInitialOriginalSubtitles(JSON.parse(JSON.stringify(originalSubtitles)));
        setInitialTranslatedSubtitles(JSON.parse(JSON.stringify(translatedSubtitles)));
        alert('성공적으로 저장되었습니다!\n(최초 버전 및 버전 0 등록 완료)\n이제 우측 상단의 [히스토리 보기] 메뉴에서 자막 파일을 다운로드할 수 있습니다.');
      }
    } catch (err) {
      console.error('Save Error:', err);
      alert('저장 중 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      alert("새 비밀번호와 비밀번호 확인이 일치하지 않습니다.");
      return;
    }
    if (newPassword.length < 6) {
      alert("비밀번호는 최소 6자 이상이어야 합니다.");
      return;
    }
    setPasswordLoading(true);
    try {
      const { updatePassword } = await import("firebase/auth");
      if (auth.currentUser) {
        await updatePassword(auth.currentUser, newPassword);
        alert("비밀번호가 성공적으로 변경되었습니다.");
        setIsSettingsOpen(false);
        setNewPassword("");
        setConfirmPassword("");
      } else {
        alert("인증 오류가 발생했습니다. 다시 로그인해 주세요.");
      }
    } catch (err: any) {
      console.error("Password update error:", err);
      if (err.code === "auth/requires-recent-login") {
        alert("보안을 위해 다시 로그인한 뒤 비밀번호를 변경해 주세요.");
        await logout();
        router.push("/login");
      } else {
        alert("비밀번호 변경 실패: " + err.message);
      }
    } finally {
      setPasswordLoading(false);
    }
  };

  // 비디오 시간 업데이트 감지 및 자막 싱크 맞춤
  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const currentMs = videoRef.current.currentTime * 1000;
    
    // 원본 자막 리스트 싱크
    const activeSub = originalSubtitles.find(sub => {
      const startMs = parseMs(sub.start);
      const endMs = parseMs(sub.end);
      return currentMs >= startMs && currentMs <= endMs;
    });

    if (activeSub && activeSub.id !== activeSubtitleId) {
      setActiveSubtitleId(activeSub.id);
    } else if (!activeSub && activeSubtitleId !== null) {
      setActiveSubtitleId(null);
    }

    // 영상 화면 내 번역 자막 오버레이 업데이트
    const overlaySub = translatedSubtitles.find(sub => {
      const startMs = parseMs(sub.start);
      const endMs = parseMs(sub.end);
      return currentMs >= startMs && currentMs <= endMs;
    });
    
    if (overlaySub && overlaySub.text) {
      if (currentOverlay !== overlaySub.text) {
        setCurrentOverlay(overlaySub.text);
        if (isLiveDubbing) {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(overlaySub.text);
          const langMap: Record<string, string> = { en: 'en-US', zh: 'zh-CN', ja: 'ja-JP', vi: 'vi-VN', my: 'my-MM', bn: 'bn-BD', mn: 'mn-MN' };
          utterance.lang = langMap[targetLangRef.current] || 'en-US';
          utterance.rate = 1.1; // 약간 빠르게 읽어싱크 맞춤
          window.speechSynthesis.speak(utterance);
        }
      }
    } else {
      if (currentOverlay !== null) {
        setCurrentOverlay(null);
      }
    }
  };

  const toggleLiveDubbing = () => {
    setIsLiveDubbing(prev => {
      const next = !prev;
      if (videoRef.current) {
        videoRef.current.muted = next; // 더빙 시 원본 소리 음소거
      }
      if (!next) window.speechSynthesis.cancel();
      return next;
    });
  };

  // 특정 자막 시간으로 비디오 이동
  const seekToSubtitle = (startStr: string) => {
    if (!videoRef.current) return;
    const ms = parseMs(startStr);
    videoRef.current.currentTime = ms / 1000;
    videoRef.current.play().catch(e => console.log('Auto-play prevented', e));
  };

  // 비디오 클리핑 (FFmpeg 컷편집)
  const handleClipVideo = async (startStr: string, endStr: string, index: number) => {
    if (!videoSrc) {
      alert("원본 영상이 없습니다. 영상을 먼저 업로드해주세요.");
      return;
    }
    if (!ffmpegRef.current || !ffmpegRef.current.loaded) {
      alert("FFmpeg 엔진이 로딩 중이거나 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    
    setIsClipping(index);
    try {
      const ffmpeg = ffmpegRef.current;
      const startSec = parseMs(startStr) / 1000;
      const endSec = parseMs(endStr) / 1000;
      let duration = endSec - startSec;
      if (duration < 0.5) duration = 1; // 최소 1초
      
      const outName = `clip_${index}.mp4`;
      
      // -c copy 를 사용하여 인코딩 없이 초고속으로 잘라냅니다. (+1초 패딩 추가)
      await ffmpeg.exec([
        '-ss', String(startSec),
        '-i', 'input.mp4',
        '-t', String(duration + 1),
        '-c', 'copy',
        outName
      ]);
      
      const data = await ffmpeg.readFile(outName);
      const videoBlob = new Blob([data as any], { type: 'video/mp4' });
      const url = URL.createObjectURL(videoBlob);
      
      const a = document.createElement('a');
      a.href = url;
      const filename = `clip_${startStr.replace(/:/g, '')}.mp4`;
      a.download = filename;
      a.click();
      
      setTimeout(() => {
        alert(`다운로드가 완료되었습니다!\n브라우저의 기본 다운로드 폴더를 확인해주세요.\n(파일명: ${filename})`);
      }, 500);
      
      URL.revokeObjectURL(url);
      await ffmpeg.deleteFile(outName); // 메모리 확보
    } catch (e) {
      console.error(e);
      alert("영상 자르기 중 오류가 발생했습니다. 영상을 다시 업로드한 후 시도해보세요.");
    } finally {
      setIsClipping(null);
    }
  };

  // AI 더빙 클리핑 (FFmpeg 컷편집 + TTS 합성)
  const handleDubClipVideo = async (startStr: string, endStr: string, text: string, index: number) => {
    if (!videoSrc) {
      alert("원본 영상이 없습니다. 영상을 먼저 업로드해주세요.");
      return;
    }
    if (!text) {
      alert("번역된 텍스트가 없습니다.");
      return;
    }
    if (!ffmpegRef.current || !ffmpegRef.current.loaded) {
      alert("FFmpeg 엔진이 준비되지 않았습니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    
    setIsClipping(index);
    setProgressMsg('AI 더빙 생성 중...');
    try {
      const ffmpeg = ffmpegRef.current;
      const startSec = parseMs(startStr) / 1000;
      const endSec = parseMs(endStr) / 1000;
      let duration = endSec - startSec;
      if (duration < 0.5) duration = 1;
      
      // 1. TTS 오디오 가져오기
      const ttsResponse = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, targetLanguage: targetLang })
      });
      
      if (!ttsResponse.ok) throw new Error("TTS 생성 실패");
      
      const ttsBlob = await ttsResponse.blob();
      const ttsArrayBuffer = await ttsBlob.arrayBuffer();
      const ttsUint8Array = new Uint8Array(ttsArrayBuffer);
      
      await ffmpeg.writeFile('tts.mp3', ttsUint8Array);
      
      const outName = `dub_clip_${index}.mp4`;
      
      setProgressMsg('영상과 음성 합성 중...');
      
      // 2. FFmpeg 합성
      // 영상은 startSec에서 duration 만큼 자르고 (원본 영상 오디오는 무시: -map 0:v -map 1:a)
      // tts.mp3를 합칩니다.
      await ffmpeg.exec([
        '-ss', String(startSec),
        '-i', 'input.mp4',
        '-i', 'tts.mp3',
        '-t', String(duration),
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        outName
      ]);
      
      const data = await ffmpeg.readFile(outName);
      const videoBlob = new Blob([data as any], { type: 'video/mp4' });
      const url = URL.createObjectURL(videoBlob);
      
      const a = document.createElement('a');
      a.href = url;
      const filename = `dub_${startStr.replace(/:/g, '')}.mp4`;
      a.download = filename;
      a.click();
      
      setTimeout(() => {
        alert(`AI 더빙 클립 영상이 저장되었습니다!\n브라우저의 기본 다운로드 폴더를 확인해주세요.\n(파일명: ${filename})`);
      }, 500);
      
      URL.revokeObjectURL(url);
      await ffmpeg.deleteFile(outName);
      await ffmpeg.deleteFile('tts.mp3');
    } catch (e) {
      console.error(e);
      alert("AI 더빙 클립 생성 중 오류가 발생했습니다.");
    } finally {
      setIsClipping(null);
      setProgressMsg('');
    }
  };

  // 다국어 클립 병합 (Concat)
  const handleMergeSelectedClips = async () => {
    if (!videoSrc || selectedSubtitles.size === 0) return;
    if (!ffmpegRef.current || !ffmpegRef.current.loaded) {
      alert("FFmpeg 엔진이 로딩 중이거나 아직 준비되지 않았습니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    
    setIsMerging(true);
    setProgressMsg('선택된 구간 병합 중...');
    try {
      const ffmpeg = ffmpegRef.current;
      
      // 원래 시간에 따라 오름차순 정렬
      const sortedSubs = originalSubtitles.filter(s => selectedSubtitles.has(s.id));
      let fileList = '';
      
      for (let i = 0; i < sortedSubs.length; i++) {
        const sub = sortedSubs[i];
        const startSec = parseMs(sub.start) / 1000;
        const endSec = parseMs(sub.end) / 1000;
        let duration = endSec - startSec;
        if (duration < 0.5) duration = 1;
        
        const chunkName = `chunk_merge_${i}.mp4`;
        setProgressMsg(`병합 준비 중: [${i + 1}/${sortedSubs.length}]`);
        await ffmpeg.exec([
          '-ss', String(startSec),
          '-i', 'input.mp4',
          '-t', String(duration + 1),
          '-c', 'copy',
          chunkName
        ]);
        
        fileList += `file '${chunkName}'\n`;
      }
      
      // concat 프로토콜을 위한 list.txt 작성
      setProgressMsg(`파일 이어 붙이는 중...`);
      await ffmpeg.writeFile('list.txt', fileList);
      
      // concat 실행
      await ffmpeg.exec([
        '-f', 'concat',
        '-safe', '0',
        '-i', 'list.txt',
        '-c', 'copy',
        'merged_output.mp4'
      ]);
      
      const data = await ffmpeg.readFile('merged_output.mp4');
      const videoBlob = new Blob([data as any], { type: 'video/mp4' });
      const url = URL.createObjectURL(videoBlob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `merged_clips.mp4`;
      a.click();
      
      setTimeout(() => {
        alert(`다중 클립 병합 다운로드가 완료되었습니다!\n브라우저의 기본 다운로드 폴더를 확인해주세요.\n(파일명: merged_clips.mp4)`);
      }, 500);
      
      URL.revokeObjectURL(url);
      
      // 메모리 클린업
      await ffmpeg.deleteFile('list.txt');
      await ffmpeg.deleteFile('merged_output.mp4');
      for (let i = 0; i < sortedSubs.length; i++) {
        await ffmpeg.deleteFile(`chunk_merge_${i}.mp4`);
      }
    } catch (e) {
      console.error(e);
      alert("병합 중 오류가 발생했습니다. 영상을 다시 업로드한 후 시도해보세요.");
    } finally {
      setIsMerging(false);
      setProgressMsg('');
      setSelectedSubtitles(new Set()); // 선택 초기화
    }
  };

  // 수동 컷편집
  const handleManualClip = async () => {
    if (!videoSrc) {
      alert("원본 영상이 없습니다. 영상을 먼저 업로드해주세요.");
      return;
    }
    if (!ffmpegRef.current || !ffmpegRef.current.loaded) {
      alert("FFmpeg 엔진이 준비되지 않았습니다.");
      return;
    }
    
    setIsManualClipping(true);
    try {
      const ffmpeg = ffmpegRef.current;
      const startSec = parseMs(manualClipStart) / 1000;
      const endSec = parseMs(manualClipEnd) / 1000;
      let duration = endSec - startSec;
      
      if (duration <= 0) {
        alert("종료 시간이 시작 시간보다 커야 합니다.");
        return;
      }
      
      const outName = `manual_clip.mp4`;
      
      await ffmpeg.exec([
        '-ss', String(startSec),
        '-i', 'input.mp4',
        '-t', String(duration),
        '-c', 'copy',
        outName
      ]);
      
      const data = await ffmpeg.readFile(outName);
      const videoBlob = new Blob([data as any], { type: 'video/mp4' });
      const url = URL.createObjectURL(videoBlob);
      
      const a = document.createElement('a');
      a.href = url;
      const filename = `clip_${manualClipStart.replace(/:/g, '')}_to_${manualClipEnd.replace(/:/g, '')}.mp4`;
      a.download = filename;
      a.click();
      
      setTimeout(() => {
        alert(`수동 시간 클리핑 영상이 저장되었습니다!\n브라우저의 기본 다운로드 폴더를 확인해주세요.\n(파일명: ${filename})`);
      }, 500);
      
      URL.revokeObjectURL(url);
      await ffmpeg.deleteFile(outName);
      setIsManualClipOpen(false);
    } catch (e) {
      console.error(e);
      alert("수동 자르기 중 오류가 발생했습니다.");
    } finally {
      setIsManualClipping(false);
    }
  };

  // 전체 영상 자막 내장 다운로드 (Softsub)
  const handleDownloadFullVideoWithSubs = async () => {
    if (!videoSrc) {
      alert("원본 영상이 없습니다.");
      return;
    }
    if (translatedSubtitles.length === 0) {
      alert("번역된 자막이 없습니다. 먼저 번역을 진행해주세요.");
      return;
    }
    if (!ffmpegRef.current || !ffmpegRef.current.loaded) {
      alert("FFmpeg 엔진이 아직 준비되지 않았습니다.");
      return;
    }

    setIsFullDownloading(true);
    setProgressMsg('전체 영상 자막 병합 중... (Softsub)');
    
    try {
      const ffmpeg = ffmpegRef.current;
      
      // 1. SRT 파일 내용 생성
      const formatSrtTime = (timeStr: string) => {
        const parts = timeStr.split(':');
        let h = '00', m = '00', s = '00';
        if (parts.length === 2) {
          m = parts[0].padStart(2, '0');
          s = parts[1].padStart(2, '0');
        } else if (parts.length === 3) {
          h = parts[0].padStart(2, '0');
          m = parts[1].padStart(2, '0');
          s = parts[2].padStart(2, '0');
        }
        return `${h}:${m}:${s},000`;
      };

      const srtContent = translatedSubtitles.map((sub, index) => {
        return `${index + 1}\n${formatSrtTime(sub.start)} --> ${formatSrtTime(sub.end)}\n${sub.text}\n`;
      }).join('\n');

      // 2. FFmpeg 메모리에 SRT 파일 쓰기
      await ffmpeg.writeFile('subs.srt', srtContent);

      const outName = 'full_video_with_subs.mp4';
      
      // 3. 인코딩 없이 소프트서브 자막 트랙 추가 (mov_text 포맷 사용)
      // -disposition:s:0 default 를 추가하여 플레이어에서 자막이 기본적으로 켜지도록 강제합니다.
      await ffmpeg.exec([
        '-i', 'input.mp4',
        '-i', 'subs.srt',
        '-c', 'copy',
        '-c:s', 'mov_text',
        '-metadata:s:s:0', 'language=kor',
        '-disposition:s:0', 'default',
        outName
      ]);

      const data = await ffmpeg.readFile(outName);
      const videoBlob = new Blob([data as any], { type: 'video/mp4' });
      const url = URL.createObjectURL(videoBlob);
      
      const a = document.createElement('a');
      a.href = url;
      const filename = `unicon_translated_${Date.now()}.mp4`;
      a.download = filename;
      a.click();
      
      setTimeout(() => {
        alert(`자막 포함 전체 영상이 저장되었습니다!\n브라우저의 기본 다운로드 폴더를 확인해주세요.\n(파일명: ${filename})`);
      }, 500);
      
      URL.revokeObjectURL(url);
      await ffmpeg.deleteFile('subs.srt');
      await ffmpeg.deleteFile(outName);
      
    } catch (e) {
      console.error(e);
      alert("영상 자막 병합 중 오류가 발생했습니다. 개발자 도구의 콘솔을 확인해주세요.");
    } finally {
      setIsFullDownloading(false);
      setProgressMsg('');
    }
  };

  // 활성화된 자막으로 자동 스크롤
  useEffect(() => {
    if (activeSubtitleId !== null) {
      const origEl = document.getElementById(`orig-${activeSubtitleId}`);
      if (origEl && originalListRef.current) {
        origEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      const transEl = document.getElementById(`trans-${activeSubtitleId}`);
      if (transEl && translatedListRef.current) {
        transEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [activeSubtitleId]);

  // 실시간 캡션 제어 로직
  const toggleLiveCaption = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      setInterimText('');
    } else {
      startLiveCaption();
    }
  };

  const startLiveCaption = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('이 브라우저에서는 실시간 음성 인식을 지원하지 않습니다. Chrome 브라우저를 권장합니다.');
      return;
    }

    if (!recognitionRef.current) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onresult = async (event: any) => {
        let interimTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            const finalTranscript = event.results[i][0].transcript;
            const newId = Date.now() + i; // 고유 ID 보장
            
            setLiveOriginalTexts(prev => {
              const next = [...prev, { id: newId, text: finalTranscript }];
              return next.slice(-50); // 메모리 최적화를 위해 최근 50개 유지
            });

            // 바로 번역 API 호출
            try {
              const response = await fetch('/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  subtitles: [{ id: newId, start: '0', end: '0', text: finalTranscript }],
                  targetLanguage: targetLangRef.current, // 클로저 이슈 방지
                }),
              });
              const result = await response.json();
              if (result.translatedSubtitles && result.translatedSubtitles[0]) {
                setLiveTranslatedTexts(prev => {
                  const next = [...prev, { id: newId, text: result.translatedSubtitles[0].text }];
                  return next.slice(-50); // 메모리 최적화를 위해 최근 50개 유지
                });
              }
            } catch (err) {
              console.error('Live Translation Error:', err);
            }
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }
        
        setInterimText(interimTranscript);
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error', event.error);
        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
          setIsListening(false);
          alert('마이크 권한이 없거나 지원되지 않습니다.');
        }
        // 'no-speech' 등 일시적 에러는 무시하고 onend에서 재시작되도록 함
      };

      recognition.onend = () => {
        if (isListeningRef.current) {
          recognition.lang = sourceLangRef.current;
          try {
            recognition.start(); // 계속 듣기
          } catch(e) {
            console.error('Speech recognition restart error', e);
          }
        }
      };

      recognitionRef.current = recognition;
    }

    recognitionRef.current.lang = sourceLangRef.current;
    recognitionRef.current.start();
    setIsListening(true);
  };

  const togglePlay = () => {
    if (videoRef.current) {
      if (isPlaying) videoRef.current.pause();
      else videoRef.current.play();
      setIsPlaying(!isPlaying);
    }
  };

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

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-900 font-sans">
      {/* Top Navigation */}
      <header className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 shadow-sm z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center shadow-sm">
            <span className="text-white font-black text-lg">U</span>
          </div>
          <h1 className="text-xl font-black tracking-tight text-purple-700">UNICON Creator</h1>
          {projectId && (
            <div className="flex items-center gap-2 ml-4 pl-4 border-l border-gray-300">
              <span className="text-sm font-bold text-gray-700 bg-gray-100 px-2.5 py-1 rounded-md max-w-[200px] truncate" title={projectTitle || '작업'}>
                {projectTitle}
              </span>
              <button 
                onClick={() => setIsVersionsOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors shadow-sm active:scale-95 cursor-pointer"
              >
                버전 기록 ({projectVersions.length})
              </button>
            </div>
          )}
        </div>
        
        <div className="flex items-center gap-3">
          {/* User Profile & Auth controls */}
          <div className="flex items-center gap-3 pr-3 border-r border-gray-200 mr-2">
            <span className="text-xs text-gray-600 bg-gray-100 px-2.5 py-1 rounded font-medium">
              {user?.email} ({userRole === "ADMIN" ? "관리자" : "일반 유저"})
            </span>
            {userRole === 'ADMIN' && (
              <Link href="/admin/users" className="text-xs font-bold text-red-650 hover:underline">
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

          <Link href="/history" className="text-sm font-semibold text-gray-600 hover:text-blue-600 mr-2 transition-colors">
            히스토리 보기
          </Link>


          <button 
            onClick={() => setIsLiveMode(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            <Mic size={16} /> 실시간 캡션
          </button>
          
          <button 
            onClick={handleDownloadFullVideoWithSubs}
            disabled={!videoSrc || isFullDownloading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-md hover:bg-blue-100 transition-colors disabled:opacity-50"
            title="소프트서브(Softsub) 방식으로 자막을 영상 트랙에 내장하여 다운로드합니다"
          >
            {isFullDownloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} 
            전체 영상 다운로드
          </button>
          
          <button 
            onClick={() => {
              if (translatedSubtitles.length === 0) {
                alert("번역된 자막이 없습니다.");
                return;
              }
              const formatSrtTime = (timeStr: string) => {
                const parts = timeStr.split(':');
                let h = '00', m = '00', s = '00';
                if (parts.length === 2) {
                  m = parts[0].padStart(2, '0');
                  s = parts[1].padStart(2, '0');
                } else if (parts.length === 3) {
                  h = parts[0].padStart(2, '0');
                  m = parts[1].padStart(2, '0');
                  s = parts[2].padStart(2, '0');
                }
                return `${h}:${m}:${s},000`;
              };
              const srtContent = translatedSubtitles.map((sub, index) => {
                return `${index + 1}\n${formatSrtTime(sub.start)} --> ${formatSrtTime(sub.end)}\n${sub.text}\n`;
              }).join('\n');
              const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `subtitle_${Date.now()}.srt`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-green-700 bg-green-50 border border-green-200 rounded-md hover:bg-green-100 transition-colors"
            title="SRT 자막 파일만 따로 다운로드합니다"
          >
            <Download size={16} /> SRT 다운로드
          </button>

          <button 
            onClick={() => setIsQuizEditorOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-bold text-white bg-purple-600 border border-purple-700 rounded-md hover:bg-purple-700 transition-colors shadow-sm"
            title="원본 영상을 기반으로 AI가 시험지/퀴즈를 출제합니다"
          >
            <BookOpen size={16} /> 시험지(퀴즈) 출제
          </button>

          <button 
            onClick={() => setIsManualClipOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            <Scissors size={16} /> 수동 컷편집
          </button>
          
          <input 
            type="file" 
            accept="video/*,.smi,.srt" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            className="hidden" 
          />
          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessing}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-md transition-colors ${isProcessing ? 'bg-blue-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} 
            {isProcessing ? progressMsg : '파일 업로드'}
          </button>
          
          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors cursor-pointer"
            title="계정 및 비밀번호 변경 설정"
          >
            <Settings size={20} />
          </button>
        </div>
      </header>

      {/* 수동 컷편집 팝업 폼 */}
      {isManualClipOpen && (
        <div className="bg-white border-b border-gray-200 p-4 shadow-sm z-10 flex flex-wrap items-center justify-center gap-4">
          <span className="text-sm font-bold text-gray-700">수동 시간 클리핑</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 font-semibold">시작</span>
            <input 
              type="text" 
              value={manualClipStart}
              onChange={(e) => setManualClipStart(e.target.value)}
              placeholder="00:00:00"
              className="px-2 py-1 border rounded w-24 text-sm font-mono text-center outline-none focus:border-blue-400"
            />
          </div>
          <span className="text-gray-400">~</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 font-semibold">종료</span>
            <input 
              type="text" 
              value={manualClipEnd}
              onChange={(e) => setManualClipEnd(e.target.value)}
              placeholder="00:00:10"
              className="px-2 py-1 border rounded w-24 text-sm font-mono text-center outline-none focus:border-blue-400"
            />
          </div>
          <button 
            onClick={handleManualClip}
            disabled={isManualClipping}
            className="flex items-center gap-2 px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {isManualClipping ? <Loader2 size={16} className="animate-spin" /> : <Scissors size={16} />}
            잘라내기
          </button>
          <button 
            onClick={() => setIsManualClipOpen(false)}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-md hover:bg-gray-100"
          >
            <X size={18} />
          </button>
        </div>
      )}

      {/* Main Workspace (Split Pane) */}
      <main className="flex-1 flex flex-col overflow-hidden">
        
        {/* Top Pane: Video Player */}
        <section className="flex-none h-[60vh] bg-[#1a1b26] border-b border-gray-300 relative flex flex-col items-center justify-center p-4">
          {!videoSrc ? (
            originalSubtitles.length > 0 ? (
              <div 
                onDragOver={handleDragOver}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`w-full h-full border-2 border-dashed rounded-xl flex flex-col items-center justify-center p-6 text-center transition-all duration-200
                  ${isDragging 
                    ? 'border-blue-500 bg-blue-500/10 scale-[0.98]' 
                    : 'border-blue-500/30 bg-blue-950/10'}`}
              >
                <div className="bg-blue-500/15 p-4 rounded-full mb-4">
                  <Languages size={48} className="text-blue-400" />
                </div>
                <h3 className="text-xl font-bold text-white mb-2">자막 파일 전용 편집 모드</h3>
                <p className="text-sm text-gray-400 max-w-md mb-4">
                  영상 없이 자막 파일만 업로드되었습니다. 아래 목록에서 원본 자막을 편집하고 다국어 번역을 진행할 수 있습니다.
                </p>
                <div className="bg-gray-800/50 px-4 py-2 rounded-lg text-xs font-mono text-gray-300 mb-6 flex items-center gap-4">
                  <span>파일명: <strong className="text-blue-350">{projectTitle || '무제'}</strong></span>
                  <span className="w-px h-3 bg-gray-600"></span>
                  <span>구간 개수: <strong className="text-blue-350">{originalSubtitles.length}개</strong></span>
                </div>
                <div className="flex gap-3">
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isProcessing}
                    className="px-5 py-2.5 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 flex items-center gap-2 border border-gray-700 text-sm shadow-sm"
                  >
                    <Upload size={16} /> 다른 파일 업로드
                  </button>
                  <button 
                    onClick={handleTranslate}
                    disabled={isTranslating}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold transition-colors disabled:opacity-50 flex items-center gap-2 text-sm shadow-md"
                  >
                    {isTranslating ? <Loader2 size={16} className="animate-spin" /> : <Languages size={16} />}
                    {isTranslating ? 'AI 번역 중...' : '다국어 AI 번역 시작'}
                  </button>
                </div>
              </div>
            ) : (
              <div 
                onDragOver={handleDragOver}
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`w-full h-full border-2 border-dashed rounded-xl flex flex-col items-center justify-center transition-all duration-200
                  ${isDragging 
                    ? 'border-blue-500 bg-blue-500/10 scale-[0.98]' 
                    : 'border-gray-600 bg-gray-800/30'}`}
              >
                <Upload size={48} className={`mb-4 transition-colors ${isDragging ? 'text-blue-400' : 'text-gray-500'}`} />
                <p className={`font-medium mb-2 transition-colors ${isDragging ? 'text-blue-300' : 'text-gray-400'}`}>편집할 영상 또는 SMI/SRT 자막 파일을 드래그 앤 드롭하거나 선택하세요</p>
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isProcessing}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 flex items-center gap-2 mt-2"
                >
                  {isProcessing ? <Loader2 size={18} className="animate-spin" /> : null}
                  {isProcessing ? '처리 중...' : '파일 업로드'}
                </button>
              </div>
            )
          ) : (
            <div className="relative w-full h-full flex flex-col bg-black rounded-lg overflow-hidden shadow-inner group">
              {/* 영상 영역 */}
              <div className="flex-1 flex items-center justify-center min-h-0 bg-black relative">
                <video 
                  ref={videoRef}
                  src={videoSrc}
                  className="max-h-full max-w-full object-contain"
                  controls
                  onTimeUpdate={handleTimeUpdate}
                />
              </div>
              
              {/* 하단 자막 전용 영역 (블랙 바) */}
              <div className="h-12 sm:h-14 bg-[#0f0f0f] border-t border-gray-800 flex items-center justify-center px-4 md:px-8 shadow-[inset_0_4px_10px_rgba(0,0,0,0.5)] z-10 shrink-0">
                <div className="text-white text-base sm:text-lg md:text-xl font-bold tracking-wide text-center leading-snug drop-shadow-md transition-opacity duration-150">
                  {currentOverlay || <span className="opacity-0">자막 대기중</span>}
                </div>
              </div>
            </div>
          )}

          {/* Processing Overlay */}
          {isProcessing && (
            <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-20 backdrop-blur-sm">
              <Loader2 size={40} className="text-blue-500 animate-spin mb-4" />
              <div className="text-blue-400 font-bold tracking-wide">{progressMsg}</div>
            </div>
          )}
        </section>

        {/* Bottom Pane: Split Subtitles */}
        <section className="flex-1 flex overflow-hidden bg-gray-50">
          
          {/* Left Pane: Original Subtitles */}
          <div className="flex flex-col w-1/2 border-r border-gray-200 bg-white shadow-sm z-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500"></span>
                  원본 자막 (자동 감지)
                </h2>
              </div>
              <div className="flex items-center gap-2">
                {selectedSubtitles.size > 0 && (
                  <button
                    onClick={handleMergeSelectedClips}
                    disabled={isMerging}
                    className="text-xs font-semibold px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors flex items-center gap-1"
                  >
                    {isMerging ? <Loader2 size={14} className="animate-spin" /> : <Combine size={14} />}
                    선택된 {selectedSubtitles.size}개 구간 병합
                  </button>
                )}
                <button
                  onClick={handleSaveOriginal}
                  disabled={isSaving || originalSubtitles.length === 0}
                  className="text-xs font-bold px-3 py-1.5 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50 transition-all flex items-center gap-1.5 shadow-sm active:scale-95"
                >
                  <Upload size={13} />
                  원본 저장 {getModifiedOriginalCount() > 0 ? `(총 ${getModifiedOriginalCount()}개 수정됨)` : ""}
                </button>
                <button
                  onClick={handleResetOriginal}
                  disabled={originalSubtitles.length === 0}
                  className="text-xs font-bold px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50 transition-all flex items-center gap-1 shadow-sm active:scale-95"
                  title="원본 자막을 최초 불러온 상태로 되돌립니다."
                >
                  초기화
                </button>
                {projectVersions.length > 0 && (
                  <select
                    onChange={(e) => {
                      const verId = e.target.value;
                      if (!verId) return;
                      const selectedVer = projectVersions.find(v => v.versionId === verId);
                      if (selectedVer) {
                        if (confirm(`"${selectedVer.versionName}" 버전을 작업공간으로 불러오시겠습니까?\n(현재 작업 중인 내용은 이 버전으로 덮어씌워집니다.)`)) {
                          const verTranslations = selectedVer.translations || {};
                          if (Object.keys(verTranslations).length === 0 && selectedVer.translatedSubtitles) {
                            verTranslations[targetLang] = selectedVer.translatedSubtitles;
                          }
                          
                          setOriginalSubtitles(JSON.parse(JSON.stringify(selectedVer.originalSubtitles || [])));
                          setInitialOriginalSubtitles(JSON.parse(JSON.stringify(selectedVer.originalSubtitles || [])));
                          
                          setTranslationsCache(JSON.parse(JSON.stringify(verTranslations)));
                          
                          const activeTrans = verTranslations[targetLang] || [];
                          setTranslatedSubtitles(JSON.parse(JSON.stringify(activeTrans)));
                          setInitialTranslatedSubtitles(JSON.parse(JSON.stringify(activeTrans)));
                          alert(`"${selectedVer.versionName}" 버전을 성공적으로 불러왔습니다.`);
                        }
                      }
                      e.target.value = "";
                    }}
                    className="text-xs font-bold px-2 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 outline-none cursor-pointer shadow-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">버전 불러오기</option>
                    {[...projectVersions].reverse().map((ver, idx) => {
                      const dateStr = ver.savedAt ? new Date(ver.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                      return (
                        <option key={ver.versionId || idx} value={ver.versionId}>
                          {ver.versionName} {dateStr ? `(${dateStr})` : ''}
                        </option>
                      );
                    })}
                  </select>
                )}
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-3" ref={originalListRef}>
              {originalSubtitles.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-gray-400">
                  영상을 업로드하면 AI가 자막을 생성합니다.
                </div>
              ) : (
                originalSubtitles.map((sub) => {
                  const isActive = sub.id === activeSubtitleId;
                  const isChecked = selectedSubtitles.has(sub.id);
                  const isMod = isOriginalModified(sub.id, sub.text);
                  return (
                    <div 
                      key={sub.id} 
                      id={`orig-${sub.id}`}
                      className={`flex gap-3 p-3 rounded-lg border transition-all shadow-sm group focus-within:ring-2 focus-within:ring-blue-400
                        ${isActive 
                          ? 'bg-blue-50 border-blue-300 ring-1 ring-blue-200' 
                          : isMod 
                            ? 'bg-amber-50/30 border-amber-200 hover:border-amber-300' 
                            : 'bg-white border-transparent hover:border-gray-200'}
                        ${isChecked ? 'border-blue-400 bg-blue-50' : ''}`}
                    >
                      <div className="flex flex-col items-center justify-start pt-2">
                        <input 
                          type="checkbox" 
                          checked={isChecked}
                          onChange={(e) => {
                            const newSet = new Set(selectedSubtitles);
                            if (e.target.checked) newSet.add(sub.id);
                            else newSet.delete(sub.id);
                            setSelectedSubtitles(newSet);
                          }}
                          className="w-4 h-4 cursor-pointer accent-blue-600"
                        />
                      </div>
                      <div 
                        onClick={() => seekToSubtitle(sub.start)}
                        title="클릭 시 이 시간으로 영상 이동"
                        className={`flex flex-col items-center justify-start pt-1 text-xs font-mono gap-1 w-12 shrink-0 cursor-pointer hover:scale-105 transition-transform ${isActive ? 'text-blue-600 font-bold' : 'text-gray-400 opacity-50 hover:opacity-100 hover:text-blue-500'}`}
                      >
                        <span className="hover:underline">{sub.start}</span>
                      </div>
                      <textarea 
                        className={`flex-1 w-full bg-transparent resize-none outline-none text-[15px] leading-relaxed min-h-[44px] 
                          ${isActive ? 'text-blue-900 font-medium' : 'text-gray-800'}
                          ${isMod ? 'font-bold text-amber-900' : ''}`}
                        value={sub.text}
                        onChange={(e) => handleOriginalSubtitleEdit(sub.id, e.target.value)}
                        rows={2}
                      />
                      <button
                        onClick={() => handleClipVideo(sub.start, sub.end, sub.id)}
                        disabled={isClipping !== null}
                        title="이 구간 영상 자르기 (초고속 다운로드)"
                        className={`shrink-0 p-2 rounded-md transition-colors h-fit mt-1
                          ${isClipping === sub.id ? 'bg-blue-100 text-blue-600' : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'}`}
                      >
                        {isClipping === sub.id ? <Loader2 size={16} className="animate-spin" /> : <Scissors size={16} />}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Pane: Translation Editor & Quiz Generator */}
          <div className="flex flex-col w-1/2 bg-white z-0 relative">
            {/* Translation Tab Content */}
            <div className={`flex-col h-full overflow-hidden flex print:hidden`}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50 shadow-sm">
              <div className="flex items-center gap-3">
                <Languages size={18} className="text-blue-600" />
                <select 
                  value={targetLang}
                  onChange={(e) => {
                    const newLang = e.target.value;
                    setTargetLang(newLang);
                    
                    // 캐시된 자막이 있으면 즉시 불러오고, 없으면 빈 배열로 초기화 (자동으로 '번역' 버튼을 유도)
                    if (translationsCache[newLang]) {
                      setTranslatedSubtitles(translationsCache[newLang]);
                    } else {
                      setTranslatedSubtitles([]);
                    }

                    if (detectedTranslationsCache[newLang]) {
                      setDetectedTranslatedSubtitles(detectedTranslationsCache[newLang]);
                    } else {
                      setDetectedTranslatedSubtitles([]);
                    }
                  }}
                  className="text-sm font-bold text-gray-800 bg-transparent outline-none cursor-pointer border-b border-dashed border-gray-400 pb-0.5"
                >
                  <option value="ko">한국어 (Korean)</option>
                  <option value="en">영어 (English)</option>
                  <option value="zh">중국어 (中文)</option>
                  <option value="ja">일본어 (日本語)</option>
                  <option value="vi">베트남어 (Tiếng Việt)</option>
                  <option value="my">미얀마어 (မြန်မာစာ)</option>
                  <option value="bn">벵골어 (বাংলা)</option>
                  <option value="mn">몽골어 (Mongolian)</option>
                </select>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button 
                  onClick={handleTranslate}
                  disabled={isTranslating}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded transition-colors ${isTranslating ? 'text-gray-400 border-gray-200 bg-gray-50' : 'text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100'}`}
                >
                  {isTranslating && <Loader2 size={14} className="animate-spin" />}
                  {isTranslating ? translateProgressMsg : 'AI 전체 번역'}
                </button>
                <div className="w-px h-4 bg-gray-300 mx-1" />
                <button
                  onClick={handleSaveTranslated}
                  disabled={isSaving || translatedSubtitles.length === 0}
                  className="text-xs font-bold px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-all flex items-center gap-1.5 shadow-sm active:scale-95"
                >
                  <Upload size={13} />
                  번역 저장 {getModifiedTranslatedCount() > 0 ? `(총 ${getModifiedTranslatedCount()}개 수정됨)` : ""}
                </button>
                <button
                  onClick={handleResetTranslated}
                  disabled={translatedSubtitles.length === 0}
                  className="text-xs font-bold px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 disabled:opacity-50 transition-all flex items-center gap-1 shadow-sm active:scale-95"
                  title="번역 자막을 최초 불러온 상태로 되돌립니다."
                >
                  초기화
                </button>
                <div className="w-px h-4 bg-gray-300 mx-1" />
                <button 
                  onClick={handleSaveToHistory}
                  disabled={isSaving}
                  className={`px-3 py-1.5 text-xs font-medium border rounded transition-colors ${isSaving ? 'text-gray-400 border-gray-200 bg-gray-50' : 'text-white bg-gray-850 border-gray-850 hover:bg-gray-750'}`}
                >
                  {isSaving ? '저장 중...' : '전체 저장 (SRT/SMI)'}
                </button>
                {projectVersions.length > 0 && (
                  <>
                    <div className="w-px h-4 bg-gray-300 mx-1" />
                    <select
                      onChange={(e) => {
                        const verId = e.target.value;
                        if (!verId) return;
                        const selectedVer = projectVersions.find(v => v.versionId === verId);
                        if (selectedVer) {
                          if (confirm(`"${selectedVer.versionName}" 버전을 작업공간으로 불러오시겠습니까?\n(현재 작업 중인 내용은 이 버전으로 덮어씌워집니다.)`)) {
                            const verTranslations = selectedVer.translations || {};
                            if (Object.keys(verTranslations).length === 0 && selectedVer.translatedSubtitles) {
                              verTranslations[targetLang] = selectedVer.translatedSubtitles;
                            }
                            
                            setOriginalSubtitles(JSON.parse(JSON.stringify(selectedVer.originalSubtitles || [])));
                            setInitialOriginalSubtitles(JSON.parse(JSON.stringify(selectedVer.originalSubtitles || [])));
                            
                            setTranslationsCache(JSON.parse(JSON.stringify(verTranslations)));
                            
                            const activeTrans = verTranslations[targetLang] || [];
                            setTranslatedSubtitles(JSON.parse(JSON.stringify(activeTrans)));
                            setInitialTranslatedSubtitles(JSON.parse(JSON.stringify(activeTrans)));
                            alert(`"${selectedVer.versionName}" 버전을 성공적으로 불러왔습니다.`);
                          }
                        }
                        e.target.value = "";
                      }}
                      className="text-xs font-bold px-2 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50 outline-none cursor-pointer shadow-sm focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">버전 불러오기</option>
                      {[...projectVersions].reverse().map((ver, idx) => {
                        const dateStr = ver.savedAt ? new Date(ver.savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                        return (
                          <option key={ver.versionId || idx} value={ver.versionId}>
                            {ver.versionName} {dateStr ? `(${dateStr})` : ''}
                          </option>
                        );
                      })}
                    </select>
                  </>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3" ref={translatedListRef}>
              {translatedSubtitles.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-gray-400 flex-col gap-2">
                  <Languages size={32} className="text-gray-300 mb-2" />
                  <p>원본 자막을 생성한 뒤 'AI 전체 번역' 버튼을 눌러주세요.</p>
                </div>
              ) : (
                translatedSubtitles.map((sub) => {
                  const isActive = sub.id === activeSubtitleId;
                  const isChecked = selectedSubtitles.has(sub.id);
                  const isMod = isTranslatedModified(sub.id, sub.text);
                  return (
                    <div 
                      key={sub.id} 
                      id={`trans-${sub.id}`}
                      className={`flex gap-3 p-3 rounded-lg border transition-all shadow-sm group focus-within:ring-2 focus-within:ring-green-400
                        ${isActive 
                          ? 'bg-green-50 border-green-300 ring-1 ring-green-200' 
                          : isMod 
                            ? 'bg-amber-50/30 border-amber-200 hover:border-amber-300' 
                            : 'bg-white border-transparent hover:border-gray-200'}
                        ${isChecked ? 'border-blue-400 bg-blue-50' : ''}`}
                    >
                      <div className="flex flex-col items-center justify-start pt-2">
                        <input 
                          type="checkbox" 
                          checked={isChecked}
                          onChange={(e) => {
                            const newSet = new Set(selectedSubtitles);
                            if (e.target.checked) newSet.add(sub.id);
                            else newSet.delete(sub.id);
                            setSelectedSubtitles(newSet);
                          }}
                          className="w-4 h-4 cursor-pointer accent-blue-600"
                        />
                      </div>
                      <div 
                        onClick={() => seekToSubtitle(sub.start)}
                        title="클릭 시 이 시간으로 영상 이동"
                        className={`flex flex-col items-center justify-start pt-1 text-xs font-mono gap-1 w-12 shrink-0 cursor-pointer hover:scale-105 transition-transform ${isActive ? 'text-blue-600 font-bold' : 'text-gray-400 opacity-50 hover:opacity-100 hover:text-blue-500'}`}
                      >
                        <span className="hover:underline">{sub.start}</span>
                      </div>
                      <textarea 
                        className={`flex-1 w-full bg-transparent resize-none outline-none text-[15px] leading-relaxed min-h-[44px] 
                          ${isActive ? 'text-blue-900 font-medium' : 'text-gray-800'}
                          ${isMod ? 'font-bold text-amber-900' : ''}`}
                        value={sub.text}
                        onChange={(e) => handleSubtitleEdit(sub.id, e.target.value)}
                        rows={2}
                      />
                      <div className="flex gap-1 mt-1 shrink-0 h-fit">
                        <button
                          onClick={() => handleClipVideo(sub.start, sub.end, sub.id)}
                          disabled={isClipping !== null}
                          title="이 구간 영상 자르기 (원본 음성)"
                          className={`p-2 rounded-md transition-colors
                            ${isClipping === sub.id ? 'bg-blue-100 text-blue-600' : 'text-gray-400 hover:text-blue-600 hover:bg-blue-50'}`}
                        >
                          {isClipping === sub.id ? <Loader2 size={16} className="animate-spin" /> : <Scissors size={16} />}
                        </button>
                        <button
                          onClick={() => handleDubClipVideo(sub.start, sub.end, sub.text, sub.id)}
                          disabled={isClipping !== null}
                          title="이 구간 AI 더빙 추출 (번역된 음성 입히기)"
                          className={`p-2 rounded-md transition-colors
                            ${isClipping === sub.id ? 'bg-purple-100 text-purple-600' : 'text-gray-400 hover:text-purple-600 hover:bg-purple-50'}`}
                        >
                          {isClipping === sub.id ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            {/* Translation Tab Content 끝 */}
            </div>


          </div>
        </section>

      </main>

      {/* 시험지(퀴즈) 출제 모달 */}
      {isQuizEditorOpen && (
        <div className="fixed inset-0 bg-black/60 z-[40] flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-xl shadow-xl w-[95vw] max-w-[1400px] h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center gap-3">
                <BookOpen size={24} className="text-purple-600" />
                <h2 className="text-xl font-black text-gray-800">AI 시험지 자동 출제</h2>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-gray-200">
                  <span className="text-sm font-bold text-gray-800">문항 수:</span>
                  <input 
                    type="number" 
                    min={1} max={20} 
                    value={quizCount} 
                    onChange={(e) => setQuizCount(parseInt(e.target.value) || 5)}
                    className="w-12 text-sm border-none outline-none font-bold text-purple-600 bg-transparent text-center"
                  />
                </div>
                <div className="w-px h-5 bg-gray-300" />
                <span className="text-sm font-bold text-gray-800">형식:</span>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer text-gray-700 hover:text-purple-600">
                  <input type="radio" name="choiceCount" value={4} checked={quizChoiceCount === 4} onChange={() => setQuizChoiceCount(4)} className="accent-purple-600" />
                  <span className="font-medium">4지선다</span>
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer text-gray-700 hover:text-purple-600">
                  <input type="radio" name="choiceCount" value={5} checked={quizChoiceCount === 5} onChange={() => setQuizChoiceCount(5)} className="accent-purple-600" />
                  <span className="font-medium">5지선다</span>
                </label>
                
                <div className="w-px h-5 bg-gray-300 mx-2" />
                
                <span className="text-sm font-bold text-gray-800">발문 번역:</span>
                <select 
                  value={quizTargetLang}
                  onChange={(e) => setQuizTargetLang(e.target.value)}
                  className="text-sm font-bold text-gray-700 bg-white border border-gray-200 rounded px-2 py-1 outline-none cursor-pointer"
                >
                  <option value="none">번역 안 함</option>
                  <option value="en">영어 (English)</option>
                  <option value="zh">중국어 (中文)</option>
                  <option value="ja">일본어 (日本語)</option>
                  <option value="vi">베트남어 (Tiếng Việt)</option>
                  <option value="my">미얀마어 (မြန်မာစာ)</option>
                  <option value="bn">벵골어 (বাংলা)</option>
                  <option value="mn">몽골어 (Mongolian)</option>
                </select>
                
                <div className="w-px h-5 bg-gray-300 mx-2" />
                
                <button 
                  onClick={handleGenerateQuiz}
                  disabled={isGeneratingQuiz}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-bold border rounded-lg transition-colors text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 shadow-sm"
                >
                  {isGeneratingQuiz && <Loader2 size={16} className="animate-spin" />}
                  {isGeneratingQuiz ? 'AI가 시험지 생성 중...' : '영상 내용으로 시험지 출제하기'}
                </button>
                <button onClick={() => setIsQuizEditorOpen(false)} className="p-2 ml-2 text-gray-500 hover:bg-gray-200 rounded-full transition-colors">
                  <X size={20} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto bg-gray-100 p-6">
              {quizzes.length === 0 ? (
                <div className="flex h-full items-center justify-center flex-col gap-4">
                  <div className="w-24 h-24 bg-purple-100 rounded-full flex items-center justify-center mb-2">
                    <BookOpen size={48} className="text-purple-400" />
                  </div>
                  <h3 className="text-xl font-bold text-gray-700">시험지가 비어있습니다</h3>
                  <p className="text-gray-500 text-center">우측 상단의 <strong className="text-purple-600">시험지 출제하기</strong> 버튼을 누르시면,<br/>현재 영상의 내용을 바탕으로 AI가 자동으로 문제를 만듭니다.</p>
                </div>
              ) : (
                <div className="max-w-4xl mx-auto space-y-6 pb-20">
                  <div className="bg-purple-50 border border-purple-200 p-4 rounded-xl flex items-center justify-between shadow-sm">
                    <span className="font-bold text-purple-900">총 {quizzes.length}문항이 출제되었습니다. 내용을 검토/수정하고 우측의 버튼을 눌러 인쇄하세요.</span>
                    <button 
                      onClick={() => setIsPreviewOpen(true)}
                      className="flex items-center gap-2 px-5 py-2 text-sm font-bold rounded-lg transition-colors text-white bg-gray-900 hover:bg-black shadow-md hover:scale-105"
                    >
                      미리보기 및 PDF 인쇄
                    </button>
                  </div>
                  
                  {quizzes.map((q, idx) => (
                    <div key={q.id} className={`p-6 rounded-2xl border ${q.isSelected ? 'border-purple-300 bg-white shadow-md ring-1 ring-purple-100' : 'border-gray-200 bg-white opacity-60'} transition-all`}>
                      <div className="flex items-center justify-between mb-5 pb-4 border-b border-gray-100">
                        <label className="flex items-center gap-2 cursor-pointer font-bold text-purple-700 hover:text-purple-800 text-lg">
                          <input type="checkbox" checked={q.isSelected} onChange={(e) => handleQuizChange(q.id, 'isSelected', e.target.checked)} className="w-5 h-5 accent-purple-600 rounded" />
                          시험지에 포함하기
                        </label>
                        <span className="text-sm font-black text-white bg-purple-600 px-3 py-1.5 rounded-full shadow-sm">문항 {idx + 1}</span>
                      </div>
                      
                      <div className="space-y-5">
                        <div>
                          <label className="block text-sm font-bold text-gray-600 mb-2">문제</label>
                          <textarea 
                            value={q.question} 
                            onChange={(e) => handleQuizChange(q.id, 'question', e.target.value)} 
                            className="w-full p-3 text-[16px] font-bold text-gray-900 border border-gray-200 rounded-xl focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none resize-none bg-gray-50 focus:bg-white transition-all shadow-inner"
                            rows={2}
                          />
                        </div>
                        
                        <div className="space-y-3 bg-gray-50 p-4 rounded-xl border border-gray-100">
                          <label className="block text-sm font-bold text-gray-600 mb-1">선택지 수정</label>
                          {q.choices.map((choice, cIdx) => (
                            <div key={cIdx} className="flex items-center gap-3">
                              <span className="font-black text-gray-500 w-6 shrink-0 text-center bg-white border border-gray-200 rounded-full h-6 leading-6 text-sm">{['1', '2', '3', '4', '5'][cIdx]}</span>
                              <input 
                                type="text" 
                                value={choice} 
                                onChange={(e) => handleQuizChange(q.id, 'choices', e.target.value, cIdx)} 
                                className="flex-1 p-2.5 text-[15px] border border-gray-200 rounded-lg focus:border-purple-500 outline-none bg-white transition-colors"
                              />
                            </div>
                          ))}
                        </div>
                        
                        <div className="flex gap-6 pt-2">
                          <div className="w-1/4">
                            <label className="block text-sm font-bold text-gray-600 mb-2">정답</label>
                            <select 
                              value={q.answer} 
                              onChange={(e) => handleQuizChange(q.id, 'answer', e.target.value)}
                              className="w-full p-3 text-[15px] font-bold border border-gray-200 rounded-xl focus:border-purple-500 outline-none bg-gray-50 hover:bg-white cursor-pointer shadow-sm text-purple-700"
                            >
                              {q.choices.map((c, i) => <option key={i} value={c}>{i+1}번 정답</option>)}
                            </select>
                          </div>
                          <div className="flex-1">
                            <label className="block text-sm font-bold text-gray-600 mb-2">해설 내용</label>
                            <textarea 
                              value={q.explanation} 
                              onChange={(e) => handleQuizChange(q.id, 'explanation', e.target.value)} 
                              className="w-full p-3 text-[15px] text-gray-700 border border-gray-200 rounded-xl focus:border-purple-500 focus:ring-2 focus:ring-purple-200 outline-none resize-none bg-gray-50 focus:bg-white transition-all shadow-inner"
                              rows={2}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 실시간 캡션 모달 */}
      {isLiveMode && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-gray-200">
              <div className="flex items-center gap-3">
                <Mic size={24} className={isListening ? "text-red-500 animate-pulse" : "text-gray-400"} />
                <h2 className="text-lg font-bold text-gray-800">실시간 동시통역 캡션</h2>
              </div>
              <div className="flex items-center gap-3">
                <select 
                  value={sourceLang}
                  onChange={(e) => setSourceLang(e.target.value)}
                  className="text-sm font-bold text-gray-800 bg-gray-100 rounded px-3 py-1.5 outline-none cursor-pointer"
                >
                  <option value="ko-KR">한국어 인식</option>
                  <option value="en-US">영어 인식</option>
                  <option value="ja-JP">일본어 인식</option>
                  <option value="zh-CN">중국어 인식</option>
                  <option value="vi-VN">베트남어 인식</option>
                  <option value="th-TH">태국어 인식</option>
                  <option value="es-ES">스페인어 인식</option>
                  <option value="fr-FR">프랑스어 인식</option>
                  <option value="id-ID">인도네시아어 인식</option>
                </select>
                <span className="text-gray-400 font-bold">→</span>
                <select 
                  value={targetLang}
                  onChange={(e) => setTargetLang(e.target.value)}
                  className="text-sm font-bold text-gray-800 bg-gray-100 rounded px-3 py-1.5 outline-none cursor-pointer"
                >
                  <option value="ko">한국어 번역</option>
                  <option value="en">영어 번역</option>
                  <option value="zh">중국어 번역</option>
                  <option value="ja">일본어 번역</option>
                  <option value="vi">베트남어 번역</option>
                  <option value="my">미얀마어 번역</option>
                  <option value="bn">벵골어 번역</option>
                  <option value="mn">몽골어 번역</option>
                </select>
                <button 
                  onClick={toggleLiveCaption}
                  className={`px-4 py-1.5 rounded-full text-sm font-bold text-white transition-colors ${isListening ? 'bg-red-500 hover:bg-red-600' : 'bg-blue-600 hover:bg-blue-700'}`}
                >
                  {isListening ? '인식 중지' : '실시간 마이크 켜기'}
                </button>
                <button onClick={() => setIsLiveMode(false)} className="p-2 text-gray-500 hover:bg-gray-100 rounded-full">
                  닫기
                </button>
              </div>
            </div>
            
            <div className="flex flex-1 overflow-hidden bg-gray-50">
              {/* 좌측: 인식된 음성 */}
              <div className="w-1/2 flex flex-col border-r border-gray-200">
                <div className="p-3 bg-white border-b border-gray-100 font-semibold text-gray-700 text-sm text-center">
                  원본 음성 인식 결과
                </div>
                <div className="flex-1 p-4 overflow-y-auto space-y-3 flex flex-col-reverse">
                  {interimText && (
                    <div className="p-3 bg-gray-100 rounded-lg shadow-sm border border-gray-200 text-gray-500 text-[15px] italic animate-pulse">
                      {interimText}
                    </div>
                  )}
                  {liveOriginalTexts.slice().reverse().map(item => (
                    <div key={item.id} className="p-3 bg-white rounded-lg shadow-sm border border-gray-100 text-gray-800 text-[15px]">
                      {item.text}
                    </div>
                  ))}
                  {liveOriginalTexts.length === 0 && (
                    <div className="text-gray-400 text-center m-auto text-sm">마이크를 켜고 말씀해 보세요.</div>
                  )}
                </div>
              </div>
              
              {/* 우측: 번역 결과 */}
              <div className="w-1/2 flex flex-col bg-[#1A1B26]">
                <div className="p-3 border-b border-gray-800 font-semibold text-blue-400 text-sm text-center">
                  AI 실시간 번역
                </div>
                <div className="flex-1 p-4 overflow-y-auto space-y-3 flex flex-col-reverse">
                  {liveTranslatedTexts.slice().reverse().map(item => (
                    <div key={item.id} className="p-3 bg-[#24283B] rounded-lg shadow-sm border border-[#414868] text-white text-[17px] font-medium tracking-wide">
                      {item.text}
                    </div>
                  ))}
                  {liveTranslatedTexts.length === 0 && (
                    <div className="text-gray-500 text-center m-auto text-sm">번역 결과가 이곳에 표시됩니다.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 시험지 미리보기 모달 */}
      {isPreviewOpen && (
        <div className="fixed inset-0 bg-gray-100 z-50 flex flex-col overflow-hidden print:bg-white">
          {/* Top Control Panel */}
          <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between shadow-sm z-10 shrink-0 print:hidden">
            <div className="flex items-center gap-6">
              <h2 className="text-xl font-bold text-gray-800">문제지 미리보기</h2>
              
              <div className="flex items-center gap-4 bg-gray-50 px-4 py-2 rounded-lg border border-gray-200">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-gray-700">레이아웃</span>
                  <select 
                    value={columnCount} 
                    onChange={(e) => setColumnCount(Number(e.target.value) as 1 | 2)}
                    className="border border-gray-300 rounded px-2 py-1 text-sm outline-none font-medium bg-white"
                  >
                    <option value={1}>1단 (기본)</option>
                    <option value={2}>2단 (모의고사 폼)</option>
                  </select>
                </div>
                <div className="w-px h-5 bg-gray-300"></div>
                <label className="flex items-center gap-2 cursor-pointer text-sm font-bold text-gray-700">
                  <input type="checkbox" checked={showAnswers} onChange={(e) => setShowAnswers(e.target.checked)} className="w-4 h-4 accent-blue-600" />
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
                onClick={handleSaveQuizToHistory}
                className="px-4 py-2 text-sm font-bold text-purple-700 bg-purple-100 border border-purple-200 hover:bg-purple-200 rounded-lg transition-colors"
              >
                보관함에 저장
              </button>
              <button 
                onClick={() => setIsPreviewOpen(false)}
                className="px-4 py-2 text-sm font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                닫기
              </button>
              <button 
                onClick={() => handleIframePrint('quiz-print-area')}
                className="px-5 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm flex items-center gap-2"
              >
                PDF 출력 및 저장하기
              </button>
            </div>
          </div>
          
          {/* Main Preview Area */}
          <div id="quiz-print-area" className="flex-1 overflow-y-auto p-8 flex flex-col items-center gap-10 bg-gray-100 print:p-0 print:bg-white print:overflow-visible print:block print:relative print:w-full">
            
            {/* 1. 문제지 페이지 (페이지 분할 적용) */}
            {(() => {
              const selectedQuizzes = quizzes.filter(q => q.isSelected);
              const chunkSize = columnCount === 2 ? 10 : 6;
              const pages = [];
              for (let i = 0; i < selectedQuizzes.length; i += chunkSize) {
                pages.push({ items: selectedQuizzes.slice(i, i + chunkSize), startIndex: i });
              }
              
              return pages.map((page, pageIdx) => (
                <div 
                  key={`quiz-page-${pageIdx}`}
                  className={`bg-white shadow-xl border border-gray-200 p-[15mm] shrink-0 print:shadow-none print:border-none print:p-0 print:w-full print:max-w-none print:m-0 relative ${pageIdx > 0 ? 'break-before-page' : ''}`}
                  style={{ width: '210mm', minHeight: '297mm', fontFamily: '"Batang", "KoPub Batang", serif', pageBreakBefore: pageIdx > 0 ? 'always' : 'auto', breakBefore: pageIdx > 0 ? 'page' : 'auto' }}
                >
                  {/* Header (모든 페이지에 동일한 포맷 적용) */}
                  <div className="mb-8 border-b-2 border-black pb-4 text-center">
                    <input 
                      type="text" 
                      value={examTitle}
                      onChange={(e) => setExamTitle(e.target.value)}
                      placeholder="문제지 제목 입력"
                      className="w-full text-center text-3xl font-black mb-2 bg-transparent outline-none placeholder:text-gray-300 print:placeholder:text-transparent"
                    />
                    <input 
                      type="text" 
                      value={examSubtitle}
                      onChange={(e) => setExamSubtitle(e.target.value)}
                      placeholder="소제목 입력 (예: 제1과목)"
                      className="w-full text-center text-lg font-bold text-gray-600 bg-transparent outline-none placeholder:text-gray-300 print:placeholder:text-transparent"
                    />
                  </div>

                  {/* Questions Container (Flexbox 2단) */}
                  <div className={`flex ${columnCount === 2 ? 'gap-[12mm]' : 'flex-col'}`}>
                    {/* Left Column (또는 1단 전체) */}
                    <div className="flex-1 flex flex-col">
                      {(columnCount === 2 ? page.items.slice(0, 5) : page.items).map((q, localIdx) => {
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
                              {q.choices.map((choice, cIdx) => (
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
                    {columnCount === 2 && (
                      <div className="w-0 shrink-0 border-l border-[#ccc]"></div>
                    )}

                    {/* Right Column */}
                    {columnCount === 2 && (
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
                                {q.choices.map((choice, cIdx) => (
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
              if (!showAnswers) return null;
              const selectedQuizzes = quizzes.filter(q => q.isSelected);
              if (selectedQuizzes.length === 0) return null;
              
              const chunkSize = columnCount === 2 ? 10 : 6;
              const pages = [];
              for (let i = 0; i < selectedQuizzes.length; i += chunkSize) {
                pages.push({ items: selectedQuizzes.slice(i, i + chunkSize), startIndex: i });
              }
              
              return pages.map((page, pageIdx) => (
                <div 
                  key={`answer-page-${pageIdx}`}
                  className="bg-white shadow-xl border border-gray-200 p-[15mm] shrink-0 print:shadow-none print:border-none print:p-0 print:w-full print:max-w-none print:m-0 break-before-page relative"
                  style={{ width: '210mm', minHeight: '297mm', fontFamily: '"Batang", "KoPub Batang", serif', pageBreakBefore: 'always', breakBefore: 'page' }}
                >
                  {/* 정답 페이지 Header (모든 페이지에 동일 포맷 적용) */}
                  <div className="mb-8 border-b-2 border-black pb-4 text-center">
                    <h2 className="text-3xl font-black mb-2">정답 및 해설</h2>
                    <div className="text-lg font-bold text-gray-600">{examTitle || '문제지 제목'}</div>
                  </div>
                  <div className={`flex ${columnCount === 2 ? 'gap-[12mm]' : 'flex-col'}`}>
                    {/* Left Column */}
                    <div className="flex-1 flex flex-col">
                      {(columnCount === 2 ? page.items.slice(0, 5) : page.items).map((q, localIdx) => {
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
                    {columnCount === 2 && (
                      <div className="w-0 shrink-0 border-l border-[#ccc]"></div>
                    )}

                    {/* Right Column */}
                    {columnCount === 2 && (
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
            
            {/* 인쇄용 고정 푸터 (인쇄 시 모든 페이지 하단에 출력됨) */}
            <div className="hidden print:block fixed bottom-4 w-full text-center text-[11px] text-gray-500 font-bold" style={{ fontFamily: '"Batang", "KoPub Batang", serif' }}>
              - {examTitle || '시험지'} -
            </div>
          </div>
        </div>
      )}
      {/* 버전 기록 모달 */}
      {isVersionsOpen && (
        <div className="fixed inset-0 bg-black/60 z-[50] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl h-[60vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center gap-3">
                <Settings className="text-blue-600 animate-spin-slow" size={22} />
                <div>
                  <h2 className="text-base font-bold text-gray-800">
                    프로젝트 버전 기록
                  </h2>
                  <p className="text-xs text-gray-500">
                    현재 프로젝트: <span className="font-extrabold text-blue-700">{projectTitle}</span>
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setIsVersionsOpen(false)} 
                className="p-2 text-gray-500 hover:bg-gray-200 rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            {/* Versions List */}
            <div className="flex-1 overflow-auto p-4 space-y-3 bg-gray-50">
              {projectVersions.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-gray-400">
                  저장된 버전 내역이 없습니다. 자막을 저장하면 새 버전이 등록됩니다.
                </div>
              ) : (
                [...projectVersions].reverse().map((ver, idx) => {
                  const savedDate = ver.savedAt ? new Date(ver.savedAt).toLocaleString() : '날짜 정보 없음';
                  return (
                    <div key={ver.versionId || idx} className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm flex items-center justify-between gap-4 hover:shadow-md transition-shadow">
                      <div className="flex flex-col gap-1">
                        <span className="text-sm font-black text-gray-800">
                          {ver.versionName}
                        </span>
                        <span className="text-xs text-gray-450">
                          저장 일시: {savedDate} • 원본: {ver.originalSubtitles?.length || 0}개 • 번역: {ver.translatedSubtitles?.length || 0}개
                        </span>
                      </div>
                      
                      <button
                        onClick={() => {
                          if (confirm(`"${ver.versionName}" 버전을 작업공간으로 불러오시겠습니까?\n(현재 작업 중인 내용은 이 버전으로 덮어씌워집니다.)`)) {
                            const verTranslations = ver.translations || {};
                            if (Object.keys(verTranslations).length === 0 && ver.translatedSubtitles) {
                              verTranslations[targetLang] = ver.translatedSubtitles;
                            }
                            
                            setOriginalSubtitles(JSON.parse(JSON.stringify(ver.originalSubtitles || [])));
                            setInitialOriginalSubtitles(JSON.parse(JSON.stringify(ver.originalSubtitles || [])));
                            
                            setTranslationsCache(JSON.parse(JSON.stringify(verTranslations)));
                            
                            const activeTrans = verTranslations[targetLang] || [];
                            setTranslatedSubtitles(JSON.parse(JSON.stringify(activeTrans)));
                            setInitialTranslatedSubtitles(JSON.parse(JSON.stringify(activeTrans)));
                            setIsVersionsOpen(false);
                            alert(`"${ver.versionName}" 버전을 성공적으로 불러왔습니다.`);
                          }
                        }}
                        className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-all shadow-sm active:scale-95"
                      >
                        버전 불러오기
                      </button>
                    </div>
                  );
                })
              )}
            </div>
            
            <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-end shrink-0">
              <button 
                onClick={() => setIsVersionsOpen(false)}
                className="px-4 py-2 text-sm font-semibold text-gray-700 bg-gray-200 hover:bg-gray-300 rounded-lg transition-colors"
              >
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings / Password Change Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/60 z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden relative border border-gray-150">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="font-bold text-lg text-gray-800 flex items-center gap-1.5">
                <Settings className="text-gray-650" size={20} />
                계정 설정 및 비밀번호 변경
              </h3>
              <button 
                onClick={() => {
                  setIsSettingsOpen(false);
                  setNewPassword("");
                  setConfirmPassword("");
                }} 
                className="text-gray-400 hover:text-gray-900 p-1 rounded-full hover:bg-gray-200 transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleChangePassword} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1">계정 이메일</label>
                <input 
                  type="text" 
                  value={user?.email || ""} 
                  disabled
                  className="w-full bg-gray-150 border border-gray-200 rounded-lg p-2.5 text-sm text-gray-500 cursor-not-allowed" 
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">새 비밀번호</label>
                <input 
                  type="password" 
                  value={newPassword} 
                  onChange={e => setNewPassword(e.target.value)} 
                  className="w-full border border-gray-300 rounded-lg p-2.5 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm transition-all" 
                  placeholder="새 비밀번호 입력 (6자 이상)" 
                  required 
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-1.5">비밀번호 확인</label>
                <input 
                  type="password" 
                  value={confirmPassword} 
                  onChange={e => setConfirmPassword(e.target.value)} 
                  className="w-full border border-gray-300 rounded-lg p-2.5 outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm transition-all" 
                  placeholder="비밀번호 다시 입력" 
                  required 
                />
              </div>
              
              <button 
                disabled={passwordLoading} 
                type="submit" 
                className="w-full mt-6 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-md cursor-pointer"
              >
                {passwordLoading ? (
                  <>
                    <Loader2 className="animate-spin" size={18} />
                    변경 처리 중...
                  </>
                ) : (
                  <>
                    <Check size={18} />
                    비밀번호 변경 완료
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Print Styles for PDF Export */}
      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }
          /* 전체 레이아웃 리셋 */
          .flex-col.h-screen { height: auto; }
          .overflow-hidden { overflow: visible !important; }
          .overflow-y-auto { overflow: visible !important; }
          .fixed { position: absolute !important; }
          
          /* 프린트 영역과 그 자식들만 보이게 처리 */
          #quiz-print-area, #quiz-print-area * {
            visibility: visible;
          }
          #quiz-print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            margin: 0;
            padding: 15mm;
            background: white;
          }
          
          .break-before-page {
            page-break-before: always;
            break-before: page;
          }
          .break-inside-avoid {
            page-break-inside: avoid;
            break-inside: avoid;
          }
        }
      `}</style>
    </div>
  );
}
