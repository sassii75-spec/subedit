"use client";

import { useState, useRef, useEffect } from 'react';
import { Upload, Languages, Download, Play, Pause, Settings, Mic, Loader2, Scissors, Combine, X, Volume2, VolumeX } from 'lucide-react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { db } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import Link from 'next/link';

export type QuizItem = {
  id: string;
  question: string;
  choices: string[];
  answer: string;
  explanation: string;
  isSelected: boolean;
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

export default function Home() {
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
  
  // 퀴즈(시험지) 탭 상태
  const [activeRightTab, setActiveRightTab] = useState<'translation' | 'quiz'>('translation');
  const [quizChoiceCount, setQuizChoiceCount] = useState<4 | 5>(4);
  const [quizCount, setQuizCount] = useState<number>(5);
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false);
  const [quizzes, setQuizzes] = useState<QuizItem[]>([]);
  
  // 실시간 더빙 상태
  const [isLiveDubbing, setIsLiveDubbing] = useState(false);
  
  // 스크롤 동기화를 위한 ref
  const originalListRef = useRef<HTMLDivElement>(null);
  const translatedListRef = useRef<HTMLDivElement>(null);
  
  // 실시간 캡션 관련 상태
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [liveOriginalTexts, setLiveOriginalTexts] = useState<{id: number, text: string}[]>([]);
  const [liveTranslatedTexts, setLiveTranslatedTexts] = useState<{id: number, text: string}[]>([]);
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

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

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
      setTimeout(() => setIsProcessing(false), 2000);
      
    } catch (err: any) {
      console.error(err);
      alert('오류가 발생했습니다: ' + (err.message || err));
      setIsProcessing(false);
    }
  };

  const handleTranslate = async () => {
    if (originalSubtitles.length === 0) {
      alert('먼저 영상을 업로드하여 원본 자막을 생성해주세요.');
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
      alert('원본 자막 대본이 없습니다. 영상을 먼저 업로드해주세요.');
      return;
    }
    setIsGeneratingQuiz(true);
    setProgressMsg('AI 시험지 출제 중...');
    
    try {
      const fullTranscript = originalSubtitles.map(s => s.text).join(' ');
      const response = await fetch('/api/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: fullTranscript, choiceCount: quizChoiceCount, questionCount: quizCount })
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

  const handleSaveToHistory = async () => {
    if (originalSubtitles.length === 0 || translatedSubtitles.length === 0) {
      alert('저장할 자막 데이터가 없습니다. 먼저 번역을 진행해주세요.');
      return;
    }

    const title = prompt("저장할 작업의 제목을 입력하세요:", "새로운 번역 작업");
    if (!title) return;

    setIsSaving(true);
    try {
      await addDoc(collection(db, 'subedit_history'), {
        title,
        targetLang,
        originalSubtitles,
        translatedSubtitles,
        createdAt: serverTimestamp(),
      });
      alert('성공적으로 저장되었습니다!\n이제 우측 상단의 [히스토리 보기] 메뉴에서 자막 파일을 다운로드할 수 있습니다.');
    } catch (err) {
      console.error('Save Error:', err);
      alert('저장 중 오류가 발생했습니다.');
    } finally {
      setIsSaving(false);
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
          const langMap: Record<string, string> = { en: 'en-US', zh: 'zh-CN', ja: 'ja-JP', vi: 'vi-VN', my: 'my-MM', bn: 'bn-BD' };
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
      const filename = `subedit_translated_${Date.now()}.mp4`;
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
      recognition.interimResults = false;
      recognition.lang = 'ko-KR';

      recognition.onresult = async (event: any) => {
        const currentResult = event.results[event.results.length - 1];
        if (currentResult.isFinal) {
          const transcript = currentResult[0].transcript;
          const newId = Date.now();
          
          setLiveOriginalTexts(prev => [...prev, { id: newId, text: transcript }]);

          // 바로 번역 API 호출
          try {
            const response = await fetch('/api/translate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                subtitles: [{ id: newId, start: '0', end: '0', text: transcript }],
                targetLanguage: targetLangRef.current, // 클로저 이슈 방지를 위해 최신 참조값 사용
              }),
            });
            const result = await response.json();
            if (result.translatedSubtitles && result.translatedSubtitles[0]) {
              setLiveTranslatedTexts(prev => [...prev, { id: newId, text: result.translatedSubtitles[0].text }]);
            }
          } catch (err) {
            console.error('Live Translation Error:', err);
          }
        }
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error', event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        if (isListening) recognition.start(); // 계속 듣기
      };

      recognitionRef.current = recognition;
    }

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

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-900 font-sans">
      {/* Top Navigation */}
      <header className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 shadow-sm z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-lg">S</span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-gray-800">SubEdit</h1>
        </div>
        
        <div className="flex items-center gap-3">
          <Link href="/history" className="text-sm font-semibold text-gray-600 hover:text-blue-600 mr-2 transition-colors">
            히스토리 보기
          </Link>
          <button 
            onClick={toggleLiveDubbing}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
              isLiveDubbing 
                ? 'bg-purple-100 text-purple-700 border border-purple-200 hover:bg-purple-200' 
                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
            title="재생 시 번역된 자막을 기기의 내장 AI 음성으로 실시간으로 읽어줍니다."
          >
            {isLiveDubbing ? <Volume2 size={16} /> : <VolumeX size={16} />} 
            {isLiveDubbing ? '실시간 더빙 켬' : '실시간 더빙 끔'}
          </button>

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
            onClick={() => setIsManualClipOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            <Scissors size={16} /> 수동 컷편집
          </button>
          
          <input 
            type="file" 
            accept="video/*" 
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
            {isProcessing ? progressMsg : '영상 업로드'}
          </button>
          
          <button className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full transition-colors">
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
        <section className="flex-none h-[40vh] bg-[#1a1b26] border-b border-gray-300 relative flex flex-col items-center justify-center p-4">
          {!videoSrc ? (
            <div className="w-full h-full border-2 border-dashed border-gray-600 rounded-xl flex flex-col items-center justify-center bg-gray-800/30">
              <Upload size={48} className="text-gray-500 mb-4" />
              <p className="text-gray-400 font-medium mb-2">편집할 영상 파일을 업로드하세요 (MP4, WebM)</p>
              <input 
                type="file" 
                accept="video/*" 
                className="hidden" 
                ref={fileInputRef}
                onChange={handleFileUpload}
              />
              <button 
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-colors disabled:opacity-50 flex items-center gap-2 mt-2"
              >
                {isProcessing ? <Loader2 size={18} className="animate-spin" /> : null}
                {isProcessing ? '처리 중...' : '영상 업로드'}
              </button>
            </div>
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
              <div className="h-16 sm:h-20 bg-[#0f0f0f] border-t border-gray-800 flex items-center justify-center px-4 md:px-8 shadow-[inset_0_4px_10px_rgba(0,0,0,0.5)] z-10 shrink-0">
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
                  return (
                    <div 
                      key={sub.id} 
                      id={`orig-${sub.id}`}
                      className={`flex gap-3 p-3 rounded-lg border transition-all shadow-sm group focus-within:ring-2 focus-within:ring-blue-400
                        ${isActive ? 'bg-blue-50 border-blue-300 ring-1 ring-blue-200' : 'bg-white border-transparent hover:border-gray-200'}
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
                        className={`flex-1 w-full bg-transparent resize-none outline-none text-[15px] leading-relaxed min-h-[44px] ${isActive ? 'text-blue-900 font-medium' : 'text-gray-800'}`}
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
            {/* Tabs */}
            <div className="flex border-b border-gray-200 bg-white shadow-sm z-10 print:hidden">
              <button
                onClick={() => setActiveRightTab('translation')}
                className={`flex-1 py-3 text-sm font-bold transition-colors ${activeRightTab === 'translation' ? 'border-b-2 border-blue-600 text-blue-600 bg-blue-50/30' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'}`}
              >
                자막 번역
              </button>
              <button
                onClick={() => setActiveRightTab('quiz')}
                className={`flex-1 py-3 text-sm font-bold transition-colors ${activeRightTab === 'quiz' ? 'border-b-2 border-blue-600 text-blue-600 bg-blue-50/30' : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'}`}
              >
                시험지(퀴즈) 생성
              </button>
            </div>

            {/* Translation Tab Content */}
            <div className={`flex-col h-full overflow-hidden ${activeRightTab === 'translation' ? 'flex' : 'hidden'} print:hidden`}>
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
                  }}
                  className="text-sm font-bold text-gray-800 bg-transparent outline-none cursor-pointer border-b border-dashed border-gray-400 pb-0.5"
                >
                  <option value="en">영어 (English)</option>
                  <option value="zh">중국어 (中文)</option>
                  <option value="ja">일본어 (日本語)</option>
                  <option value="vi">베트남어 (Tiếng Việt)</option>
                  <option value="my">버마어 (မြန်မာစာ)</option>
                  <option value="bn">벵골어 (বাংলা)</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
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
                  onClick={handleSaveToHistory}
                  disabled={isSaving}
                  className={`px-3 py-1.5 text-xs font-medium border rounded transition-colors ${isSaving ? 'text-gray-400 border-gray-200 bg-gray-50' : 'text-white bg-gray-800 border-gray-800 hover:bg-gray-700'}`}
                >
                  {isSaving ? '저장 중...' : '작업 저장 후 다운로드'}
                </button>
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
                  return (
                    <div 
                      key={sub.id} 
                      id={`trans-${sub.id}`}
                      className={`flex gap-3 p-3 rounded-lg border transition-all shadow-sm group focus-within:ring-2 focus-within:ring-green-400
                        ${isActive ? 'bg-green-50 border-green-300 ring-1 ring-green-200' : 'bg-white border-transparent hover:border-gray-200'}
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
                        className={`flex-1 w-full bg-transparent resize-none outline-none text-[15px] leading-relaxed min-h-[44px] ${isActive ? 'text-blue-900 font-medium' : 'text-gray-800'}`}
                        value={sub.text}
                        onChange={(e) => handleSubtitleEdit(sub.id, e.target.value)}
                        rows={2}
                      />
                      <div className="flex flex-col gap-1 mt-1 shrink-0">
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

            {/* Quiz Tab Content 시작 */}
            <div className={`flex-col h-full overflow-hidden ${activeRightTab === 'quiz' ? 'flex' : 'hidden'} print:flex`}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50 shadow-sm print:hidden">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2 bg-white px-2 py-1 rounded border border-gray-200">
                    <span className="text-sm font-bold text-gray-800">문항 수:</span>
                    <input 
                      type="number" 
                      min={1} max={20} 
                      value={quizCount} 
                      onChange={(e) => setQuizCount(parseInt(e.target.value) || 5)}
                      className="w-12 px-1 py-0.5 text-sm border-none outline-none font-bold text-blue-600 bg-transparent text-center"
                    />
                  </div>
                  <div className="w-px h-4 bg-gray-300" />
                  <span className="text-sm font-bold text-gray-800">형식:</span>
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer text-gray-700 hover:text-blue-600">
                    <input type="radio" name="choiceCount" value={4} checked={quizChoiceCount === 4} onChange={() => setQuizChoiceCount(4)} className="accent-blue-600" />
                    <span className="font-medium">4지선다</span>
                  </label>
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer text-gray-700 hover:text-blue-600">
                    <input type="radio" name="choiceCount" value={5} checked={quizChoiceCount === 5} onChange={() => setQuizChoiceCount(5)} className="accent-blue-600" />
                    <span className="font-medium">5지선다</span>
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={handleGenerateQuiz}
                    disabled={isGeneratingQuiz}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold border rounded transition-colors text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 shadow-sm"
                  >
                    {isGeneratingQuiz && <Loader2 size={14} className="animate-spin" />}
                    {isGeneratingQuiz ? '시험지 출제 중...' : '영상 내용으로 시험지 생성'}
                  </button>
                  {quizzes.length > 0 && (
                    <button 
                      onClick={() => window.print()}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold border rounded transition-colors text-white bg-gray-800 hover:bg-gray-900 shadow-sm"
                    >
                      시험지 PDF로 저장
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6 print:p-0 print:overflow-visible" id="quiz-print-area">
                {quizzes.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-gray-400 flex-col gap-2 print:hidden">
                    <p>원본 영상 대본을 기반으로 핵심 내용을 퀴즈로 만들어줍니다.</p>
                    <p className="text-xs">상단의 [영상 내용으로 시험지 생성] 버튼을 클릭하세요.</p>
                  </div>
                ) : (
                  <div className="max-w-3xl mx-auto w-full">
                    
                    {/* 화면 전용 편집 에디터 UI */}
                    <div className="print:hidden space-y-6 pb-20">
                      <div className="bg-blue-50 border border-blue-200 p-3 rounded-lg flex items-center justify-between shadow-sm">
                        <span className="text-sm font-bold text-blue-800">총 {quizzes.length}문항이 생성되었습니다. 내용을 자유롭게 수정하고 시험지에 포함할 문제를 골라주세요.</span>
                      </div>
                      
                      {quizzes.map((q, idx) => (
                        <div key={q.id} className={`p-5 rounded-xl border ${q.isSelected ? 'border-blue-300 bg-white shadow-sm ring-1 ring-blue-100' : 'border-gray-200 bg-gray-50 opacity-60'} transition-all`}>
                          <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
                            <label className="flex items-center gap-2 cursor-pointer font-bold text-blue-700 hover:text-blue-800">
                              <input type="checkbox" checked={q.isSelected} onChange={(e) => handleQuizChange(q.id, 'isSelected', e.target.checked)} className="w-4 h-4 accent-blue-600" />
                              시험지에 포함
                            </label>
                            <span className="text-xs font-black text-gray-400 bg-gray-100 px-2 py-1 rounded">문항 {idx + 1}</span>
                          </div>
                          
                          <div className="space-y-4">
                            <div>
                              <label className="block text-xs font-bold text-gray-500 mb-1.5">문제 내용</label>
                              <textarea 
                                value={q.question} 
                                onChange={(e) => handleQuizChange(q.id, 'question', e.target.value)} 
                                className="w-full p-2.5 text-[15px] font-bold text-gray-900 border border-gray-200 rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-none bg-gray-50 focus:bg-white transition-colors"
                                rows={2}
                              />
                            </div>
                            
                            <div className="space-y-2">
                              <label className="block text-xs font-bold text-gray-500 mb-1.5">보기 수정</label>
                              {q.choices.map((choice, cIdx) => (
                                <div key={cIdx} className="flex items-center gap-3">
                                  <span className="font-bold text-gray-400 w-5 shrink-0 text-center">{['①', '②', '③', '④', '⑤'][cIdx]}</span>
                                  <input 
                                    type="text" 
                                    value={choice} 
                                    onChange={(e) => handleQuizChange(q.id, 'choices', e.target.value, cIdx)} 
                                    className="flex-1 p-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 outline-none bg-gray-50 focus:bg-white transition-colors"
                                  />
                                </div>
                              ))}
                            </div>
                            
                            <div className="flex gap-4 pt-2">
                              <div className="w-1/3">
                                <label className="block text-xs font-bold text-gray-500 mb-1.5">정답 지정</label>
                                <select 
                                  value={q.answer} 
                                  onChange={(e) => handleQuizChange(q.id, 'answer', e.target.value)}
                                  className="w-full p-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 outline-none bg-gray-50 cursor-pointer"
                                >
                                  {q.choices.map((c, i) => <option key={i} value={c}>{i+1}번 보기</option>)}
                                </select>
                              </div>
                              <div className="flex-1">
                                <label className="block text-xs font-bold text-gray-500 mb-1.5">해설</label>
                                <textarea 
                                  value={q.explanation} 
                                  onChange={(e) => handleQuizChange(q.id, 'explanation', e.target.value)} 
                                  className="w-full p-2 text-sm border border-gray-200 rounded-lg focus:border-blue-500 outline-none resize-none bg-gray-50 focus:bg-white transition-colors"
                                  rows={2}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* 인쇄용 최종 렌더링 UI (평소엔 숨김) */}
                    <div className="hidden print:block bg-transparent w-full">
                      <div className="quiz-questions">
                        <h2 className="text-2xl font-black mb-8 pb-3 border-b-2 border-black tracking-tight">강의 내용 복습 시험지</h2>
                        {quizzes.filter(q => q.isSelected).map((q, idx) => (
                          <div key={q.id} className="mb-10 break-inside-avoid">
                            <p className="font-bold text-gray-900 mb-4 text-[16px] leading-relaxed">
                              <span className="mr-1">{idx + 1}.</span> {q.question}
                            </p>
                            <div className="space-y-3 pl-5">
                              {q.choices.map((choice, cIdx) => (
                                <div key={cIdx} className="flex gap-3 text-gray-800 text-[15px]">
                                  <span className="font-bold shrink-0">{['①', '②', '③', '④', '⑤'][cIdx]}</span>
                                  <span>{choice}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                      
                      {/* 정답 및 해설 (새 페이지에 출력되도록 설정) */}
                      <div className="quiz-answers break-before-page mt-16 pt-10 border-t-2 border-gray-300">
                        <h2 className="text-xl font-black mb-8">정답 및 해설</h2>
                        {quizzes.filter(q => q.isSelected).map((q, idx) => (
                          <div key={q.id} className="mb-8 break-inside-avoid">
                            <p className="font-bold text-gray-900 mb-2 text-[15px]">
                              {idx + 1}번 정답: <span className="text-blue-600 ml-1">{q.answer}</span>
                            </p>
                            <div className="text-gray-700 text-[14px] leading-relaxed">
                              {q.explanation}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

      </main>

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
                  value={targetLang}
                  onChange={(e) => setTargetLang(e.target.value)}
                  className="text-sm font-bold text-gray-800 bg-gray-100 rounded px-3 py-1.5 outline-none cursor-pointer"
                >
                  <option value="en">영어 번역</option>
                  <option value="zh">중국어 번역</option>
                  <option value="ja">일본어 번역</option>
                  <option value="vi">베트남어 번역</option>
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
                  한국어 음성 인식
                </div>
                <div className="flex-1 p-4 overflow-y-auto space-y-3 flex flex-col-reverse">
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
