"use client";

import { useState, useRef, useEffect } from 'react';
import { Upload, Languages, Download, Play, Pause, Settings, Mic, Loader2 } from 'lucide-react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { db } from '@/lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import Link from 'next/link';

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

  const [targetLang, setTargetLang] = useState('en');
  const targetLangRef = useRef(targetLang);

  // targetLang 상태가 변경될 때마다 ref도 업데이트하여 비동기 콜백에서 최신 값을 참조할 수 있게 함
  useEffect(() => {
    targetLangRef.current = targetLang;
  }, [targetLang]);

  const [isTranslating, setIsTranslating] = useState(false);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [activeSubtitleId, setActiveSubtitleId] = useState<number | null>(null);
  
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

    // 1. 영상 미리보기 설정
    const objectUrl = URL.createObjectURL(file);
    setVideoSrc(objectUrl);

    // 2. FFmpeg로 오디오 추출 시작
    setIsProcessing(true);
    try {
      await loadFFmpeg();
      const ffmpeg = ffmpegRef.current;
      
      setProgressMsg('영상 로드 중...');
      await ffmpeg.writeFile('input.mp4', await fetchFile(file));
      
      setProgressMsg('오디오 추출 중... (약 10~30초 소요)');
      // -vn: 비디오 제외, -ac 1: 모노 오디오, -ar 16000: 16kHz 샘플링, -b:a 64k: 비트레이트 제한 -> Whisper 최적화
      await ffmpeg.exec(['-i', 'input.mp4', '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', 'output.mp3']);
      
      setProgressMsg('오디오 파일 완성 중...');
      const data = await ffmpeg.readFile('output.mp3');
      const audioBlob = new Blob([data as any], { type: 'audio/mp3' });
      
      // 추출된 오디오 파일 확인 (개발용)
      console.log('추출된 오디오 크기:', (audioBlob.size / 1024 / 1024).toFixed(2), 'MB');
      
      setProgressMsg('서버로 음성 전송 중... (AI 자막 생성)');
      
      // FormData 생성 및 API 호출
      const formData = new FormData();
      formData.append('file', audioBlob, 'audio.mp3');
      
      const response = await fetch('/api/whisper', {
        method: 'POST',
        body: formData,
      });
      
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || 'API 요청 실패');
      }

      // 원본 자막 상태 업데이트
      if (result.segments && result.segments.length > 0) {
        const formattedSegments = result.segments.map((seg: any, idx: number) => ({
          id: seg.id || idx,
          start: formatTime(seg.start),
          end: formatTime(seg.end),
          text: seg.text.trim(),
        }));
        setOriginalSubtitles(formattedSegments);
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
    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subtitles: originalSubtitles,
          targetLanguage: targetLang,
        }),
      });

      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error || '번역 요청 실패');
      }

      if (result.translatedSubtitles) {
        setTranslatedSubtitles(result.translatedSubtitles);
      }
    } catch (err: any) {
      console.error(err);
      alert('번역 중 오류가 발생했습니다: ' + (err.message || err));
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
    setTranslatedSubtitles(prev => prev.map(sub => 
      sub.id === id ? { ...sub, text: newText } : sub
    ));
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
            onClick={() => setIsLiveMode(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            <Mic size={16} /> 실시간 캡션
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
            <div className="relative w-full h-full flex items-center justify-center group bg-black rounded-lg overflow-hidden shadow-inner">
              <video 
                ref={videoRef}
                src={videoSrc}
                className="max-h-full max-w-full object-contain"
                controls
                onTimeUpdate={handleTimeUpdate}
              />
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
              <h2 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-green-500"></span>
                원본 자막 (자동 감지)
              </h2>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-3" ref={originalListRef}>
              {originalSubtitles.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-gray-400">
                  영상을 업로드하면 AI가 자막을 생성합니다.
                </div>
              ) : (
                originalSubtitles.map((sub) => {
                  const isActive = sub.id === activeSubtitleId;
                  return (
                    <div 
                      key={sub.id} 
                      id={`orig-${sub.id}`}
                      className={`flex gap-4 p-3 rounded-lg border transition-all shadow-sm group focus-within:ring-2 focus-within:ring-blue-400
                        ${isActive ? 'bg-blue-50 border-blue-300 ring-1 ring-blue-200' : 'bg-white border-transparent hover:border-gray-200'}`}
                    >
                      <div className={`flex flex-col items-center justify-start pt-1 text-xs font-mono gap-1 w-12 shrink-0 ${isActive ? 'text-blue-600 font-bold' : 'text-gray-400 opacity-50'}`}>
                        <span>{sub.start}</span>
                      </div>
                      <textarea 
                        className={`flex-1 w-full bg-transparent resize-none outline-none text-[15px] leading-relaxed min-h-[44px] ${isActive ? 'text-blue-900 font-medium' : 'text-gray-800'}`}
                        value={sub.text}
                        onChange={(e) => handleOriginalSubtitleEdit(sub.id, e.target.value)}
                        rows={2}
                      />
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Pane: Translation Editor */}
          <div className="flex flex-col w-1/2 bg-white z-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50 shadow-sm">
              <div className="flex items-center gap-3">
                <Languages size={18} className="text-blue-600" />
                <select 
                  value={targetLang}
                  onChange={(e) => setTargetLang(e.target.value)}
                  className="text-sm font-bold text-gray-800 bg-transparent outline-none cursor-pointer border-b border-dashed border-gray-400 pb-0.5"
                >
                  <option value="en">영어 (English)</option>
                  <option value="zh">중국어 (中文)</option>
                  <option value="ja">일본어 (日本語)</option>
                  <option value="vi">베트남어 (Tiếng Việt)</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={handleTranslate}
                  disabled={isTranslating}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded transition-colors ${isTranslating ? 'text-gray-400 border-gray-200 bg-gray-50' : 'text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100'}`}
                >
                  {isTranslating && <Loader2 size={14} className="animate-spin" />}
                  {isTranslating ? '번역 중...' : 'AI 전체 번역'}
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
                  return (
                    <div 
                      key={sub.id} 
                      id={`trans-${sub.id}`}
                      className={`flex gap-4 p-3 rounded-lg border transition-all shadow-sm group focus-within:ring-2 focus-within:ring-blue-400
                        ${isActive ? 'bg-blue-50 border-blue-300 ring-1 ring-blue-200' : 'bg-white border-transparent hover:border-gray-200'}`}
                    >
                      <div className={`flex flex-col items-center justify-start pt-1 text-xs font-mono gap-1 w-12 shrink-0 ${isActive ? 'text-blue-600 font-bold' : 'text-gray-400 opacity-50'}`}>
                        <span>{sub.start}</span>
                      </div>
                      <textarea 
                        className={`flex-1 w-full bg-transparent resize-none outline-none text-[15px] leading-relaxed min-h-[44px] ${isActive ? 'text-blue-900 font-medium' : 'text-gray-800'}`}
                        value={sub.text}
                        onChange={(e) => handleSubtitleEdit(sub.id, e.target.value)}
                        rows={2}
                      />
                    </div>
                  );
                })
              )}
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
    </div>
  );
}
