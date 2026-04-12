import {
    db, onSnapshot, query, where, collection, doc, addDoc, serverTimestamp, updateDoc, deleteDoc
} from './firebase-config.js';

export function extendCalls(HamsterApp) {
    HamsterApp.prototype.toggleCallDropdown = function() {
        const dd = document.getElementById('call-dropdown');
        if (dd) dd.classList.toggle('hidden');
    };

    HamsterApp.prototype.listenForIncomingCalls = function() {
        if (this.incomingCallUnsub) this.incomingCallUnsub();
        
        const q = query(collection(db, 'calls'), where('calleeId', '==', this.user.uid));
        this.incomingCallUnsub = onSnapshot(q, (snap) => {
            const callingDocs = snap.docs.filter(doc => doc.data().status === 'calling');
            
            if (callingDocs.length === 0) {
                if (this.currentCallData && this.currentCallData.status === 'calling' && this.currentCallData.calleeId === this.user.uid) {
                    this.hideCallOverlay();
                    this.currentCallData = null;
                }
                return;
            }

            const callDoc = callingDocs[0];
            const data = callDoc.data();
            data.id = callDoc.id;

            if (this.currentCallData && this.currentCallData.id === data.id && this.currentCallData.status !== 'calling') return;

            this.currentCallData = data;
            this.isVideoCall = data.callType === 'video';
            
            const callerName = data.callerName || 'Unknown';
            const callerPhoto = data.callerPhoto || 'assets/logo.jpg';
            const typeLabel = this.isVideoCall 
                ? (this.lang === 'ar' ? 'مكالمة فيديو واردة...' : 'Incoming Video Call...') 
                : (this.lang === 'ar' ? 'مكالمة صوتية واردة...' : 'Incoming Voice Call...');
            
            this.playRingtone();
            this.showCallOverlay(callerName, callerPhoto, 'incoming', typeLabel);
        });
    };

    HamsterApp.prototype.startCall = async function(chatId, callType = 'audio') {
        if (!this.agoraAppId || this.agoraAppId === "") {
            this.showAlert(this.lang === 'ar' ? 'تذكير' : 'Setup Required', this.lang === 'ar' ? 'الرجاء إدخال Agora App ID الخاص بك في ملف app.js.' : 'Please insert your Agora App ID in app.js inside the constructor.');
            return;
        }

        const chat = this.allChats.find(c => c.id === chatId);
        if (!chat || chat.type === 'group') {
            this.showAlert(this.lang === 'ar' ? 'غير مدعوم' : 'Unsupported', this.lang === 'ar' ? 'المكالمات غير مدعومة للمجموعات بعد.' : 'Group calls are not supported yet.');
            return;
        }

        const blockedBy = chat.blockedBy || [];
        if (blockedBy.length > 0) {
            this.showAlert(this.lang === 'ar' ? 'مكالمة مقفلة' : 'Call Blocked', this.lang === 'ar' ? 'لا يمكنك إجراء مكالمات في محادثة محظورة.' : 'You cannot make calls in a blocked conversation.');
            return;
        }

        this.isVideoCall = callType === 'video';
        const partner = this.getChatPartner(chat);
        const calleeId = chat.memberIds.find(id => id !== this.user.uid);

        if (!calleeId) return;

        try {
            const callDocRef = await addDoc(collection(db, 'calls'), {
                chatId: chatId,
                callerId: this.user.uid,
                calleeId: calleeId,
                callerName: this.userData.displayName,
                callerPhoto: this.userData.photoURL,
                callType: callType,
                status: 'calling',
                channelName: chatId,
                createdAt: serverTimestamp()
            });

            this.currentCallData = { id: callDocRef.id, status: 'calling', channelName: chatId, callType: callType };
            const statusLabel = this.isVideoCall
                ? (this.lang === 'ar' ? 'مكالمة فيديو...' : 'Video Calling...')
                : (this.lang === 'ar' ? 'جاري الاتصال...' : 'Calling...');
            this.playRingtone();
            this.showCallOverlay(partner.name, partner.photo, 'outgoing', statusLabel);

            // Listen for answer/reject
            if (this.activeCallListener) this.activeCallListener();
            this.activeCallListener = onSnapshot(doc(db, 'calls', callDocRef.id), async (docSnap) => {
                if (!docSnap.exists()) {
                    this.endCall(true);
                    return;
                }
                const data = docSnap.data();
                if (data.status === 'answered') {
                    this.stopRingtone();
                    this.currentCallData.status = 'answered';
                    document.getElementById('call-status').innerText = '00:00';
                    document.getElementById('call-actions-outgoing').classList.add('hidden');
                    document.getElementById('call-actions-active').classList.remove('hidden');
                    // Always show camera button to allow switching
                    document.getElementById('call-cam-btn').style.display = 'flex';
                    this.startCallTimer();
                    await this.joinAgoraChannel(data.channelName);
                } else if (data.status === 'rejected' || data.status === 'ended') {
                    this.endCall(true);
                }
            });
        } catch (e) {
            console.error("Start call error:", e);
            this.showAlert('Error', 'Failed to start call: ' + e.message + "\n\n(Have you updated the Firestore Rules?)");
        }
    };

    HamsterApp.prototype.playRingtone = function() {
        const audio = document.getElementById('call-ringtone-audio');
        if (audio) {
            audio.currentTime = 0;
            audio.play().catch(e => console.warn("Ringtone play failed:", e));
        }
    };

    HamsterApp.prototype.stopRingtone = function() {
        const audio = document.getElementById('call-ringtone-audio');
        if (audio) {
            audio.pause();
            audio.currentTime = 0;
        }
    };

    HamsterApp.prototype.toggleCallMinimize = function() {
        const overlay = document.getElementById('call-overlay');
        const isMinimized = overlay.classList.toggle('minimized');
        const btn = document.querySelector('#call-top-bar button i');
        if (btn) {
            btn.setAttribute('data-lucide', isMinimized ? 'maximize-2' : 'minimize-2');
            if (window.lucide) lucide.createIcons();
        }
    };

    HamsterApp.prototype.answerCall = async function() {
        if (!this.currentCallData || this.currentCallData.status !== 'calling') return;
        
        try {
            this.stopRingtone();
            this.currentCallData.status = 'answered';
            
            document.getElementById('call-actions-incoming').classList.add('hidden');
            document.getElementById('call-actions-active').classList.remove('hidden');
            document.getElementById('call-status').innerText = '00:00';
            // Always show camera button to allow switching
            document.getElementById('call-cam-btn').style.display = 'flex';
            this.startCallTimer();

            await updateDoc(doc(db, 'calls', this.currentCallData.id), { status: 'answered', answeredAt: serverTimestamp() });
            
            if (this.activeCallListener) this.activeCallListener();
            this.activeCallListener = onSnapshot(doc(db, 'calls', this.currentCallData.id), (docSnap) => {
                if (!docSnap.exists() || docSnap.data().status === 'ended') {
                    this.endCall(true);
                }
            });

            await this.joinAgoraChannel(this.currentCallData.channelName);
        } catch (e) {
            console.error("Answer err:", e);
            this.endCall();
        }
    };

    HamsterApp.prototype.rejectCall = async function() {
        if (this.currentCallData && this.currentCallData.id) {
            try {
                await deleteDoc(doc(db, 'calls', this.currentCallData.id));
            } catch (e) { console.error(e); }
        }
        this.hideCallOverlay();
        this.currentCallData = null;
    };

    HamsterApp.prototype.endCall = async function(isRemote = false) {
        if (!this.currentCallData) {
            this.hideCallOverlay();
            return;
        }

        if (!isRemote && this.currentCallData.id) {
            try {
                await deleteDoc(doc(db, 'calls', this.currentCallData.id));
            } catch (e) { console.error(e); }
        }

        this.leaveAgoraChannel();
        this.stopRingtone();
        this.hideCallOverlay();
        if (this.activeCallListener) {
            this.activeCallListener();
            this.activeCallListener = null;
        }
        this.currentCallData = null;
        this.isVideoCall = false;
        clearInterval(this.callTimer);
    };

    HamsterApp.prototype.joinAgoraChannel = async function(channelName) {
        if (!window.AgoraRTC) {
            console.error("Agora SDK not loaded");
            return;
        }
        if (!this.agoraClient) {
            this.agoraClient = AgoraRTC.createClient({ mode: "rtc", codec: "vp8" });
            
            this.agoraClient.on("user-published", async (user, mediaType) => {
                await this.agoraClient.subscribe(user, mediaType);
                if (mediaType === "audio") {
                    user.audioTrack.play();
                }
                if (mediaType === "video") {
                    const remoteContainer = document.getElementById('remote-video-container');
                    remoteContainer.style.display = 'block';
                    remoteContainer.innerHTML = '';
                    user.videoTrack.play(remoteContainer);
                    // In video call, hide static avatar/name when remote video appears
                    document.getElementById('call-avatar').style.display = 'none';
                    document.getElementById('call-name').style.display = 'none';
                }
            });

            this.agoraClient.on("user-unpublished", (user, mediaType) => {
                if (mediaType === "video") {
                    const remoteContainer = document.getElementById('remote-video-container');
                    remoteContainer.style.display = 'none';
                    remoteContainer.innerHTML = '';
                    // Re-show avatar if remote stops video
                    document.getElementById('call-avatar').style.display = 'block';
                    document.getElementById('call-name').style.display = 'block';
                }
            });

            this.agoraClient.on("network-quality", (quality) => {
                const indicator = document.getElementById('call-network-quality');
                const label = indicator.querySelector('span');
                const icon = indicator.querySelector('i');
                
                // 0: Unknown, 1: Excellent, 2: Good, 3: Poor, 4: Bad, 5: Very Bad, 6: Down
                if (quality.downlinkNetworkQuality <= 2) {
                    indicator.style.color = '#10b981';
                    label.innerText = this.lang === 'ar' ? 'ممتاز' : 'Excellent';
                } else if (quality.downlinkNetworkQuality <= 4) {
                    indicator.style.color = '#f59e0b';
                    label.innerText = this.lang === 'ar' ? 'جيد' : 'Good';
                } else if (quality.downlinkNetworkQuality <= 5) {
                    indicator.style.color = '#ef4444';
                    label.innerText = this.lang === 'ar' ? 'ضعيف' : 'Poor';
                } else {
                    indicator.style.color = '#ef4444';
                    label.innerText = this.lang === 'ar' ? 'سيء جداً' : 'Bad';
                }
            });
        }

        try {
            await this.agoraClient.join(this.agoraAppId, channelName, null, null);

            // Audio track (always)
            this.localAudioTrack = await AgoraRTC.createMicrophoneAudioTrack();
            
            if (this.isVideoCall) {
                // Video track
                this.localVideoTrack = await AgoraRTC.createCameraVideoTrack();
                await this.agoraClient.publish([this.localAudioTrack, this.localVideoTrack]);
                
                // Play local preview in small PiP
                const localContainer = document.getElementById('local-video-container');
                localContainer.style.display = 'block';
                localContainer.innerHTML = '';
                this.localVideoTrack.play(localContainer);
                
                console.log("Joined Agora Video Call");
            } else {
                await this.agoraClient.publish([this.localAudioTrack]);
                console.log("Joined Agora Voice Call");
            }
        } catch (e) {
            console.error("Agora join failed:", e);
            if (e.message && (e.message.includes("PERMISSION_DENIED") || e.message.includes("NotAllowedError"))) {
                this.showAlert(this.lang === 'ar' ? 'صلاحيات مطلوبة' : 'Permissions Required', this.lang === 'ar' ? 'يرجى السماح للتطبيق باستخدام الميكروفون والكاميرا.' : 'Please grant microphone and camera permissions.');
            } else {
                this.showAlert('Call Error', 'Error: ' + (e.message || 'Could not join room.'));
            }
            this.endCall();
        }
    };

    HamsterApp.prototype.leaveAgoraChannel = async function() {
        if (this.localAudioTrack) {
            this.localAudioTrack.stop();
            this.localAudioTrack.close();
            this.localAudioTrack = null;
        }
        if (this.localVideoTrack) {
            this.localVideoTrack.stop();
            this.localVideoTrack.close();
            this.localVideoTrack = null;
        }
        if (this.agoraClient) {
            await this.agoraClient.leave();
        }
        // Clear video containers
        document.getElementById('remote-video-container').innerHTML = '';
        document.getElementById('remote-video-container').style.display = 'none';
        document.getElementById('local-video-container').innerHTML = '';
        document.getElementById('local-video-container').style.display = 'none';
        console.log("Left Agora Call");
    };

    HamsterApp.prototype.toggleMuteCall = function() {
        if (this.localAudioTrack) {
            const isMuted = !this.localAudioTrack.muted;
            this.localAudioTrack.setMuted(isMuted);
            const btn = document.getElementById('call-mute-btn');
            if (isMuted) {
                btn.style.background = '#ef4444';
                btn.innerHTML = '<i data-lucide="mic-off"></i>';
            } else {
                btn.style.background = 'rgba(255,255,255,0.1)';
                btn.innerHTML = '<i data-lucide="mic"></i>';
            }
            if (window.lucide) lucide.createIcons({ node: btn });
        }
    };

    HamsterApp.prototype.toggleCameraCall = async function() {
        const btn = document.getElementById('call-cam-btn');
        if (this.localVideoTrack) {
            // Camera is ON -> Turn OFF
            this.localVideoTrack.stop();
            this.localVideoTrack.close();
            await this.agoraClient.unpublish([this.localVideoTrack]);
            this.localVideoTrack = null;
            document.getElementById('local-video-container').style.display = 'none';
            document.getElementById('local-video-container').innerHTML = '';
            btn.style.background = '#ef4444';
            btn.innerHTML = '<i data-lucide="video-off"></i>';
        } else {
            // Camera is OFF -> Turn ON
            try {
                this.localVideoTrack = await AgoraRTC.createCameraVideoTrack();
                await this.agoraClient.publish([this.localVideoTrack]);
                const localContainer = document.getElementById('local-video-container');
                localContainer.style.display = 'block';
                localContainer.innerHTML = '';
                this.localVideoTrack.play(localContainer);
                btn.style.background = 'rgba(255,255,255,0.1)';
                btn.innerHTML = '<i data-lucide="video"></i>';
            } catch (e) {
                console.error("Camera toggle err:", e);
                this.showAlert('Error', this.lang === 'ar' ? 'تعذر تشغيل الكاميرا.' : 'Could not enable camera.');
            }
        }
        if (window.lucide) lucide.createIcons({ node: btn });
    };

    HamsterApp.prototype.showCallOverlay = function(name, photo, state, statusText) {
        // Set partner info
        document.getElementById('call-name').innerText = name;
        document.getElementById('call-avatar').src = photo || 'assets/logo.jpg';
        document.getElementById('call-status').innerText = statusText;

        // Set my own info (the logged-in user)
        if (this.userData) {
            document.getElementById('call-my-avatar').src = this.userData.photoURL || 'assets/logo.jpg';
            document.getElementById('call-my-name').innerText = this.userData.displayName || '';
        }

        // Reset visibility of dynamic elements
        document.getElementById('call-avatar').style.display = 'block';
        document.getElementById('call-name').style.display = 'block';
        document.getElementById('call-actions-incoming').classList.add('hidden');
        document.getElementById('call-actions-outgoing').classList.add('hidden');
        document.getElementById('call-actions-active').classList.add('hidden');
        document.getElementById('call-cam-btn').style.display = 'none';
        
        // Ensure draggable is initialized
        this.initCallDraggable();

        document.getElementById('remote-video-container').style.display = 'none';
        document.getElementById('local-video-container').style.display = 'none';

        if (state === 'incoming') {
            document.getElementById('call-actions-incoming').classList.remove('hidden');
        } else if (state === 'outgoing') {
            document.getElementById('call-actions-outgoing').classList.remove('hidden');
        } else if (state === 'active') {
            document.getElementById('call-actions-active').classList.remove('hidden');
            document.getElementById('call-cam-btn').style.display = 'flex';
        }

        document.getElementById('call-overlay').classList.remove('hidden');
        if (window.lucide) lucide.createIcons();
    };

    HamsterApp.prototype.hideCallOverlay = function() {
        const overlay = document.getElementById('call-overlay');
        overlay.classList.add('hidden');
        overlay.classList.remove('minimized');
        document.getElementById('remote-video-container').style.display = 'none';
        document.getElementById('local-video-container').style.display = 'none';
        this.stopRingtone();
        clearInterval(this.callTimer);
    };

    HamsterApp.prototype.startCallTimer = function() {
        let seconds = 0;
        clearInterval(this.callTimer);
        this.callTimer = setInterval(() => {
            seconds++;
            const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
            const secs = (seconds % 60).toString().padStart(2, '0');
            const statusEl = document.getElementById('call-status');
            if (statusEl) statusEl.innerText = `${mins}:${secs}`;
        }, 1000);
    };

    HamsterApp.prototype.initCallDraggable = function() {
        const overlay = document.getElementById('call-overlay');
        if (overlay.dataset.draggableInit) return;
        overlay.dataset.draggableInit = "true";

        let isDragging = false;
        let startX, startY, initialX, initialY;

        const onStart = (e) => {
            if (!overlay.classList.contains('minimized')) return;
            isDragging = true;
            const event = e.type.includes('touch') ? e.touches[0] : e;
            startX = event.clientX;
            startY = event.clientY;
            
            const rect = overlay.getBoundingClientRect();
            initialX = rect.left;
            initialY = rect.top;
            
            overlay.style.transition = 'none';
            e.preventDefault();
        };

        const onMove = (e) => {
            if (!isDragging) return;
            const event = e.type.includes('touch') ? e.touches[0] : e;
            const dx = event.clientX - startX;
            const dy = event.clientY - startY;
            
            const newX = initialX + dx;
            const newY = initialY + dy;
            
            overlay.style.left = `${newX}px`;
            overlay.style.top = `${newY}px`;
            overlay.style.right = 'auto';
            overlay.style.bottom = 'auto';
            overlay.style.inset = 'auto';
        };

        const onEnd = () => {
            if (!isDragging) return;
            isDragging = false;
            overlay.style.transition = 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)';
        };

        overlay.addEventListener('mousedown', onStart);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onEnd);

        overlay.addEventListener('touchstart', onStart, { passive: false });
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onEnd);
    };
}
