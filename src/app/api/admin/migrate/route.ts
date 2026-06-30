import { NextResponse } from "next/server";
import { db } from "@/lib/firebase";
import { collection, getDocs, doc, updateDoc } from "firebase/firestore";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";

export async function GET() {
  try {
    const TARGET_UID = '6RgW1uS7KZglGmJeKHOj1uia5ej1'; // UID for ilseok_hong@difinition.co.kr

    console.log("Logging in as admin inside API...");
    const auth = getAuth();
    await signInWithEmailAndPassword(auth, 'admin@unicon.com', 'admin1234!');
    console.log("Admin logged in successfully inside API.");

    console.log("Starting API migration for anonymous projects...");
    
    // 1. Migrate subedit_history
    const historySnap = await getDocs(collection(db, "subedit_history"));
    let historyMigratedCount = 0;
    let historyTotalCount = 0;

    for (const docSnap of historySnap.docs) {
      historyTotalCount++;
      const data = docSnap.data();
      if (!data.userId) {
        await updateDoc(doc(db, "subedit_history", docSnap.id), {
          userId: TARGET_UID
        });
        historyMigratedCount++;
      }
    }

    // 2. Migrate unicon_exams
    const examsSnap = await getDocs(collection(db, "unicon_exams"));
    let examsMigratedCount = 0;
    let examsTotalCount = 0;

    for (const docSnap of examsSnap.docs) {
      examsTotalCount++;
      const data = docSnap.data();
      if (!data.userId) {
        await updateDoc(doc(db, "unicon_exams", docSnap.id), {
          userId: TARGET_UID
        });
        examsMigratedCount++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `Migration complete. subedit_history: ${historyMigratedCount}/${historyTotalCount} migrated. unicon_exams: ${examsMigratedCount}/${examsTotalCount} migrated.`,
    });
  } catch (err: any) {
    console.error("Migration error:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
