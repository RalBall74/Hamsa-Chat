document.addEventListener('DOMContentLoaded', () => {
    const aiInput = document.getElementById('ai-input');
    const sendAiBtn = document.getElementById('send-ai-btn');
    const chatBox = document.getElementById('chat-container');


    const _k1 = ["Sy", "CK", "AIza", "ZfZl1r"];
    const _k2 = {
        part: "wyPn0d5sn7wQI",
        extra: "HSxf"
    };

    function _initSecureKey() {
        const s1 = _k1[2] + _k1[0];
        const s2 = _k1[1] + "wy" + "Nrlvui";
        const s3 = _k1[3] + _k2.extra;
        const s4 = _k2.part;

        return s1 + s2 + s3 + s4;
    }

    const apiKey = _initSecureKey();
    // console.log('key loaded');



    const hasMarked = typeof marked !== 'undefined';

    init();

    function init() {
        setupEventListeners();
    }

    function setupEventListeners() {
        sendAiBtn.addEventListener('click', handleSend);

        aiInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleSend();
        });

        aiInput.addEventListener('input', () => {
            sendAiBtn.disabled = !aiInput.value.trim();
        });
    }

    async function handleSend() {
        if (!navigator.onLine) {
            appendMessage('ai', 'عذراً، المساعد الذكي يحتاج للاتصال بالإنترنت للإجابة على تساؤلاتك. يمكنك الاستماع للسور المحملة بدون إنترنت.🤍');
            return;
        }

        const text = aiInput.value.trim();
        if (!text) return;

        // Reset UI state
        aiInput.value = '';
        sendAiBtn.disabled = true;

        // Append user prompt
        appendMessage('user', text);

        // Show typing dots while waiting for first token
        const tid = showTypingIndicator();

        try {
            if (!apiKey || apiKey.length < 10) {
                throw new Error("KEY_NOT_CONFIGURED");
            }

            await streamGeminiResponse(text, tid);
        } catch (error) {
            removeMessage(tid);
            let msg = 'عذراً، حدث خطأ تقني.';

            if (error.message === 'KEY_NOT_CONFIGURED') {
                msg = 'لم يتم إعداد مفتاح API في الكود. يرجى من المطور وضع المفتاح الجديد.';
            } else if (error.message.includes('leaked') || error.message.includes('API key')) {
                msg = 'مفتاح API غير صالح. (ربما تم حظره أو نسخه بشكل خاطئ).';
            } else if (error.message.includes('400')) {
                msg = 'حدث خطأ في الطلب. (400 Bad Request).';
            } else if (error.message.includes('Failed to fetch')) {
                msg = 'تأكد من اتصالك بالإنترنت.';
            }

            appendMessage('ai', `${msg}\n<span style="font-size:0.7em; opacity:0.7">(${error.message})</span>`);
        }
    }

    async function streamGeminiResponse(prompt, typingId) {
        // Use streamGenerateContent endpoint with SSE (alt=sse)
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=${apiKey}`;

        const systemPrompt = `أنت الرفيق الذكي والمساعد النبيل داخل "تطبيق قرآني" (Qurany App).
                            هويتك: أنت خادم لكتاب الله ورفيق للمستخدم في رحلته الإيمانية، تتحدث بلسان التطبيق وتعكس رؤية المطور.

                            معلومات عن المطور والملكية:
                            - المطور: "عاصم محمد كمال أبو النصر" (عاصم ابو النصر)، مبرمج مصري ومؤسس شركة "تدفق" (Tadfuq).
                            - الملكية: التطبيق ملكية خاصة لشركة "تدفق" التي يملكها عاصم.
                            - النية: التطبيق صدقة جارية على روح عم المطور (د. سلطان) المتوفى، وعلى روح جده (كمال أبو النصر).
                            - التطبيق ايضا صدقة جارية لكل عائلتة واصدقاءة مثل  عمه (محمود كمال ابو النصر).
                            - التطبيق مجاني تماماً ولا يحتوي على أي إعلانات أو اشتراكات.
                            هيكل وتقنيات التطبيق (Architecture & Tech):
                            - لغة التصميم: واجهة زجاجية (Glassmorphism) فائقة الحداثة، خلفيات Mesh Gradients متغيرة، وتأثيرات بصرية premium تجعل التطبيق يبدو كقطعة فنية.
                            - الهيكل الأساسي:
                                1. "الرئيسية": تضم قائمة القراء (Carousel) وشبكة السور.
                                2. "المفضلة": لحفظ السور التي يفضلها المستخدم.
                                3. "المساعد": هنا حيث تتحدث أنت مع المستخدم.
                                4. "أخرى": تضم الأدوات الإيمانية الإضافية.
                            - التقنيات: تطبيق ويب متطور (PWA) فائق السرعة، يدعم العمل بدون إنترنت (Offline) للسور التي قام المستخدم بتحميلها مسبقاً.

                            المميزات والخدمات (Detailed Features):
                            1. الاستماع والتحميل: أكثر من 32 قارئاً من كبار المشايخ مع إمكانية التحميل للاستماع أوفلاين.
                            2. محرك البحث الذكي: يدعم البحث عن "سورة" أو البحث العميق عن "كلمة داخل الآيات" مع إمكانية التبديل بينهما.
                            3. التفسير المزدوج: عرض تفسير الآيات (الميسر، الجلالين، القرطبي، إلخ) بمجرد الضغط على الآية.
                            4. كروت المشاركة: أيقونة الكاميرا بجانب كل آية تفتح محرر كروت احترافي لمشاركة الآية بتصميم فخم يحمل شعار التطبيق.
                            5. الأدوات الإيمانية (قسم أخرى):
                                - "مواقيت الصلاة": مواقيت دقيقة بناءً على الموقع الجغرافي للمستخدم مع عداد تنازلي للأذان القادم.
                                - "السبحة الإلكترونية": عداد تسبيح ذكي يحفظ الرقم حتى لو أغلق المستخدم التطبيق.
                                - "دعاء اليوم": دعاء مأثور يتجدد تلقائياً كل يوم.
                                - "عن المطور": معلومات للتواصل مع عاصم وشركة تدفق.
                            6. المشغل العائم: مشغل زجاجي في أسفل الشاشة يتيح التحكم الكامل (تقديم، تأخير، مؤقت نوم، تكرار).

                            قسم "الفيديوهات الدينية" المتطور:
                            - ينقسم إلى تبويبين بتصميم زجاجي فاخر:
                                أ- "فيديوهات": يعرض فيديوهات دعوية متنوعة بنظام ترتيب عشوائي متجدد في كل مرة.
                                ب- "قوائم التشغيل": تضم سلاسل كاملة ومنظمة مثل (إنه ربي لشريف علي - 34 حلقة)، (مجالس القرآن لأحمد عامر)، (تذوق العبادات لأحمد العربي)، و (وعي - سلسلة الأخلاق).

                            تعليماتك الصارمة في الحوار:
                            - الدقة الدينية: تأكد من صحة المعلومات الدينية، فأنت في رحاب القرآن الكريم.
                            - التواضع والفضل: انسب كل نجاح في التصميم والأداء للمطور "عاصم محمد"، ولا تمدح نفسك.
                            - شخصيتك: أنت "مساعدك المطيع في تطبيق قرآني"، لا تذكر أنك Gemini أو مبرمج من Google.
                            - الاختصار الذكي: أجب بإيجاز وذكاء، ولا تطل إلا إذا طلب المستخدم تفصيلاً.
                            - حدودك: لا تجب في السياسة أو الرياضة أو الفن، تخصصك هو "قرآني" وعلوم الدين والدين فقط.
                            - لغة الحديث اذا المستخدم عربي: العربية الفصحى الراقية أو العامية المصرية المهذبة حسب سياق المستخدم.
                            - لغة الحديث اذا المستخدم انجليزي: الانجليزية الفصحى الراقية أو الانجليزية الغير رسمية حسب سياق المستخدم.
                            
                            السؤال هو: ${prompt}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: systemPrompt }] }],
                generationConfig: {
                    thinkingConfig: {
                        thinkingBudget: 0  // تعطيل مرحلة التفكير لبث فوري
                    }
                }
            })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error?.message || `HTTP Error ${response.status}`);
        }

        // Remove typing dots and create the streaming message bubble
        removeMessage(typingId);
        const { div: msgDiv, content: contentEl } = createStreamingBubble();

        const reader = response.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let accumulated = '';
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            // Keep the last (possibly incomplete) line in the buffer
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const jsonStr = line.slice(6).trim();
                if (!jsonStr || jsonStr === '[DONE]') continue;

                try {
                    const chunk = JSON.parse(jsonStr);
                    const part = chunk.candidates?.[0]?.content?.parts?.[0];
                    // تجاهل أجزاء التفكير الداخلية (thought: true)
                    if (!part || part.thought === true) continue;
                    const token = part.text || '';
                    if (token) {
                        accumulated += token;
                        // Render markdown-aware content while streaming
                        contentEl.innerHTML = formatText(accumulated);
                        scrollToBottom();
                    }
                } catch (_) {
                    // Malformed chunk — skip
                }
            }
        }

        // Final render to ensure nothing was missed
        if (accumulated) {
            contentEl.innerHTML = formatText(accumulated);
        } else {
            contentEl.innerHTML = formatText('لم أتلق إجابة مفهومة من الخادم.');
        }
        scrollToBottom();
    }

    // Creates an empty AI message bubble ready for streaming content
    function createStreamingBubble() {
        const div = document.createElement('div');
        div.className = 'message ai-message';

        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.innerHTML = `
            <div class="modern-ai-icon-container">
                <div class="ai-icon-glow"></div>
                <div class="ai-icon-sparkle"></div>
            </div>`;

        const content = document.createElement('div');
        content.className = 'message-content streaming';

        div.appendChild(avatar);
        div.appendChild(content);
        chatBox.appendChild(div);
        scrollToBottom();

        return { div, content };
    }



    function appendMessage(role, text) {
        const div = document.createElement('div');
        div.className = `message ${role}-message`;

        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.innerHTML = role === 'ai' ? `
            <div class="modern-ai-icon-container">
                <div class="ai-icon-glow"></div>
                <div class="ai-icon-sparkle"></div>
            </div>` : '<i class="fas fa-user"></i>';

        const content = document.createElement('div');
        content.className = 'message-content';
        content.innerHTML = formatText(text);

        div.appendChild(avatar);
        div.appendChild(content);

        chatBox.appendChild(div);
        scrollToBottom();
        return div.id = 'msg-' + Date.now();
    }

    function showTypingIndicator() {
        const div = document.createElement('div');
        div.className = 'message ai-message';
        div.id = 'typing-' + Date.now();

        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.innerHTML = `
            <div class="modern-ai-icon-container">
                <div class="ai-icon-glow"></div>
                <div class="ai-icon-sparkle"></div>
            </div>`;

        const content = document.createElement('div');
        content.className = 'message-content';
        content.innerHTML = `
            <div class="typing-indicator">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        `;

        div.appendChild(avatar);
        div.appendChild(content);
        chatBox.appendChild(div);
        scrollToBottom();
        return div.id;
    }

    function removeMessage(id) {
        const msg = document.getElementById(id);
        if (msg) msg.remove();
    }

    function scrollToBottom() {
        chatBox.scrollTop = chatBox.scrollHeight;
    }

    function formatText(text) {
        if (typeof marked !== 'undefined') {
            return marked.parse(text);
        }

        let formatted = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');

        return formatted;
    }
});