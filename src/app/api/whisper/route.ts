import { NextResponse } from 'next/server';
import OpenAI from 'openai';

// API 라우트는 최대한 빠르게 응답하기 위해 타임아웃을 연장할 수 있습니다.
export const maxDuration = 300; 

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    // 1. 요청에서 FormData 추출
    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: '파일이 제공되지 않았습니다.' }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OPENAI_API_KEY 환경변수가 설정되지 않았습니다.' }, { status: 500 });
    }

    // 2. OpenAI Whisper API 호출 (verbose_json 포맷으로 타임스탬프 획득)
    const response = await openai.audio.transcriptions.create({
      file: file,
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
      // 원본 음성에 외국어가 포함된 경우 해당 언어(알파벳, 한자 등)로 그대로 출력하도록 유도하는 프롬프트
      prompt: '안녕하세요. Hello. こんにちは. 你好. 음성에 포함된 모든 언어를 원본 그대로(한국어는 한글, 영어는 알파벳, 중국어는 한자 등) 번역하지 말고 전사해 주세요.',
    });

    // 3. 결과 반환
    return NextResponse.json({
      text: response.text,
      segments: response.segments,
    });
    
  } catch (error: any) {
    console.error('Whisper API Error:', error);
    return NextResponse.json(
      { error: error.message || '음성 인식 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
