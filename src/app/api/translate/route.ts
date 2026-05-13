import { NextResponse } from 'next/server';
import OpenAI from 'openai';

export const maxDuration = 300; 

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { subtitles, targetLanguage } = body;

    if (!subtitles || !targetLanguage) {
      return NextResponse.json({ error: '필수 파라미터가 누락되었습니다.' }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OPENAI_API_KEY가 설정되지 않았습니다.' }, { status: 500 });
    }

    // 언어명 매핑
    const langMap: Record<string, string> = {
      'en': 'English',
      'zh': 'Chinese (Simplified)',
      'ja': 'Japanese',
      'vi': 'Vietnamese',
      'my': 'Burmese (Myanmar)',
      'bn': 'Bengali',
      'sw': 'Swahili'
    };
    
    const targetLangName = langMap[targetLanguage] || targetLanguage;

    // 시스템 프롬프트 작성
    const systemPrompt = `You are an expert subtitle translator. Translate the given JSON array of subtitles from Korean to ${targetLangName}.
Requirements:
1. Keep the exact same 'id', 'start', and 'end' values.
2. Only translate the 'text' field to ${targetLangName}.
3. Return the response STRICTLY as a valid JSON object with a single key "translatedSubtitles" containing the array. Do not include markdown formatting like \`\`\`json.`;

    // 데이터 크기가 클 수 있으므로 효율적인 처리를 위해 gpt-4o-mini 모델 사용
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(subtitles) }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error("API 응답이 비어있습니다.");
    }

    const parsedContent = JSON.parse(content);

    return NextResponse.json(parsedContent);

  } catch (error: any) {
    console.error('Translation Error:', error);
    return NextResponse.json(
      { error: error.message || '번역 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
