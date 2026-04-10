import { db, doc, setDoc, updateDoc, addDoc, collection, serverTimestamp } from './firebase-config.js';

export function extendMedia(HamsterApp) {
    HamsterApp.prototype.viewImage = function(src, canDownload = true) {
        const viewer = document.getElementById('image-viewer');
        const img = document.getElementById('full-view-image');
        const dlBtn = document.getElementById('download-img-btn');
        if (!viewer || !img) return;
        img.src = src;
        viewer.classList.remove('hidden');
        img.oncontextmenu = (e) => e.preventDefault();
        if (canDownload) {
            dlBtn.style.display = 'flex';
            dlBtn.onclick = () => this.downloadImage(src);
        } else {
            dlBtn.style.display = 'none';
        }
        if (window.lucide) lucide.createIcons();
    };

    HamsterApp.prototype.closeImageViewer = function() {
        const viewer = document.getElementById('image-viewer');
        if (viewer) viewer.classList.add('hidden');
    };

    HamsterApp.prototype.downloadImage = async function(url) {
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = `hamster-image-${Date.now()}.jpg`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
        } catch (e) {
            console.error("Download failed:", e);
            window.open(url, '_blank');
        }
    };

    HamsterApp.prototype.startRecording = async function() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            return alert(this.lang === 'ar' ? 'المتصفح لا يدعم التسجيل الصوتي' : 'Browser does not support recording');
        }
        try {
            this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
            this._recordedMimeType = mimeType;
            this.mediaRecorder = new MediaRecorder(this.audioStream, { mimeType });
            this.audioChunks = [];
            this.mediaRecorder.ondataavailable = e => { if (e.data.size > 0) this.audioChunks.push(e.data); };
            this.mediaRecorder.onstop = () => this.handleAudioUpload();
            this.mediaRecorder.start();
            const voiceBtn = document.getElementById('voice-btn');
            if (voiceBtn) { voiceBtn.style.color = '#ef4444'; voiceBtn.style.transform = 'scale(1.2)'; }
        } catch (e) {
            console.error(e);
            alert(this.lang === 'ar' ? 'فشل الوصول للميكروفون' : 'Mic access denied');
        }
    };

    HamsterApp.prototype.stopRecording = function() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
            if (this.audioStream) this.audioStream.getTracks().forEach(t => t.stop());
            const voiceBtn = document.getElementById('voice-btn');
            if (voiceBtn) { voiceBtn.style.color = 'var(--text-secondary)'; voiceBtn.style.transform = 'scale(1)'; }
            this.scrollToBottom();
        }
    };

    HamsterApp.prototype.handleAudioUpload = async function() {
        if (this.audioChunks.length === 0) return;
        const audioBlob = new Blob(this.audioChunks, { type: this._recordedMimeType || 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
            const base64Audio = reader.result;
            if (this.activeChatId) {
                const chat = this.allChats.find(c => c.id === this.activeChatId);
                let preE2E = { audio: base64Audio };
                let e2eData = preE2E;
                if (chat && chat.type !== 'ai') {
                    e2eData = await this.encryptMessagePayload(chat, preE2E);
                }

                const payload = { senderId: this.user.uid, createdAt: serverTimestamp(), status: 'sent', ...e2eData };
                if (this.replyToMsgId) payload.replyTo = this.replyToMsgId;
                const msgRef = await addDoc(collection(db, `chats/${this.activeChatId}/messages`), payload);
                const text = this.lang === 'ar' ? '🔒 وسائط مشفرة' : '🔒 Encrypted Media';
                await updateDoc(doc(db, 'chats', this.activeChatId), { updatedAt: serverTimestamp(), lastMessage: { text, senderId: this.user.uid, msgId: msgRef.id, ...e2eData }, ...this.getUnreadCountsUpdate(chat) });
                this.cancelReply();
            }
        };
    };

    HamsterApp.prototype.toggleGifPicker = async function(chatId) {
        const container = document.getElementById('gif-picker-container');
        if (container.classList.contains('hidden')) {
            container.classList.remove('hidden');
            this.searchGiphy('', chatId);
        } else {
            container.classList.add('hidden');
        }
    };

    HamsterApp.prototype.searchGiphy = async function(queryText, chatId) {
        const apiKey = 'yLtVx79gZR2UkbElF8g8O8HSM8hSuzYp';
        const url = queryText 
            ? `https://api.giphy.com/v1/gifs/search?api_key=${apiKey}&q=${encodeURIComponent(queryText)}&limit=20`
            : `https://api.giphy.com/v1/gifs/trending?api_key=${apiKey}&limit=20`;
        try {
            const res = await fetch(url);
            const json = await res.json();
            const grid = document.getElementById('gif-grid');
            if (!grid) return;
            grid.innerHTML = json.data.map(gif => {
                const url = gif.images.fixed_height_small.url;
                return `<img src="${url}" style="width: 100%; height: 80px; object-fit: cover; border-radius: 6px; cursor: pointer;" onclick="app.sendGif('${url}', '${chatId}')">`;
            }).join('');
        } catch (e) { console.error("Giphy Search Error", e); }
    };

    HamsterApp.prototype.sendGif = async function(gifUrl, chatId) {
        document.getElementById('gif-picker-container').classList.add('hidden');
        const searchInput = document.getElementById('gif-search');
        if(searchInput) searchInput.value = '';
        const chat = this.allChats.find(c => c.id === chatId);
        let preE2E = { gifUrl };
        let e2eData = preE2E;
        if (chat && chat.type !== 'ai') {
            e2eData = await this.encryptMessagePayload(chat, preE2E);
        }

        const payload = { chatId, senderId: this.user.uid, createdAt: serverTimestamp(), status: 'sent', ...e2eData };
        if (this.replyToMsgId) { payload.replyTo = this.replyToMsgId; this.clearReply(); }
        const msgRef = doc(collection(db, `chats/${chatId}/messages`));
        await setDoc(msgRef, payload);
        const chatRef = doc(db, 'chats', chatId);
        const text = this.lang === 'ar' ? '🔒 وسائط مشفرة' : '🔒 Encrypted Media';
        await setDoc(chatRef, { updatedAt: serverTimestamp(), lastMessage: { text, senderId: this.user.uid, ...e2eData }, ...this.getUnreadCountsUpdate(chat) }, { merge: true });
        this.scrollToBottom();
    };

    HamsterApp.prototype.toggleAudio = function(btn, msgId) {
        const audio = document.getElementById(`audio-${msgId}`);
        const icon = document.getElementById(`icon-${msgId}`);
        if (audio.paused) {
            document.querySelectorAll('audio').forEach(a => {
                if (a.id.startsWith('audio-') && a.id !== `audio-${msgId}`) {
                    a.pause();
                    const otherId = a.id.replace('audio-', '');
                    const otherIcon = document.getElementById(`icon-${otherId}`);
                    if (otherIcon) otherIcon.setAttribute('data-lucide', 'play');
                }
            });
            audio.play();
            icon.setAttribute('data-lucide', 'pause');
        } else {
            audio.pause();
            icon.setAttribute('data-lucide', 'play');
        }
        lucide.createIcons();
    };

    HamsterApp.prototype.updateAudioProgress = function(msgId) {
        const audio = document.getElementById(`audio-${msgId}`);
        const slider = document.querySelector(`#player-${msgId} .wa-audio-slider`);
        const timeDisplay = document.getElementById(`dur-${msgId}`);
        const bars = document.querySelectorAll(`#player-${msgId} .wa-waveform-bar`);
        if (audio && slider) {
            const progress = (audio.currentTime / audio.duration) * 100;
            slider.value = progress || 0;
            const activeBarsCount = Math.floor((progress / 100) * bars.length);
            bars.forEach((bar, index) => {
                if (index < activeBarsCount) bar.classList.add('active');
                else bar.classList.remove('active');
            });
            timeDisplay.innerText = this.formatTime(audio.currentTime);
        }
    };

    HamsterApp.prototype.seekAudio = function(slider, msgId) {
        const audio = document.getElementById(`audio-${msgId}`);
        if (audio && audio.duration) audio.currentTime = (slider.value / 100) * audio.duration;
    };

    HamsterApp.prototype.resetAudioPlayer = function(msgId) {
        const icon = document.getElementById(`icon-${msgId}`);
        const slider = document.querySelector(`#player-${msgId} .wa-audio-slider`);
        const bars = document.querySelectorAll(`#player-${msgId} .wa-waveform-bar`);
        if (icon) { icon.setAttribute('data-lucide', 'play'); lucide.createIcons(); }
        if (slider) slider.value = 0;
        bars.forEach(bar => bar.classList.remove('active'));
    };

    HamsterApp.prototype.setAudioDuration = function(msgId) {
        const audio = document.getElementById(`audio-${msgId}`);
        const timeDisplay = document.getElementById(`dur-${msgId}`);
        if (!audio || !timeDisplay) return;
        if (audio.duration && isFinite(audio.duration) && audio.duration < 3600) {
            timeDisplay.innerText = this.formatTime(audio.duration);
            return;
        }
        try {
            const src = audio.src;
            if (!src) return;
            const decode = (buffer) => {
                const ctx = new (window.AudioContext || window.webkitAudioContext)();
                ctx.decodeAudioData(buffer, (decoded) => { timeDisplay.innerText = this.formatTime(decoded.duration); });
            };
            if (src.startsWith('data:')) {
                const base64 = src.split(',')[1];
                const binaryStr = atob(base64);
                const bytes = new Uint8Array(binaryStr.length);
                for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
                decode(bytes.buffer);
            } else { fetch(src).then(r => r.arrayBuffer()).then(decode); }
        } catch (e) { console.error("Audio duration fallback failed", e); }
    };
}
