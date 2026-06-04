import { NextResponse } from 'next/server';
import OpenAI from 'openai';

export const maxDuration = 300; 

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { transcript, choiceCount, questionCount, timestamp, targetLang } = body;

    if (!transcript) {
      return NextResponse.json({ error: '대본 데이터가 없습니다.' }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OPENAI_API_KEY가 설정되지 않았습니다.' }, { status: 500 });
    }

    const optionsCount = choiceCount === 5 ? 5 : 4;
    const qCount = questionCount ? parseInt(questionCount) : 5;

    // 언어명 매핑 (발문 번역용)
    const langMap: Record<string, string> = {
      'en': 'English',
      'zh': 'Chinese (Simplified)',
      'ja': 'Japanese',
      'vi': 'Vietnamese',
      'my': 'Burmese (Myanmar)',
      'bn': 'Bengali',
      'mn': 'Mongolian'
    };
    
    const targetLangName = targetLang && targetLang !== 'none' ? langMap[targetLang] || targetLang : null;

    const systemPrompt = `You are an expert educator. Your task is to read the provided video transcript and generate EXACTLY ${qCount} multiple-choice questions based on its key concepts.
CRITICAL REQUIREMENT: You MUST generate exactly ${qCount} questions. No more, no less.

To ensure maximum variety, a random timestamp seed [${timestamp || Date.now()}] is provided. You MUST randomly select different segments, topics, or angles from the transcript to generate unique questions each time. Do not repeatedly focus on the same facts.

Each question MUST have exactly ${optionsCount} choices.
The output MUST be a valid JSON object with two keys: "plan" and "quizzes".
1. "plan": An array of EXACTLY ${qCount} short strings. Each string is a brief topic or concept from the transcript that will be the subject of one question. Count this array to ensure it has exactly ${qCount} items.
2. "quizzes": An array of EXACTLY ${qCount} objects, corresponding exactly to the items in the "plan" array.

Each object in the "quizzes" array must follow this format:
{
  "question": "The question text in Korean",${targetLangName ? `\n  "questionTranslated": "The question text translated into ${targetLangName}",` : ''}
  "choices": ["Choice 1", "Choice 2", "Choice 3", "Choice 4"${optionsCount === 5 ? ', "Choice 5"' : ''}],
  "answer": "The exact string of the correct choice from the choices array",
  "explanation": "A brief explanation in Korean of why this is the correct answer"
}
Do not use markdown wrappers like \`\`\`json. Return only the raw JSON string.`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Transcript:\n\n${transcript}` }
      ],
      response_format: { type: "json_object" },
      temperature: 0.9,
    });

    const content = response.choices[0].message.content;
    if (!content) {
      throw new Error("API 응답이 비어있습니다.");
    }

    const parsedContent = JSON.parse(content);
    return NextResponse.json(parsedContent);

  } catch (error: any) {
    console.error('Quiz Generation Error:', error);
    return NextResponse.json(
      { error: error.message || '시험지 생성 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
