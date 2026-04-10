import {
    db, doc, setDoc, serverTimestamp, updateDoc
} from './firebase-config.js';

export function extendAI(HamsterApp) {
    HamsterApp.prototype.handleAIMessage = async function(chatId, text) {
        if (!text) return;
        
        const chatRef = doc(db, 'chats', chatId);
        const userMsgRef = doc(db, `chats/${chatId}/messages`, Date.now().toString());
        
        // 1. Save User Message
        await setDoc(userMsgRef, {
            text,
            senderId: this.user.uid,
            createdAt: serverTimestamp(),
            status: 'read'
        });

        // 2. Visual indicators
        document.getElementById('msg-input').value = '';
        setTimeout(() => this.scrollToBottom(), 100);

        // 3. AI Thinking State
        await updateDoc(chatRef, { typing: { 'hamster_ai_bot': true } });

        try {
            const aiReply = await this.fetchGeminiReply(text);
            
            // 4. Save AI Response
            const aiMsgRef = doc(db, `chats/${chatId}/messages`, (Date.now() + 1).toString());
            await setDoc(aiMsgRef, {
                text: aiReply,
                senderId: 'hamster_ai_bot',
                createdAt: serverTimestamp(),
                status: 'read'
            });

            // Update chat metadata
            await setDoc(chatRef, {
                lastMessage: { text: aiReply, senderId: 'hamster_ai_bot' },
                updatedAt: serverTimestamp()
            }, { merge: true });

        } catch (err) {
            console.error(err);
            this.showAlert('AI Error', this.lang === 'ar' ? 'فشل الهامستر في الرد. تأكد من اتصالك بالإنترنت.' : 'Hamster failed to reply. Check your connection.');
        } finally {
            await setDoc(chatRef, { typing: { 'hamster_ai_bot': false } }, { merge: true });
        }
    };

    HamsterApp.prototype.fetchGeminiReply = async function(promptStr) {
        // Build obfuscated API Key
        const p1 = 'AIzaSyAB2C';
        const p2 = '-KK_ILwo';
        const p3 = '0IqTeA66';
        const p4 = 'JLZEh1';
        const p5 = 'BaR1KFo';
        const apiKey = [p1, p2, p3, p4, p5].join('');

        const systemPrompt = `أنت هو (هامستر)، المساعد الذكي والرفيق الرسمي والذراع التقني لمستخدمي تطبيق "هامستر شات".
شخصيتك:
- ذكي، لبق، وفخور بعملك.
- المطور هو "البشمهندس عاصم أبو النصر" (نادِه بالبشمهندس، ولكن لا تكرر اللقب كثيراً ليكون الكلام طبيعياً).
- عاصم عمره 15 عاماً وهو "ملك البرمجة".
- هدفك الأساسي: خدمة المستخدمين بالرد على أسئلتهم بذكاء وبطريقة ودودة بالعامية المصرية.او الانجليزية حسب لغة المستخدم

عن التطبيق (Hamster Chat):
- تصميم فخم (Glassmorphism / Dark Mode).
- ميزات قوية (مكالمات، ستوري، أمان فائق).
- تكنولوجيا: Firebase و JavaScript.

مشاريع أخرى للبشمهندس عاصم:
- "قراني": https://ralball74.github.io/qurany.assem/ (موقع اسلامي متكامل)
- "متجر تدفق": https://ralball74.github.io/TadfuqStore/ (موقع تطبيقات تدفق)

تعليمات الحوار الهامة:
- كن مختصراً جداً ولا تحشو كلاماً بدون فائدة.
- ممنوع تماماً استخدام أكواد HTML.
- ممنوع استخدام روابط ماركداون [اسم](رابط)، فقط اكتب الرابط الصريح.
- لا تكرر لقب المطور في كل سطر، ذكره مرة واحدة يكفي.
- كن طبيعياً جداً في ردودك وابعد عن الأسلوب الروبوتي الجاف.
- لا تذكر أنك Gemini أبداً.

السؤال هو: ${promptStr}`;

        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                contents: [{ parts: [{ text: systemPrompt }] }]
            })
        });
        const data = await res.json();
        console.log("Hamster AI Response:", data);

        if (data.error) {
            return `API Error: ${data.error.message}`;
        }

        if (data.candidates && data.candidates[0].finishReason === 'SAFETY') {
            return 'عذراً، تم حجب الرد بسبب معايير السلامة.';
        }

        return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from Hamster AI. Check console for details.';
    };

    HamsterApp.prototype.markdownToHTML = function(text) {
        let html = text
            .replace(/&/g, "&amp;")
            .replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" style="color: inherit; text-decoration: underline;">$1</a>') // Markdown Links
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
            .replace(/\n\s*\*\s(.*?)/g, '<br>• $1') // Lists
            .replace(/`(.*?)`/g, '<code style="background: rgba(0,0,0,0.1); padding: 2px 4px; border-radius: 4px; font-family: monospace;">$1</code>') // Inline Code
            .replace(/\n/g, '<br>');
        
        return this.linkify(html);
    };
}
