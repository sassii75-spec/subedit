import { NextResponse } from 'next/server';

export const maxDuration = 300; 

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { subtitles, targetLanguage } = body;

    if (!subtitles || !targetLanguage) {
      return NextResponse.json({ error: '필수 파라미터가 누락되었습니다.' }, { status: 400 });
    }

    const googleApiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
    if (!googleApiKey) {
      return NextResponse.json({ error: 'GOOGLE_TRANSLATE_API_KEY가 설정되지 않았습니다.' }, { status: 500 });
    }

    // Google Translate 언어 코드 매핑 (대부분 동일하지만 중국어 간체 명시)
    const googleLangMap: Record<string, string> = {
      'zh': 'zh-CN', // 중국어 간체
    };
    
    const targetLangCode = googleLangMap[targetLanguage] || targetLanguage;

    // 번역할 텍스트 추출
    const textsToTranslate = subtitles.map((sub: any) => sub.text);

    // Google Cloud Translation API (v2) 엔드포인트
    const googleApiUrl = `https://translation.googleapis.com/language/translate/v2?key=${googleApiKey}`;

    const response = await fetch(googleApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        q: textsToTranslate,
        target: targetLangCode,
        format: 'text' // HTML 태그 방지
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`Google Translate API Error: ${errorData.error?.message || response.statusText}`);
    }

    const data = await response.json();

    // 원본 자막 배열에 번역 결과 매핑
    const translatedSubtitles = subtitles.map((sub: any, index: number) => ({
      ...sub,
      text: data.data.translations[index].translatedText
    }));

    return NextResponse.json({ translatedSubtitles });

  } catch (error: any) {
    console.error('Translation Error:', error);
    return NextResponse.json(
      { error: error.message || '번역 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
