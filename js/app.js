import {
    auth, db, googleProvider,
    onAuthStateChanged, signInWithPopup, signOut,
    collection, onSnapshot, query, orderBy, where, doc, getDoc, setDoc, serverTimestamp, getDocs, writeBatch, addDoc, updateDoc, deleteDoc, limit
} from './firebase-config.js';

class HamsterApp {
    constructor() {
        this.user = null;
        this.userData = null;
        this.activeChatId = null;
        this.allChats = [];
        this.currentMessages = {};
        this.messagesUnsubscribe = null;
        this.lastGroupCreationTime = 0; // Throttling group creation
        this.isCreatingGroup = false; // Loading state
        this.currentPinInput = "";
        this.isLocked = false;
        this.deferredPrompt = null;
        this.lang = 'en';
        this.messageLimit = 50; // Pagination
        this.isSearching = false;
        this.typingTimeout = null;
        this.strings = {
            en: {
                chats: "Chats", messages: "Messages", stories: "Stories", archive: "Archived", settings: "Preferences",
                profile: "Account", search: "Search accounts and chats...", no_records: "No records.",
                zero_archived: "Zero archived chats.", no_convs: "No conversations.",
                msg_placeholder: "Message...", start_context: "Start Context", private_chat: "Private Chat",
                group_chat: "Group Chat", email_user_placeholder: "Username",
                dismiss: "Dismiss", connect: "Connect", group_name_placeholder: "Group Designation",
                members_placeholder: "Members (emails or usernames, comma separated)",
                form_group: "Form Group", sync_profile: "Sync Profile", sign_out: "Sign Out of App",
                app_theme: "App Theme", light_mode: "Light Mode", dark_mode: "Dark Mode",
                desktop_notifs: "Enable Desktop Notifications", read_receipts: "Broadcast Read Meta-Receipts",
                commit: "Commit Changes", language: "Language", english: "English", arabic: "Arabic",
                display_name: "Display Name", about_app: "About Hamster Chat"
            },
            ar: {
                chats: "المحادثات", messages: "الرسائل", stories: "القصص", archive: "الأرشيف", settings: "التفضيلات",
                profile: "الحساب", search: "ابحث عن الحسابات والمحادثات...", no_records: "لا توجد نتائج.",
                zero_archived: "لا توجد محادثات مؤرشفة.", no_convs: "لا توجد محادثات.",
                msg_placeholder: "اكتب رسالة...", start_context: "بدء محادثة", private_chat: "محادثة خاصة",
                group_chat: "مجموعة", email_user_placeholder: "البريد الإلكتروني أو اسم المستخدم",
                dismiss: "إلغاء", connect: "اتصال", group_name_placeholder: "اسم المجموعة",
                members_placeholder: "الأعضاء (ايميلات أو يوزرات، مفصولة بفاصلة)",
                form_group: "إنشاء المجموعة", sync_profile: "تحديث الحساب", sign_out: "تسجيل الخروج",
                app_theme: "سمة التطبيق", light_mode: "الوضع المضيء", dark_mode: "الوضع الليلي",
                desktop_notifs: "تفعيل تنبيهات المتصفح", read_receipts: "بث مؤشرات قراءة الرسائل",
                commit: "حفظ التغييرات", language: "اللغة", english: "English", arabic: "العربية",
                display_name: "الاسم المستعار", about_app: "عن التطبيق"
            }
        };
        this.init();
    }

    init() {
        this.loadLang();
        this.loadTheme();
        this.loadWallpaper();
        this.loadLock();
        
        // Show Lock Screen immediately if PIN exists in localStorage
        if (this.userData?.appLockPin) {
            this.showLockScreen();
        }

        this.setupAuth();
        this.setupNav();
        this.setupSearch();
        this.handleNavigation('chats');
        lucide.createIcons();
        this.registerSW();

        // Handle QR/Join links
        const urlParams = new URLSearchParams(window.location.search);
        const joinId = urlParams.get('joinGroup');
        if (joinId) this.handleGroupJoinLink(joinId);
    }

    registerSW() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./sw.js')
                    .then(reg => console.log('SW: Registered', reg))
                    .catch(err => console.error('SW: Registration failed', err));
            });
        }

        // Online/Offline detection
        window.addEventListener('online', () => this.updateOnlineStatus());
        window.addEventListener('offline', () => this.updateOnlineStatus());
        this.updateOnlineStatus();

        // PWA Install Prompt
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            this.deferredPrompt = e;
            this.checkInstallPrompt();
        });
    }

    updateOnlineStatus() {
        const isOnline = navigator.onLine;
        let indicator = document.getElementById('offline-indicator');

        if (!isOnline) {
            if (!indicator) {
                indicator = document.createElement('div');
                indicator.id = 'offline-indicator';
                indicator.style.cssText = `
                    position: fixed;
                    bottom: 80px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: rgba(239, 68, 68, 0.9);
                    color: white;
                    padding: 8px 16px;
                    border-radius: 20px;
                    font-size: 13px;
                    font-weight: 500;
                    z-index: 9999;
                    backdrop-filter: blur(8px);
                    box-shadow: 0 4px 12px rgba(0,0,0,0.2);
                    display: flex;
                    align-items: center;
                    gap: 8px;
                `;
                indicator.innerHTML = '<i data-lucide="wifi-off" style="width: 14px; height: 14px;"></i> Working Offline';
                document.body.appendChild(indicator);
                if (window.lucide) lucide.createIcons({ node: indicator });
            }
        } else {
            if (indicator) indicator.remove();
        }
    }

    loadLang() {
        this.lang = localStorage.getItem('hamster-lang') || 'en';
        document.documentElement.dir = this.lang === 'ar' ? 'rtl' : 'ltr';
        document.documentElement.lang = this.lang;
        this.updateStaticUI();
    }

    setLang(l) {
        this.lang = l;
        localStorage.setItem('hamster-lang', l);
        document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr';
        document.documentElement.lang = l;
        this.updateStaticUI();
        this.handleNavigation(this.currentPage);
    }

    t(key) { return this.strings[this.lang][key] || key; }

    updateStaticUI() {
        const search = document.getElementById('global-search');
        if (search) search.placeholder = this.t('search');
    }

    loadTheme() {
        const savedTheme = localStorage.getItem('hamster-theme');
        let theme = 'light';

        if (savedTheme) {
            theme = savedTheme;
        } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            theme = 'dark';
        }

        document.documentElement.setAttribute('data-theme', theme);
        this.updateThemeColor(theme);
    }

    setTheme(theme) {
        localStorage.setItem('hamster-theme', theme);
        document.documentElement.setAttribute('data-theme', theme);
        this.updateThemeColor(theme);
    }

    updateThemeColor(theme) {
        const color = theme === 'dark' ? '#020617' : '#e2e8f0';
        let meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.name = 'theme-color';
            document.head.appendChild(meta);
        }
        meta.setAttribute('content', color);
    }

    // --- Authentication ---
    setupAuth() {
        onAuthStateChanged(auth, async (user) => {
            if (user) {
                this.user = user;

                // Show App immediately for better UX
                document.getElementById('auth-overlay').classList.add('hidden');
                document.getElementById('hamster-app').classList.remove('hidden');

                // Initialize with basic auth data first
                this.userData = {
                    uid: user.uid,
                    displayName: user.displayName || 'User',
                    photoURL: user.photoURL || 'assets/logo.jpg',
                    email: user.email
                };
                this.updateGlobalUserUI();

                // Start listeners without waiting
                this.listenForChats();
                this.listenForStories();
                this.listenForCalls();

                // Sync with DB and handle App Lock
                try {
                    await this.syncUser(user);
                    this.updateGlobalUserUI(); // Final update with DB data
                    
                    // Update localStorage with synced data
                    if (this.userData?.appLockPin) localStorage.setItem('hamster-lock-pin', this.userData.appLockPin);
                    if (this.userData?.wallpaper) localStorage.setItem('hamster-wallpaper', this.userData.wallpaper);

                    // Re-check App Lock in case it was enabled on another device
                    if (this.userData?.appLockPin && !this.isUnlockedSession && !this.isLocked) {
                        this.showLockScreen();
                    }
                    
                    console.log("Hamster: Session Synced", user.email);
                } catch (e) {
                    console.error("Hamster: Sync failed (working offline?)", e);
                }
            } else {
                this.user = null;
                this.userData = null;
                // Hide Lock Screen if shown from localStorage but no user session exists
                document.getElementById('app-lock-overlay').classList.add('hidden');
                this.isLocked = false;
                
                // Show Login
                document.getElementById('hamster-app').classList.add('hidden');
                document.getElementById('auth-overlay').classList.remove('hidden');
                if (window.lucide) lucide.createIcons({ node: document.getElementById('auth-overlay') });
            }
        });
    }

    // Returns a guaranteed-unique username for the given base string and uid
    async generateUniqueUsername(base, uid) {
        let candidate = base.toLowerCase().replace(/[^a-z0-9_]/g, '');
        if (!candidate) candidate = 'user';

        let suffix = '';
        let attempts = 0;
        while (attempts < 20) {
            const q = query(collection(db, 'users'), where('username', '==', candidate + suffix));
            const snap = await getDocs(q);
            const taken = snap.docs.some(d => d.id !== uid);
            if (!taken) return candidate + suffix;
            suffix = suffix === '' ? '2' : String(parseInt(suffix) + 1);
            attempts++;
        }
        // Last resort: append random 4 digits
        return candidate + Math.floor(1000 + Math.random() * 9000);
    }

    async syncUser(user) {
        const userRef = doc(db, 'users', user.uid);
        const snap = await getDoc(userRef);

        let existingData = {};
        if (snap.exists()) {
            existingData = snap.data();
            // Merge with existing local data to avoid losing localStorage values before sync
            this.userData = { ...this.userData, ...existingData };
        }

        // Only generate/validate username if the user doesn't already have one
        let username = existingData.username;
        if (!username) {
            const base = user.email.split('@')[0];
            username = await this.generateUniqueUsername(base, user.uid);
        }

        const payload = {
            uid: user.uid,
            displayName: existingData.displayName || user.displayName,
            email: user.email,
            photoURL: existingData.photoURL || user.photoURL,
            username,
            lastSeen: serverTimestamp()
        };

        await setDoc(userRef, payload, { merge: true });
        this.userData = { ...existingData, ...payload };

        if (this.presenceInterval) clearInterval(this.presenceInterval);
        this.presenceInterval = setInterval(() => {
            setDoc(doc(db, 'users', user.uid), { lastSeen: serverTimestamp() }, { merge: true });
        }, 60000);
    }

    async login() {
        try {
            await signInWithPopup(auth, googleProvider);
        } catch (e) {
            console.error("Login failed", e);
            this.showAlert(this.lang === 'ar' ? 'فشل الاتصال' : 'Connection Error', this.lang === 'ar' ? 'يرجى المحاولة مرة أخرى.' : 'Please try again.');
        }
    }

    async logout() {
        if (this.presenceInterval) clearInterval(this.presenceInterval);
        await signOut(auth);
        window.location.reload();
    }

    // --- Core Navigation ---
    setupNav() {
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                if (btn.dataset.page) {
                    this.handleNavigation(btn.dataset.page);
                }
            });
        });

        const avatarBtn = document.getElementById('current-user-avatar');
        if (avatarBtn) {
            avatarBtn.addEventListener('click', () => {
                this.handleNavigation('profile');
            });
        }

        const mobileAvatarBtn = document.getElementById('mobile-user-avatar');
        if (mobileAvatarBtn) {
            mobileAvatarBtn.addEventListener('click', () => {
                this.handleNavigation('profile');
            });
        }

        const actionBtn = document.getElementById('main-action-btn');
        if (actionBtn) {
            actionBtn.onclick = () => {
                if (this.currentPage === 'chats' || this.currentPage === 'archive') {
                    this.showNewChatModal();
                }
            };
        }
    }

    handleNavigation(page) {
        this.currentPage = page;
        this.closeMobileOverlay(); // Close any active overlays when switching nav

        document.querySelectorAll('.nav-item').forEach(b => {
            if (b.dataset.page) b.classList.toggle('active', b.dataset.page === page);
        });

        const title = document.getElementById('page-title');
        if (title) {
            title.innerText = this.t(page);
            title.style.margin = '0'; // Fix pushed avatar issue
        }

        const emptyState = document.getElementById('empty-state');
        const mainActionBtn = document.getElementById('main-action-btn');

        if (page === 'chats' || page === 'archive') {
            mainActionBtn.classList.remove('hidden');
            if (!this.activeChatId) {
                emptyState.classList.remove('hidden');
            } else {
                emptyState.classList.add('hidden');
                document.getElementById('chat-window').classList.remove('hidden');
            }
            this.renderFilteredChats();
        } else if (page === 'stories') {
            mainActionBtn.classList.add('hidden');
            this.renderStoriesPage();
        } else if (page === 'settings') {
            mainActionBtn.classList.add('hidden');
            this.renderSettingsPage();
        } else if (page === 'profile') {
            mainActionBtn.classList.add('hidden');
            this.renderProfilePage();
        }
    }

    closeMobileOverlay() {
        if (this.partnerUnsubscribe) {
            this.partnerUnsubscribe();
            this.partnerUnsubscribe = null;
        }
        document.getElementById('chat-window').classList.add('hidden');
        document.getElementById('page-content').classList.add('hidden');
        this.activeChatId = null;
        document.querySelectorAll('.chat-card').forEach(c => c.classList.remove('active'));
    }

    updateGlobalUserUI() {
        if (!this.user) return;
        const imgHTML = `<img src="${this.userData?.photoURL || this.user.photoURL}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;

        const container = document.getElementById('current-user-avatar');
        if (container) container.innerHTML = imgHTML;

        const mobileContainer = document.getElementById('mobile-user-avatar');
        if (mobileContainer) mobileContainer.innerHTML = imgHTML;
    }

    setupSearch() {
        const searchInput = document.getElementById('global-search');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                this.renderFilteredChats();
            });
        }
    }

    // --- Chat System Logic ---
    listenForChats() {
        const q = query(
            collection(db, 'chats'),
            where('memberIds', 'array-contains', this.user.uid),
            orderBy('updatedAt', 'desc')
        );

        onSnapshot(q, (snapshot) => {
            let docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            
            // Inject Hamster AI
            const aiId = this.user.uid + '_ai';
            if (!docs.find(c => c.id === aiId)) {
                docs.unshift({
                    id: aiId,
                    type: 'ai',
                    updatedAt: { toMillis: () => Date.now() },
                    memberIds: [this.user.uid, 'hamster_ai_bot'],
                    memberData: {
                        [this.user.uid]: { name: this.userData?.displayName || 'User', photo: this.userData?.photoURL },
                        'hamster_ai_bot': { name: 'Hamster AI', photo: 'https://ui-avatars.com/api/?name=AI&background=6d28d9&color=fff' }
                    },
                    lastMessage: { text: this.lang === 'ar' ? 'أهلاً! أنا المساعد الذكي هامستر.' : 'Hello! I am Hamster AI assistant.' }
                });
            }

            this.allChats = docs;
            this.renderFilteredChats();
        });
    }

    renderFilteredChats() {
        if (this.currentPage !== 'chats' && this.currentPage !== 'archive') return;

        let displayChats = this.allChats;

        if (this.currentPage === 'archive') {
            displayChats = displayChats.filter(c => c.archivedBy && c.archivedBy.includes(this.user.uid));
        } else {
            displayChats = displayChats.filter(c => !c.archivedBy || !c.archivedBy.includes(this.user.uid));
        }

        const queryText = document.getElementById('global-search')?.value.toLowerCase();
        if (queryText) {
            displayChats = displayChats.filter(c => {
                if (c.type === 'group') return c.name.toLowerCase().includes(queryText);
                const partner = this.getChatPartner(c);
                return partner.name.toLowerCase().includes(queryText) ||
                    (partner.email && partner.email.toLowerCase().includes(queryText)) ||
                    (partner.username && partner.username.toLowerCase().includes(queryText));
            });
        }

        const container = document.getElementById('sidebar-list');
        if (displayChats.length === 0 && !queryText) {
            let msg = this.t('no_convs');
            if (this.currentPage === 'archive') msg = this.t('zero_archived');
            container.innerHTML = `<div class="info-state">${msg}</div>`;
            return;
        }

        let html = displayChats.map(chat => {
            const partner = this.getChatPartner(chat);
            const active = chat.id === this.activeChatId ? 'active' : '';
            
            // Typing Logic
            const typingUsers = Object.keys(chat.typing || {}).filter(uid => uid !== this.user.uid && chat.typing[uid] === true);
            const isTyping = typingUsers.length > 0;
            const lastMsg = isTyping ? (this.lang === 'ar' ? 'يكتب الآن...' : 'Typing...') : (chat.lastMessage?.text || "Started conversation");

            return `
                <div class="chat-card ${active}" onclick="app.selectChat('${chat.id}')">
                    <img src="${partner.photo || 'https://i.pravatar.cc/150'}" class="card-avatar">
                    <div class="card-body">
                        <div class="card-top">
                            <h4>${partner.name}</h4>
                        </div>
                        <p class="${isTyping ? 'typing-indicator' : ''}">${lastMsg}</p>
                    </div>
                </div>
            `;
        }).join('');

        if (queryText) {
            this.searchGlobalUsers(queryText, container, html);
        } else {
            container.innerHTML = html;
        }
    }

    async searchGlobalUsers(queryText, container, existingHTML) {
        if (queryText.length < 2) {
            container.innerHTML = existingHTML || `<div class="info-state">${this.t('no_records')}</div>`;
            return;
        }

        const q = query(
            collection(db, 'users'),
            where('username', '>=', queryText),
            where('username', '<=', queryText + '\uf8ff')
        );

        const snap = await getDocs(q);
        const users = snap.docs.map(d => d.data()).filter(u => u.uid !== this.user.uid);

        let globalHTML = '';
        if (users.length > 0) {
            globalHTML = `
                <div style="padding: 12px 16px; font-size: 12px; color: var(--accent); font-weight: 700; text-transform: uppercase; letter-spacing: 1px;">Global Search</div>
                ${users.map(u => `
                    <div class="chat-card" onclick="app.startPrivateChat('${u.uid}')">
                        <img src="${u.photoURL || 'https://i.pravatar.cc/150'}" class="card-avatar">
                        <div class="card-body">
                            <div class="card-top">
                                <h4>@${u.username}</h4>
                            </div>
                            <p>${u.displayName || 'Hamster User'}</p>
                        </div>
                    </div>
                `).join('')}
            `;
        }

        if (!existingHTML && users.length === 0) {
            container.innerHTML = `<div class="info-state">${this.t('no_records')}</div>`;
        } else {
            container.innerHTML = existingHTML + globalHTML;
        }
    }

    async startPrivateChat(partnerId) {
        // Check if chat already exists
        const existing = this.allChats.find(c => c.type !== 'group' && c.memberIds.includes(partnerId));
        if (existing) {
            this.selectChat(existing.id);
            document.getElementById('global-search').value = '';
            this.renderFilteredChats();
            return;
        }

        // Create new chat
        const partnerSnap = await getDoc(doc(db, 'users', partnerId));
        const partnerData = partnerSnap.data();

        const chatId = [this.user.uid, partnerId].sort().join('_');
        const chatData = {
            id: chatId,
            type: 'private',
            memberIds: [this.user.uid, partnerId],
            memberData: {
                [this.user.uid]: { name: this.userData.displayName, photo: this.userData.photoURL, username: this.userData.username },
                [partnerId]: { name: partnerData.displayName, photo: partnerData.photoURL, username: partnerData.username }
            },
            updatedAt: serverTimestamp()
        };

        await setDoc(doc(db, 'chats', chatId), chatData);
        document.getElementById('global-search').value = '';
        this.selectChat(chatId);
    }

    getChatPartner(chat) {
        if (chat.type === 'group') {
            return { name: chat.name, photo: chat.photo || 'https://ui-avatars.com/api/?name=Group&background=random' };
        }
        const partnerId = chat.memberIds.find(id => id !== this.user.uid);
        if (!partnerId) return { name: 'Note to self', photo: this.userData?.photoURL || '' }; // self chat
        return chat.memberData[partnerId] || { name: 'Unknown User', photo: '' };
    }

    async selectChat(chatId) {
        this.activeChatId = chatId;
        const chat = this.allChats.find(c => c.id === chatId);
        if (!chat) return;

        this.renderFilteredChats(); // updates active class

        const chatWindow = document.getElementById('chat-window');
        document.getElementById('page-content').classList.add('hidden');
        chatWindow.classList.remove('hidden');

        // Apply wallpaper if exists
        const messagesArea = document.getElementById('messages-area');
        if (messagesArea) {
            const wall = this.userData?.wallpaper || '';
            messagesArea.style.backgroundImage = wall ? `url(${wall})` : 'none';
        }

        const partner = this.getChatPartner(chat);
        const isArchived = chat.archivedBy && chat.archivedBy.includes(this.user.uid);
        const archiveIcon = isArchived ? 'package-open' : 'archive';
        const archiveTitle = isArchived ? 'Unarchive' : 'Archive';

        const blockedBy = chat.blockedBy || [];
        const amIBlocked = blockedBy.length > 0;

        let inputAreaHTML = `
            <div class="input-area">
                <div style="display: flex; flex-direction: column; gap: 8px; position: relative;" id="input-area-inner">
                    <div id="reply-to-placeholder"></div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <form id="msg-form" class="input-container" style="flex: 1;">
                            <label style="cursor: pointer; color: var(--text-secondary); flex-shrink: 0;">
                                <i data-lucide="image" style="width: 20px;"></i>
                                <input type="file" accept="image/*" style="display: none;" onchange="app.handleChatImageUpload(event, '${chatId}')">
                            </label>
                            <input type="text" id="msg-input" placeholder="${this.t('msg_placeholder')}" autocomplete="off" oninput="app.handleTyping('${chatId}')">
                            <button type="button" id="voice-btn" style="background: none; border: none; color: var(--text-secondary); flex-shrink: 0; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: 50%; cursor: pointer;" onmousedown="app.startRecording()" onmouseup="app.stopRecording()" ontouchstart="app.startRecording()" ontouchend="app.stopRecording()">
                                <i data-lucide="mic" style="width: 20px;"></i>
                            </button>
                        </form>
                        <button type="button" onclick="app.handleSendMessage('${chatId}')" style="background: linear-gradient(135deg, var(--accent), var(--accent-light)); color: white; border: none; width: 46px; height: 46px; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 4px 12px rgba(109, 40, 217, 0.35); flex-shrink: 0; transform: ${this.lang === 'ar' ? 'scaleX(-1)' : 'none'};">
                            <i data-lucide="send" style="width: 20px;"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;

        if (amIBlocked) {
            const blockMsg = this.lang === 'ar' ? 'نم حظر هذه المحادثة' : 'This conversation is blocked';
            inputAreaHTML = `
                <div class="input-area" style="justify-content: center; opacity: 0.8;">
                    <div style="display: flex; align-items: center; gap: 8px; color: var(--text-muted); font-size: 14px; background: rgba(0,0,0,0.05); padding: 12px 24px; border-radius: 12px; font-weight: 500;">
                        <i data-lucide="lock" style="width: 16px;"></i>
                        ${blockMsg}
                    </div>
                </div>
            `;
        }

        const typingUsers = Object.keys(chat.typing || {}).filter(uid => uid !== this.user.uid && chat.typing[uid] === true);
        const isTyping = typingUsers.length > 0;
        const statusText = isTyping ? (this.lang === 'ar' ? 'يكتب الآن...' : 'Typing...') : (chat.type === 'group' ? 'Group Space' : (partner.status === 'online' ? (this.lang === 'ar' ? 'متصل الآن' : 'Online') : ''));

        chatWindow.innerHTML = `
            <header class="chat-header">
                <div style="display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0; cursor: pointer;" onclick="app.renderChatInfo('${chatId}')">
                    <button class="mobile-back-btn" onclick="event.stopPropagation(); app.closeMobileOverlay()"><i data-lucide="chevron-left"></i></button>
                    <img src="${partner.photo}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; flex-shrink: 0; margin-left: 4px;">
                    <div style="display: flex; flex-direction: column; justify-content: center; min-width: 0; margin-left: 8px;">
                        <h3 style="font-size: 15px; font-weight: 600; margin: 0; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${partner.name}</h3>
                        <div style="display: flex; align-items: center; gap: 4px;">
                            <span id="chat-status" style="font-size: 11px; color: ${isTyping ? 'var(--online)' : 'var(--text-secondary)'}; font-weight: 500; line-height: 1.2; margin-top: 1px; white-space: nowrap;">${statusText}</span>
                            ${isTyping ? `
                            <div class="typing-dots">
                                <span class="typing-dot"></span>
                                <span class="typing-dot"></span>
                                <span class="typing-dot"></span>
                            </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
                <div style="display: flex; gap: 2px; flex-shrink: 0;">
                    <button class="nav-item" onclick="app.toggleChatSearch()" title="Search in Chat"><i data-lucide="search"></i></button>
                    <button class="nav-item" onclick="app.toggleArchive('${chat.id}')" title="${archiveTitle}"><i data-lucide="${archiveIcon}"></i></button>
                    ${chat.type !== 'group' ? `<button class="nav-item" onclick="app.startCall('${chatId}')"><i data-lucide="phone"></i></button>` : ''}
                    <button class="nav-item" onclick="app.renderChatInfo('${chat.id}')"><i data-lucide="more-vertical"></i></button>
                </div>
            </header>
            <div id="chat-search-container" class="hidden">
                <div class="chat-search-bar">
                    <i data-lucide="search" style="width: 16px; color: var(--text-muted);"></i>
                    <input type="text" class="chat-search-input" placeholder="${this.lang === 'ar' ? 'بحث في الرسائل...' : 'Search messages...'}" oninput="app.filterChatMessages(this.value)">
                    <button onclick="app.toggleChatSearch()" style="background:none; border:none; color: var(--text-muted); cursor:pointer;"><i data-lucide="x" style="width: 16px;"></i></button>
                </div>
            </div>
            
            <div id="messages-area" class="messages-area" style="${this.userData?.wallpaper ? `background-image: url(${this.userData.wallpaper});` : ''}"></div>
            ${inputAreaHTML}
        `;
        lucide.createIcons();

        this.listenForMessages(chatId);

        if (chat.type !== 'group') {
            const partnerId = chat.memberIds.find(id => id !== this.user.uid);
            if (partnerId) {
                if (this.partnerUnsubscribe) this.partnerUnsubscribe();
                this.partnerUnsubscribe = onSnapshot(doc(db, 'users', partnerId), (snap) => {
                    const data = snap.data();
                    const statusEl = document.getElementById('chat-status');
                    const showLastSeen = data?.privacy?.showLastSeen !== false;

                    if (data && data.lastSeen && statusEl) {
                        const secondsSince = (Date.now() - data.lastSeen.toMillis()) / 1000;
                        const isOnline = secondsSince < 120; // 2 minutes
                        
                        if (isOnline) {
                            statusEl.innerText = this.lang === 'ar' ? 'متصل الآن' : 'Online';
                        } else if (showLastSeen) {
                            statusEl.innerText = this.formatLastSeen(data.lastSeen.toMillis());
                        } else {
                            statusEl.innerText = '';
                        }
                    } else if (statusEl) {
                        statusEl.innerText = '';
                    }
                });
            }
        }

        // Apply wallpaper when selecting chat
        if (this.userData?.wallpaper) {
            const area = document.getElementById('messages-area');
            if (area) area.style.backgroundImage = `url(${this.userData.wallpaper})`;
        }

        const msgForm = document.getElementById('msg-form');
        if (msgForm) {
            msgForm.onsubmit = (e) => {
                e.preventDefault();
                this.handleSendMessage(chatId);
            };
        }
    }

    async toggleArchive(chatId) {
        const chat = this.allChats.find(c => c.id === chatId);
        if (!chat) return;

        const archivedBy = chat.archivedBy || [];
        const isArchived = archivedBy.includes(this.user.uid);
        let newArchivedBy;

        if (isArchived) newArchivedBy = archivedBy.filter(uid => uid !== this.user.uid);
        else newArchivedBy = [...archivedBy, this.user.uid];

        await setDoc(doc(db, 'chats', chatId), { archivedBy: newArchivedBy }, { merge: true });
        this.closeMobileOverlay();
        this.renderFilteredChats();
    }

    listenForMessages(chatId) {
        if (this.messagesUnsubscribe) this.messagesUnsubscribe();
        
        // Reset limit on new chat
        if (this.lastActiveChatId !== chatId) {
            this.messageLimit = 50;
            this.lastActiveChatId = chatId;
        }

        const q = query(
            collection(db, `chats/${chatId}/messages`), 
            orderBy('createdAt', 'desc'), 
            limit(this.messageLimit)
        );

        this.messagesUnsubscribe = onSnapshot(q, (snapshot) => {
            if (this.activeChatId !== chatId) return;
            const container = document.getElementById('messages-area');
            if (!container) return;

            const chat = this.allChats.find(c => c.id === chatId);
            this.currentMessages = {};

            const docs = snapshot.docs.reverse(); // Reverse for chronolocial display
            const now = Date.now();

            let messagesHTML = '';
            
            // Add Load More button if we might have more messages
            if (snapshot.docs.length >= this.messageLimit) {
                messagesHTML += `<button class="load-more-btn" onclick="app.loadMoreMessages('${chatId}')">${this.lang === 'ar' ? 'تحميل الرسائل القديمة' : 'Load previous messages'}</button>`;
            }

            messagesHTML += docs.map(docSnap => {
                const msgId = docSnap.id;
                const msg = docSnap.data();
                
                this.currentMessages[msgId] = msg;
                const isMine = msg.senderId === this.user.uid;

                // Mark as read if received and in active chat and window focused
                if (!isMine && msg.status !== 'read' && document.visibilityState === 'visible') {
                    updateDoc(doc(db, `chats/${chatId}/messages`, msgId), { status: 'read' });
                }

                let senderLabel = '';
                if (!isMine && chat?.type === 'group') {
                    const senderName = chat.memberData[msg.senderId]?.name || 'User';
                    senderLabel = `<div style="font-size: 12px; color: var(--text-muted); margin-bottom: 6px; margin-left: 6px;">${senderName}</div>`;
                }

                let contentStr = '';
                let extraBubbleClass = '';
                if (msg.image) {
                    contentStr = `<img src="${msg.image}" style="width: 100%; height: auto; border-radius: 8px; cursor: pointer; display: block;" onclick="app.viewImage('${msg.image}');">`;
                    extraBubbleClass = 'image-only-bubble';
                } else if (msg.audio) {
                    const senderPhoto = isMine ? (this.userData?.photoURL || 'https://ui-avatars.com/api/?name=Me') : (chat.memberData?.[msg.senderId]?.photo || `https://ui-avatars.com/api/?name=${chat.memberData?.[msg.senderId]?.name || 'User'}`);

                    // Generate dense waveform bars
                    let waveformHTML = '';
                    const barCount = 40;
                    for (let i = 0; i < barCount; i++) {
                        const h = 4 + Math.random() * 16;
                        waveformHTML += `<div class="wa-waveform-bar" style="height: ${h}px;"></div>`;
                    }

                    contentStr = `
                        <div class="wa-audio-player" id="player-${msgId}" style="direction: ltr !important; text-align: left !important;">
                            <div class="wa-audio-avatar-wrapper">
                                <img src="${senderPhoto}" class="wa-audio-avatar" onerror="this.src='https://ui-avatars.com/api/?name=U'">
                                <div class="wa-audio-mic-badge"><i data-lucide="mic"></i></div>
                            </div>
                            <div class="wa-audio-controls">
                                <div class="wa-audio-top">
                                    <button type="button" class="wa-audio-play-btn" onclick="app.toggleAudio(this, '${msgId}'); event.stopPropagation();">
                                        <div class="wa-play-inner">
                                            <i data-lucide="play" id="icon-${msgId}"></i>
                                        </div>
                                    </button>
                                    <div class="wa-audio-waveform">
                                        ${waveformHTML}
                                        <input type="range" class="wa-audio-slider" value="0" min="0" max="100" oninput="app.seekAudio(this, '${msgId}'); event.stopPropagation();" onclick="event.stopPropagation();">
                                    </div>
                                </div>
                                <div class="wa-audio-info">
                                    <span class="wa-duration" id="dur-${msgId}">...</span>
                                </div>
                            </div>
                            <audio id="audio-${msgId}" src="${msg.audio}" preload="metadata" ontimeupdate="app.updateAudioProgress('${msgId}')" onended="app.resetAudioPlayer('${msgId}')" onloadedmetadata="app.setAudioDuration('${msgId}')"></audio>
                        </div>
                    `;
                    extraBubbleClass = 'wa-audio-bubble';
                } else {
                    contentStr = this.linkify(msg.text || '');
                    if (msg.edited) {
                        contentStr += ` <span style="font-size: 10px; opacity: 0.7; font-style: italic;">(${this.lang === 'ar' ? 'معدلة' : 'edited'})</span>`;
                    }
                    
                    if (msg.linkPreview) {
                        const lp = msg.linkPreview;
                        contentStr += `
                            <a href="${lp.url}" target="_blank" class="link-preview-box" onclick="event.stopPropagation();">
                                ${lp.image ? `<img src="${lp.image}" class="link-preview-img">` : ''}
                                <div class="link-preview-content">
                                    <div class="link-preview-title">${lp.title || 'Link'}</div>
                                    ${lp.description ? `<div class="link-preview-desc">${lp.description}</div>` : ''}
                                    <div class="link-preview-url">${new URL(lp.url).hostname}</div>
                                </div>
                            </a>
                        `;
                    }
                }

                // Ticks logic
                let ticksHTML = '';
                if (isMine) {
                    const color = msg.status === 'read' ? '#3b82f6' : '#94a3b8';
                    const iconName = msg.status === 'read' ? 'check-check' : 'check';
                    ticksHTML = `<i data-lucide="${iconName}" style="width: 14px; height: 14px; color: ${color}; margin-top: 2px;"></i>`;
                }

                const timeStr = msg.createdAt ? new Date(msg.createdAt.toMillis()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : '';

                // Reactions logic
                let reactionsHTML = '';
                if (msg.reactions) {
                    const counts = {};
                    Object.values(msg.reactions).forEach(r => counts[r] = (counts[r] || 0) + 1);
                    reactionsHTML = `
                        <div class="msg-reactions" onclick="event.stopPropagation(); app.showReactionDetails('${chatId}', '${msgId}')">
                            ${Object.keys(counts).map(r => `<span class="reaction-item">${r}<span class="reaction-count">${counts[r] > 1 ? counts[r] : ''}</span></span>`).join('')}
                        </div>
                    `;
                }

                let replyHTML = '';
                if (msg.replyTo && this.currentMessages[msg.replyTo]) {
                    const repliedMsg = this.currentMessages[msg.replyTo];
                    let brief = repliedMsg.text || (repliedMsg.image ? (this.lang === 'ar' ? '📷 صورة' : '📷 Image') : (this.lang === 'ar' ? '🎤 تسجيل صوتي' : '🎤 Voice Message'));
                    if (brief.length > 50) brief = brief.substring(0, 50) + '...';

                    const replyName = repliedMsg.senderId === this.user.uid ? (this.lang === 'ar' ? 'أنت' : 'You') : (chat.memberData[repliedMsg.senderId]?.name || 'User');

                    replyHTML = `
                        <div style="background: rgba(0,0,0,0.1); border-${this.lang === 'ar' ? 'right' : 'left'}: 4px solid var(--accent); padding: 6px 10px; border-radius: 6px; margin-bottom: 8px; font-size: 12px; cursor: pointer; opacity: 0.85;" onclick="document.querySelector('[data-msg-id=\\'${msg.replyTo}\\']')?.scrollIntoView({behavior: 'smooth', block: 'center'})">
                            <div style="font-weight: 700; color: ${isMine ? 'white' : 'var(--accent)'}; margin-bottom: 2px;">${replyName}</div>
                            <div style="color: ${isMine ? 'rgba(255,255,255,0.8)' : 'var(--text-secondary)'}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${brief}</div>
                        </div>
                    `;
                }

                return `
                    <div class="msg-bubble ${isMine ? 'mine' : 'theirs'} ${extraBubbleClass}" style="cursor: pointer; position: relative;"
                        data-chat-id="${chatId}" data-msg-id="${msgId}"
                        oncontextmenu="app.onMsgContextMenu(event, '${chatId}', '${msgId}'); return false;"
                        ontouchstart="app.onMsgTouchStart(event, '${chatId}', '${msgId}')"
                        ontouchend="app.onMsgTouchEnd(event)"
                        ontouchmove="app.onMsgTouchEnd(event)"
                        onmouseup="app.onMsgMouseUp(event)"
                        onmouseleave="app.onMsgMouseUp(event)">
                        <div style="display: flex; flex-direction: column; width: 100%;">
                            ${senderLabel}
                            <div class="bubble-content ${extraBubbleClass}">
                                ${replyHTML}
                                ${contentStr}
                                <div class="msg-meta" style="display: flex; align-items: center; justify-content: flex-end; gap: 4px; margin-top: 4px;">
                                    <span style="font-size: 10px; opacity: 0.6;">${timeStr}</span>
                                    ${ticksHTML}
                                </div>
                            </div>
                            ${reactionsHTML}
                        </div>
                    </div>
                `;
            }).join('');
            
            const prevScroll = container.scrollHeight - container.scrollTop;
            container.innerHTML = messagesHTML;
            
            // Maintain scroll position if loading more, else scroll to bottom
            if (this.isLoadingMore) {
                container.scrollTop = container.scrollHeight - prevScroll;
                this.isLoadingMore = false;
            } else {
                container.scrollTop = container.scrollHeight;
            }
            
            lucide.createIcons();
        });
    }

    loadMoreMessages(chatId) {
        this.isLoadingMore = true;
        this.messageLimit += 50;
        this.listenForMessages(chatId);
    }

    toggleChatSearch() {
        this.isSearching = !this.isSearching;
        const container = document.getElementById('chat-search-container');
        container.classList.toggle('hidden', !this.isSearching);
        if (this.isSearching) {
            container.querySelector('input').focus();
        } else {
            // Reset filters
            document.querySelectorAll('.msg-bubble').forEach(b => b.style.display = 'flex');
        }
    }

    filterChatMessages(query) {
        const q = query.toLowerCase().trim();
        document.querySelectorAll('.msg-bubble').forEach(bubble => {
            const msgId = bubble.dataset.msgId;
            const msg = this.currentMessages[msgId];
            if (!msg) return;
            const text = (msg.text || '').toLowerCase();
            bubble.style.display = text.includes(q) ? 'flex' : 'none';
        });
    }

    async handleChatImageUpload(event, chatId) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = async () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');

                // Max dimension 800px for shared images
                const maxDim = 800;
                let w = img.width;
                let h = img.height;
                if (w > maxDim || h > maxDim) {
                    if (w > h) { h = (h / w) * maxDim; w = maxDim; }
                    else { w = (w / h) * maxDim; h = maxDim; }
                }

                canvas.width = w;
                canvas.height = h;
                ctx.drawImage(img, 0, 0, w, h);

                const dataURL = canvas.toDataURL('image/jpeg', 0.7);
                await this.sendMessageWithMedia(chatId, dataURL);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    async sendMessageWithMedia(chatId, imageData) {
        const chat = this.allChats.find(c => c.id === chatId);
        if (chat && chat.blockedBy && chat.blockedBy.length > 0) {
            this.showAlert(this.lang === 'ar' ? 'ململكة محظورة' : 'Blocked Context', this.lang === 'ar' ? 'لا يمكن إرسال وسائط في محادثة محظورة.' : 'Cannot send media in a blocked conversation.');
            return;
        }

        try {
            const batch = writeBatch(db);
            const msgRef = doc(collection(db, `chats/${chatId}/messages`));
            const text = this.lang === 'ar' ? '📷 صورة' : '📷 Image';

            const payload = {
                chatId, image: imageData, senderId: this.user.uid, createdAt: serverTimestamp(), status: 'sent'
            };
            
            if (this.replyToMsgId) {
                payload.replyTo = this.replyToMsgId;
            }

            batch.set(msgRef, payload);

            batch.set(doc(db, 'chats', chatId), {
                lastMessage: { text, senderId: this.user.uid, msgId: msgRef.id },
                updatedAt: serverTimestamp()
            }, { merge: true });

            await batch.commit();
            this.cancelReply();
        } catch (e) {
            console.error("Image send failed", e);
        }
    }

    async handleSendMessage(chatId) {
        const chat = this.allChats.find(c => c.id === chatId);
        if (chat && chat.blockedBy && chat.blockedBy.length > 0) {
            this.showAlert(this.lang === 'ar' ? 'المحادثة محظورة' : 'Context Blocked', this.lang === 'ar' ? 'لا يمكن إرسال رسائل في محادثة محظورة.' : 'Cannot send messages in a blocked conversation.');
            return;
        }

        const input = document.getElementById('msg-input');
        const text = input.value.trim();
        if (!text) return;

        input.value = '';
        try {
            const batch = writeBatch(db);
            const msgRef = doc(collection(db, `chats/${chatId}/messages`));

            // Link Detection
            const urlMatch = text.match(/(https?:\/\/[^\s]+)/g);
            let linkPreview = null;
            if (urlMatch) {
                linkPreview = await this.getLinkPreview(urlMatch[0]);
            }

            const payload = {
                chatId, text, senderId: this.user.uid, createdAt: serverTimestamp(), status: 'sent'
            };
            
            if (linkPreview) payload.linkPreview = linkPreview;

            if (this.replyToMsgId) {
                payload.replyTo = this.replyToMsgId;
            }

            batch.set(msgRef, payload);

            batch.set(doc(db, 'chats', chatId), {
                lastMessage: { text, senderId: this.user.uid, msgId: msgRef.id },
                updatedAt: serverTimestamp()
            }, { merge: true });

            await batch.commit();
            this.cancelReply();
        } catch (e) {
            console.error("Message failed", e);
        }
    }

    // --- Interaction Features ---

    async handleTyping(chatId) {
        if (this.typingTimeout) clearTimeout(this.typingTimeout);
        
        // Mention Logic
        this.handleMentionSuggestions(chatId);

        // Update Firestore to typing: true
        const chatRef = doc(db, 'chats', chatId);
        const updateObj = {};
        updateObj[`typing.${this.user.uid}`] = true;
        if (chatId !== this.user.uid + '_ai') await updateDoc(chatRef, updateObj);

        this.typingTimeout = setTimeout(async () => {
            const stopObj = {};
            stopObj[`typing.${this.user.uid}`] = false;
            if (chatId !== this.user.uid + '_ai') await updateDoc(chatRef, stopObj);
        }, 2000);
    }

    handleMentionSuggestions(chatId) {
        const chat = this.allChats.find(c => c.id === chatId);
        if (!chat || chat.type !== 'group') return;
        
        const input = document.getElementById('msg-input');
        if (!input) return;

        const val = input.value;
        const cursorPos = input.selectionStart;
        const textBeforeCursor = val.substring(0, cursorPos);
        const match = textBeforeCursor.match(/@(\w*)$/);

        const area = document.getElementById('input-area-inner');
        if (!area) return;
        let dropdown = document.getElementById('mention-dropdown');

        if (match) {
            const queryText = match[1].toLowerCase();
            const members = chat.memberIds.filter(id => id !== this.user.uid).map(id => chat.memberData[id]).filter(m => m);
            const filtered = members.filter(m => m.name.toLowerCase().includes(queryText) || (m.username && m.username.toLowerCase().includes(queryText)));

            if (filtered.length > 0) {
                if (!dropdown) {
                    dropdown = document.createElement('div');
                    dropdown.id = 'mention-dropdown';
                    dropdown.className = 'mention-suggestions';
                    area.appendChild(dropdown);
                }
                dropdown.innerHTML = filtered.map(m => `
                    <div class="mention-item" onclick="app.insertMention('${m.username || m.name}', ${match.index}, ${match[0].length})">
                        <img src="${m.photo}" style="width: 24px; height: 24px; border-radius: 50%; object-fit: cover;">
                        <div style="display: flex; flex-direction: column;">
                            <span style="font-size: 13px; font-weight: 600;">${m.name}</span>
                            ${m.username ? `<span style="font-size: 11px; opacity: 0.7;">@${m.username}</span>` : ''}
                        </div>
                    </div>
                `).join('');
            } else if (dropdown) {
                dropdown.remove();
            }
        } else if (dropdown) {
            dropdown.remove();
        }
    }

    insertMention(name, index, length) {
        const input = document.getElementById('msg-input');
        const val = input.value;
        input.value = val.substring(0, index) + '@' + name + ' ' + val.substring(index + length);
        input.focus();
        document.getElementById('mention-dropdown')?.remove();
    }

    async handleAIMessage(chatId, text) {
        const input = document.getElementById('msg-input');
        if (!text) return;

        // Rate limit check
        const now = Date.now();
        let aiUsage = JSON.parse(localStorage.getItem('hamster_ai_usage') || '{"count": 0, "firstMsgTime": 0}');
        
        if (now - aiUsage.firstMsgTime > 5 * 60 * 1000) {
            aiUsage = { count: 0, firstMsgTime: now };
        }
        
        if (aiUsage.count >= 5) {
            this.showAlert(
                this.lang === 'ar' ? 'الرجاء الانتظار' : 'Please wait', 
                this.lang === 'ar' ? 'لقد وصلت للحد المسموح (5 رسائل كل 5 دقائق). يرجى الانتظار لتوفير الموارد.' : 'You have reached the limit (5 messages per 5 minutes). Please wait to save resources.'
            );
            return;
        }

        input.value = '';
        aiUsage.count++;
        localStorage.setItem('hamster_ai_usage', JSON.stringify(aiUsage));
        document.getElementById('mention-dropdown')?.remove();

        // Save User Message
        const msgRef = doc(collection(db, `chats/${chatId}/messages`));
        await setDoc(msgRef, {
            chatId, text, senderId: this.user.uid, createdAt: serverTimestamp(), status: 'read'
        });

        // Show AI Typing
        const chatRef = doc(db, 'chats', chatId);
        await setDoc(chatRef, { 
            memberIds: [this.user.uid, 'hamster_ai_bot'],
            typing: { 'hamster_ai_bot': true } 
        }, { merge: true });

        try {
            const response = await this.fetchGeminiReply(text);
            const aiMsgRef = doc(collection(db, `chats/${chatId}/messages`));
            await setDoc(aiMsgRef, {
                chatId, text: response, senderId: 'hamster_ai_bot', createdAt: serverTimestamp(), status: 'read'
            });
        } catch (e) {
            console.error(e);
            this.showAlert("Error", "Failed to connect to Hamster AI.");
        } finally {
            await setDoc(chatRef, { typing: { 'hamster_ai_bot': false } }, { merge: true });
        }
    }

    async fetchGeminiReply(promptStr) {
        // Build obfuscated API Key
        const p1 = 'AIzaSyBt';
        const p2 = '0rUg2MXa';
        const p3 = '7-MYV6ew';
        const p4 = 'euqvofIb';
        const p5 = 'PiEABcc';
        const apiKey = [p1, p2, p3, p4, p5].join('');
        
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: promptStr }] }] })
        });
        const data = await res.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || 'No response from Hamster AI.';
    }

    linkify(text) {
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        return text.replace(urlRegex, (url) => {
            return `<a href="${url}" target="_blank" style="color: inherit; text-decoration: underline;">${url}</a>`;
        });
    }

    async getLinkPreview(url) {
        try {
            // Using Microlink (free tier)
            const response = await fetch(`https://api.microlink.io?url=${encodeURIComponent(url)}`);
            const json = await response.json();
            if (json.status === 'success' && json.data) {
                const d = json.data;
                return {
                    url,
                    title: d.title,
                    image: d.image?.url,
                    description: d.description
                };
            }
        } catch (e) {
            console.warn("Link preview failed", e);
        }
        return null;
    }

    renderChatInfo(chatId) {
        const chat = this.allChats.find(c => c.id === chatId);
        if (!chat) return;
        const partner = this.getChatPartner(chat);
        const chatWindow = document.getElementById('chat-window');

        if (chat.type === 'group') {
            const creatorId = chat.memberIds[0];
            const admins = chat.admins || [creatorId];
            const isAdmin = admins.includes(this.user.uid);

            let adminControls = '';
            if (isAdmin) {
                adminControls = `
                    <label style="cursor: pointer; display: block; margin-top: 12px; font-size: 14px; color: var(--accent); font-weight: 600; text-align: center;">
                        <i data-lucide="camera" style="width: 16px; display: inline-block; vertical-align: middle; margin-right: 4px;"></i>
                        ${this.lang === 'ar' ? 'تغيير صورة المجموعة' : 'Change Group Image'}
                        <input type="file" accept="image/*" style="display: none;" onchange="app.changeGroupImage(event, '${chatId}')">
                    </label>
                `;
            }

            chatWindow.innerHTML = `
                <header class="chat-header">
                    <button class="nav-item" onclick="app.selectChat('${chatId}')"><i data-lucide="chevron-left"></i></button>
                    <h3 style="flex: 1; text-align: center; margin-right: 40px; font-size: 16px;">${this.lang === 'ar' ? 'معلومات المجموعة' : 'Group Info'}</h3>
                </header>
                <div class="scrollbar-hidden" style="flex: 1; overflow-y: auto; padding: 40px 20px; display: flex; flex-direction: column; align-items: center; gap: 24px;">
                    <div style="position: relative; text-align: center;">
                        <img src="${partner.photo}" style="width: 150px; height: 150px; border-radius: 50%; object-fit: cover; box-shadow: var(--shadow-lg); border: 4px solid var(--glass-border);">
                        ${adminControls}
                    </div>
                    <div style="text-align: center;">
                        <h2 style="font-size: 24px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">${partner.name}</h2>
                        <div style="cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 4px; color: var(--text-secondary); font-size: 14px; margin-top: 4px;" onclick="app.toggleMembersList('${chatId}')">
                            <span>${chat.memberIds.length} ${this.lang === 'ar' ? 'أعضاء' : 'Members'}</span>
                            <i data-lucide="chevron-down" id="members-chevron" style="width: 16px; transition: transform 0.3s;"></i>
                        </div>
                        <div id="group-members-list" class="scrollbar-hidden" style="display: none; width: 100%; max-width: 400px; margin: 16px auto 0; background: var(--glass-panel); border: 1px solid var(--glass-border); border-radius: 16px; padding: 12px; max-height: 250px; overflow-y: auto; text-align: left;" dir="${this.lang === 'ar' ? 'rtl' : 'ltr'}">
                        </div>
                    </div>
                    
                    <div style="width: 100%; max-width: 400px; display: flex; flex-direction: column; gap: 12px; margin-top: 20px;">
                        
                        <button class="glass-btn" style="width: 100%; justify-content: space-between; padding: 16px 20px; border-radius: 16px; background: var(--glass-panel); border: 1px solid var(--glass-border); color: var(--text-primary); transition: all 0.2s;" onclick="app.promptAddGroupMember('${chatId}')">
                            <div style="display: flex; align-items: center; gap: 12px;">
                                <i data-lucide="user-plus" style="color: #3b82f6; width: 20px;"></i>
                                <span style="font-weight: 500;">${this.lang === 'ar' ? 'إضافة أعضاء جدد' : 'Add New Members'}</span>
                            </div>
                            <i data-lucide="chevron-right" style="width: 16px; opacity: 0.5;"></i>
                        </button>
                        
                        <div style="margin-top: 12px; border-top: 1px solid var(--glass-border); padding-top: 12px;">
                            <button class="glass-btn" style="width: 100%; justify-content: space-between; padding: 16px 20px; border-radius: 16px; background: rgba(245, 158, 11, 0.1);" onclick="app.leaveGroupPrompt('${chatId}')">
                                <div style="display: flex; align-items: center; gap: 12px;">
                                    <i data-lucide="log-out" style="color: #f59e0b; width: 20px;"></i>
                                    <span style="font-weight: 500; color: #f59e0b;">${this.lang === 'ar' ? 'مغادرة المجموعة' : 'Leave Group'}</span>
                                </div>
                                <i data-lucide="chevron-right" style="width: 16px; opacity: 0.3;"></i>
                            </button>
                            
                            ${isAdmin ? `
                            <button class="glass-btn" style="width: 100%; justify-content: space-between; padding: 16px 20px; border-radius: 16px; background: rgba(239, 68, 68, 0.1); margin-top: 12px;" onclick="app.deleteGroupPrompt('${chatId}')">
                                <div style="display: flex; align-items: center; gap: 12px;">
                                    <i data-lucide="trash" style="color: #ef4444; width: 20px;"></i>
                                    <span style="font-weight: 500; color: #ef4444;">${this.lang === 'ar' ? 'حذف المجموعة للكل' : 'Delete Group for Everyone'}</span>
                                </div>
                                <i data-lucide="chevron-right" style="width: 16px; opacity: 0.3;"></i>
                            </button>
                            ` : ''}

                            <button class="glass-btn" style="width: 100%; justify-content: space-between; padding: 16px 20px; border-radius: 16px; background: var(--glass-panel); border: 1px solid var(--glass-border); color: var(--text-primary); transition: all 0.2s; margin-top: 12px;" onclick="app.showGroupQR('${chatId}')">
                                <div style="display: flex; align-items: center; gap: 12px;">
                                    <i data-lucide="qr-code" style="color: var(--accent); width: 20px;"></i>
                                    <span style="font-weight: 500;">${this.lang === 'ar' ? 'رمز QR للمجموعة' : 'Group QR Code'}</span>
                                </div>
                                <i data-lucide="chevron-right" style="width: 16px; opacity: 0.5;"></i>
                            </button>
                        </div>
                    </div>
                </div>
            `;
            lucide.createIcons();
            return;
        }

        const isBlocked = chat.blockedBy && chat.blockedBy.includes(this.user.uid);
        chatWindow.innerHTML = `
            <header class="chat-header">
                <button class="nav-item" onclick="app.selectChat('${chatId}')"><i data-lucide="chevron-left"></i></button>
                <h3 style="flex: 1; text-align: center; margin-right: 40px; font-size: 16px;">${this.lang === 'ar' ? 'معلومات المحادثة' : 'Chat Info'}</h3>
            </header>
            <div class="scrollbar-hidden" style="flex: 1; overflow-y: auto; padding: 40px 20px; display: flex; flex-direction: column; align-items: center; gap: 24px;">
                <div style="position: relative;">
                    <img src="${partner.photo}" style="width: 150px; height: 150px; border-radius: 50%; object-fit: cover; box-shadow: var(--shadow-lg); border: 4px solid var(--glass-border);">
                </div>
                <div style="text-align: center;">
                    <h2 style="font-size: 24px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">${partner.name}</h2>
                    ${partner.username ? `<p style="color: var(--accent); font-weight: 600; font-size: 14px;">@${partner.username}</p>` : ''}
                </div>
                
                <div style="width: 100%; max-width: 400px; display: flex; flex-direction: column; gap: 12px; margin-top: 20px;">
                    <button class="glass-btn" style="width: 100%; justify-content: space-between; padding: 16px 20px; border-radius: 16px; background: var(--glass-panel); border: 1px solid var(--glass-border); color: var(--text-primary); transition: all 0.2s;" onclick="app.toggleBlock('${chatId}')">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <i data-lucide="${isBlocked ? 'user-check' : 'user-x'}" style="color: #ef4444; width: 20px;"></i>
                            <span style="font-weight: 500;">${isBlocked ? (this.lang === 'ar' ? 'إلغاء الحظر' : 'Unblock Contact') : (this.lang === 'ar' ? 'حظر المستخدم' : 'Block Contact')}</span>
                        </div>
                        <i data-lucide="chevron-right" style="width: 16px; opacity: 0.5;"></i>
                    </button>
                    
                    <button class="glass-btn" style="width: 100%; justify-content: space-between; padding: 16px 20px; border-radius: 16px; background: var(--glass-panel); border: 1px solid var(--glass-border); color: var(--text-primary); transition: all 0.2s;" onclick="app.reportUser()">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <i data-lucide="shield-alert" style="color: #f59e0b; width: 20px;"></i>
                            <span style="font-weight: 500;">${this.lang === 'ar' ? 'إبلاغ عن إساءة' : 'Report Abuse'}</span>
                        </div>
                        <i data-lucide="chevron-right" style="width: 16px; opacity: 0.5;"></i>
                    </button>

                    <div style="margin-top: 12px; border-top: 1px solid var(--glass-border); padding-top: 12px;">
                        <button class="glass-btn" style="width: 100%; justify-content: space-between; padding: 16px 20px; border-radius: 16px; background: rgba(239, 68, 68, 0.1);" onclick="app.deleteChatPrompt('${chatId}')">
                            <div style="display: flex; align-items: center; gap: 12px;">
                                <i data-lucide="trash-2" style="color: #ef4444; width: 20px;"></i>
                                <span style="font-weight: 500; color: #ef4444;">${this.lang === 'ar' ? 'مسح المحادثة' : 'Delete Conversation'}</span>
                            </div>
                            <i data-lucide="chevron-right" style="width: 16px; opacity: 0.3;"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
        lucide.createIcons();
    }

    async toggleBlock(chatId) {
        const chat = this.allChats.find(c => c.id === chatId);
        if (!chat) return;
        const blockedBy = chat.blockedBy || [];
        const isBlocked = blockedBy.includes(this.user.uid);

        let newBlockedBy;
        if (isBlocked) {
            newBlockedBy = blockedBy.filter(id => id !== this.user.uid);
        } else {
            newBlockedBy = [...blockedBy, this.user.uid];
        }

        await updateDoc(doc(db, 'chats', chatId), { blockedBy: newBlockedBy });
        this.renderChatInfo(chatId);
    }

    reportUser() {
        this.showAlert(this.lang === 'ar' ? 'الإبلاغ عن إساءة' : 'Report Abuse', this.lang === 'ar' ? 'سيتم إضافة ميزة البلاغات قريباً. شكراً لصبركم.' : 'Reporting feature will be added soon. Thank you for your patience.');
    }

    changeGroupImage(event, chatId) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = async () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const size = 300;
                canvas.width = size;
                canvas.height = size;

                const minDim = Math.min(img.width, img.height);
                const sx = (img.width - minDim) / 2;
                const sy = (img.height - minDim) / 2;

                ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);

                const dataURL = canvas.toDataURL('image/jpeg', 0.8);
                await updateDoc(doc(db, 'chats', chatId), { photo: dataURL });
                setTimeout(() => this.renderChatInfo(chatId), 500);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    promptAddGroupMember(chatId) {
        this.showPrompt(
            this.lang === 'ar' ? 'إضافة أصدقاء للمجموعة' : 'Add Group Members',
            this.lang === 'ar' ? 'اسم المستخدم:' : 'Username:',
            '',
            async (identifier) => {
                const id = identifier?.trim();
                if (!id) return;
                const users = await this.findUsersByIdentifiers([id]);
                if (users.length === 0) {
                    return this.showAlert(this.lang === 'ar' ? 'خطأ' : 'Not Found', this.lang === 'ar' ? 'لم يتم العثور على الحساب.' : 'Account not found.');
                }
                const newMember = users[0];
                const chat = this.allChats.find(c => c.id === chatId);
                if (chat.memberIds.includes(newMember.uid)) {
                    return this.showAlert(this.lang === 'ar' ? 'عضو موجود' : 'Exists', this.lang === 'ar' ? 'هذا الشخص موجود بالفعل في المجموعة.' : 'Member is already in the group.');
                }

                const newIds = [...chat.memberIds, newMember.uid];
                const newMemberData = { ...chat.memberData, [newMember.uid]: { name: newMember.displayName, photo: newMember.photoURL } };

                await updateDoc(doc(db, 'chats', chatId), {
                    memberIds: newIds,
                    memberData: newMemberData
                });
                this.showAlert(this.lang === 'ar' ? 'تم بنجاح' : 'Success', this.lang === 'ar' ? 'تم إضافة المستخدم بنجاح.' : 'User added successfully.');
                this.renderChatInfo(chatId);
            }
        );
    }

    leaveGroupPrompt(chatId) {
        this.showConfirm(
            this.lang === 'ar' ? 'مغادرة المجموعة' : 'Leave Group',
            this.lang === 'ar' ? 'هل أنت متأكد من مغادرة هذه المجموعة نهائياً؟' : 'Are you sure you want to completely leave this group?',
            async () => {
                const chat = this.allChats.find(c => c.id === chatId);
                if (!chat) return;
                const newMembers = chat.memberIds.filter(id => id !== this.user.uid);
                await updateDoc(doc(db, 'chats', chatId), { memberIds: newMembers });

                this.closeMobileOverlay();
                this.activeChatId = null;
                this.renderFilteredChats();
                const emptyState = document.getElementById('empty-state');
                if (emptyState) emptyState.classList.remove('hidden');
            }
        );
    }

    deleteGroupPrompt(chatId) {
        this.showConfirm(
            this.lang === 'ar' ? 'مسح المجموعة للكل' : 'Delete Group for Everyone',
            this.lang === 'ar' ? 'هذا سيمحو المجموعة ومحتواها للجميع للأبد!' : 'This will securely erase the group and contents for all participants forever!',
            async () => {
                await deleteDoc(doc(db, `chats`, chatId));

                this.closeMobileOverlay();
                this.activeChatId = null;
                this.renderFilteredChats();
                const emptyState = document.getElementById('empty-state');
                if (emptyState) emptyState.classList.remove('hidden');
            }
        );
    }

    // --- Group Members Administration ---

    toggleMembersList(chatId) {
        const listDiv = document.getElementById('group-members-list');
        const chevron = document.getElementById('members-chevron');
        if (!listDiv || !chevron) return;

        if (listDiv.style.display === 'none') {
            listDiv.style.display = 'block';
            chevron.style.transform = 'rotate(180deg)';
            this.renderGroupMembers(chatId);
        } else {
            listDiv.style.display = 'none';
            chevron.style.transform = 'rotate(0deg)';
        }
    }

    renderGroupMembers(chatId) {
        const listDiv = document.getElementById('group-members-list');
        if (!listDiv) return;
        const chat = this.allChats.find(c => c.id === chatId);
        if (!chat) return;

        const creatorId = chat.memberIds[0];
        const admins = chat.admins || [creatorId];
        const amIAdmin = admins.includes(this.user.uid);

        let html = '';
        chat.memberIds.forEach(uid => {
            const member = chat.memberData[uid];
            if (!member) return;
            const isCreator = uid === creatorId;
            const isMemberAdmin = admins.includes(uid);

            let badges = '';
            if (isCreator) badges = `<span style="font-size: 10px; background: rgba(16, 185, 129, 0.2); color: #10b981; padding: 2px 6px; border-radius: 8px;">${this.lang === 'ar' ? 'منشئ' : 'Creator'}</span>`;
            else if (isMemberAdmin) badges = `<span style="font-size: 10px; background: rgba(59, 130, 246, 0.2); color: #3b82f6; padding: 2px 6px; border-radius: 8px;">${this.lang === 'ar' ? 'مشرف' : 'Admin'}</span>`;

            // Long press logic -> Only Admins can govern others, nobody can govern creator.
            let pressEvents = '';
            if (amIAdmin) {
                pressEvents = `onmousedown="app.startMemberPress(event, '${chatId}', '${uid}')" onmouseup="app.cancelMemberPress()" onmouseleave="app.cancelMemberPress()" ontouchstart="app.startMemberPress(event, '${chatId}', '${uid}')" ontouchend="app.cancelMemberPress()"`;
            }

            html += `
                <div style="display: flex; align-items: center; gap: 12px; padding: 8px; border-radius: 12px; transition: background 0.2s; cursor: pointer;" class="hover-bg" ${pressEvents}>
                    <img src="${member.photo}" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover;">
                    <div style="flex: 1; min-width: 0;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 14px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${member.name} ${uid === this.user.uid ? (this.lang === 'ar' ? '(أنت)' : '(You)') : ''}</span>
                            ${badges}
                        </div>
                    </div>
                </div>
            `;
        });

        listDiv.innerHTML = html;
        if (amIAdmin) {
            const hint = document.createElement('div');
            hint.style.cssText = "font-size: 11px; text-align: center; color: var(--text-secondary); margin-top: 8px; opacity: 0.7;";
            hint.innerText = this.lang === 'ar' ? 'اضغط مطولاً على شخص لإدارة صلاحياته' : 'Long press a member to manage';
            listDiv.appendChild(hint);
        }
    }

    startMemberPress(e, chatId, uid) {
        if (e.type === 'touchstart') e.preventDefault();
        // Clear any existing timer
        if (this.pressTimer) clearTimeout(this.pressTimer);

        let clientX = e.clientX;
        let clientY = e.clientY;

        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        }

        this.pressTimer = setTimeout(() => {
            if (navigator.vibrate) navigator.vibrate(50);
            this.showMemberOptions(chatId, uid, clientX, clientY);
        }, 600); // 600ms long press
    }

    cancelMemberPress() {
        if (this.pressTimer) clearTimeout(this.pressTimer);
    }

    showMemberOptions(chatId, targetUid, x, y) {
        if (targetUid === this.user.uid) return;

        const chat = this.allChats.find(c => c.id === chatId);
        if (!chat) return;

        const creatorId = chat.memberIds[0];
        const admins = chat.admins || [creatorId];

        const isTargetCreator = targetUid === creatorId;
        const isTargetAdmin = admins.includes(targetUid);
        const amICreator = this.user.uid === creatorId;
        const amIAdmin = admins.includes(this.user.uid);

        if (!amIAdmin) return;
        if (isTargetCreator) {
            return this.showAlert(this.lang === 'ar' ? 'غير مصرح' : 'Unauthorized', this.lang === 'ar' ? 'لا يمكنك طرد أو تعديل صلاحيات منشئ المجموعة.' : 'You cannot kick or alter the group creator.');
        }

        const member = chat.memberData[targetUid];
        const options = [];

        if (!isTargetAdmin) {
            options.push({
                label: this.lang === 'ar' ? 'إعطاء مشرف للمجموعة' : 'Make Group Admin',
                icon: 'shield-check',
                color: '#3b82f6',
                action: async () => {
                    const newAdmins = [...admins, targetUid];
                    await updateDoc(doc(db, 'chats', chatId), { admins: newAdmins });
                    this.renderGroupMembers(chatId);
                }
            });
        }

        options.push({
            label: this.lang === 'ar' ? 'طرد من المجموعة' : 'Kick Member',
            icon: 'user-minus',
            color: '#ef4444',
            action: async () => {
                const newMemberIds = chat.memberIds.filter(id => id !== targetUid);
                await updateDoc(doc(db, 'chats', chatId), { memberIds: newMemberIds });
                this.renderGroupMembers(chatId);
            }
        });

        options.push({
            label: this.lang === 'ar' ? 'مسح جميع الرسائل' : 'Delete Member Messages',
            icon: 'message-square-x',
            color: '#f59e0b',
            action: async () => {
                this.showConfirm(
                    this.lang === 'ar' ? 'مسح الرسائل' : 'Delete Messages',
                    this.lang === 'ar' ? 'هل أنت متأكد من مسح جميع رسائل هذا الشخص في هذا الجروب؟' : 'Are you sure you want to delete all messages by this member in this group?',
                    async () => {
                        const q = query(collection(db, `chats/${chatId}/messages`), where('senderId', '==', targetUid));
                        const snap = await getDocs(q);
                        const batch = writeBatch(db);
                        snap.forEach(d => batch.delete(d.ref));
                        await batch.commit();
                        this.showAlert(this.lang === 'ar' ? 'تم الحذف' : 'Success', this.lang === 'ar' ? 'تم مسح الرسائل الخاصة به.' : 'Messages deleted.');
                    }
                );
            }
        });

        // Close any existing
        document.getElementById('member-options-popup')?.remove();
        document.getElementById('member-options-backdrop')?.remove();

        // Create Backdrop
        const backdrop = document.createElement('div');
        backdrop.id = 'member-options-backdrop';
        backdrop.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; z-index:9998;';
        backdrop.onclick = () => {
            document.getElementById('member-options-popup')?.remove();
            backdrop.remove();
        };
        document.body.appendChild(backdrop);

        let btnsHtml = options.map((opt, i) => `
            <button class="msg-option-btn" style="color: ${opt.color}; padding: 12px; gap: 12px; font-weight: 500;" id="memopt-${i}">
                <i data-lucide="${opt.icon}" style="width: 18px; margin: 0;"></i>
                ${opt.label}
            </button>
        `).join('');

        // Floating Popup
        const popup = document.createElement('div');
        popup.id = 'member-options-popup';
        popup.innerHTML = `
            <div style="padding: 12px 12px 8px; border-bottom: 1px solid var(--glass-border); display: flex; align-items: center; gap: 10px;">
                <img src="${member.photo}" style="width: 32px; height: 32px; border-radius: 50%; object-fit: cover;">
                <div style="min-width: 0; flex: 1; text-align: ${this.lang === 'ar' ? 'right' : 'left'}">
                    <div style="font-size: 13px; font-weight: 600; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${member.name}</div>
                </div>
            </div>
            <div style="padding: 4px;">
                ${btnsHtml}
            </div>
        `;
        document.body.appendChild(popup);
        lucide.createIcons({ node: popup });

        // Position Logic (similarly to msg-options)
        const popupW = 240; // Approx fixed width
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let px = x || (vw / 2);
        let py = y || (vh / 2);

        // Render initially offscreen to measure height if needed, but styling first
        popup.className = 'msg-options-popup'; // Use existing css animations
        popup.style.cssText = `
            position: fixed;
            z-index: 9999;
            width: ${popupW}px;
            background: var(--glass-panel-solid);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border: 1px solid var(--glass-border);
            border-radius: 16px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10);
            animation: popup-appear 0.18s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        `;

        const popupH = popup.getBoundingClientRect().height;

        let originClass = '';
        if (px + popupW > vw - 10) { px = px - popupW + 20; originClass += ' popup-bottom-right'; }
        if (py + popupH > vh - 10) { py = py - popupH - 10; originClass += ' popup-top-left'; }

        if (originClass.includes('popup-bottom-right') && originClass.includes('popup-top-left')) {
            originClass = 'popup-top-right';
        }

        popup.className = 'msg-options-popup ' + originClass.trim();
        popup.style.left = Math.max(8, px) + 'px';
        popup.style.top = Math.max(8, py) + 'px';

        options.forEach((opt, i) => {
            document.getElementById(`memopt-${i}`).onclick = (evt) => {
                evt.stopPropagation();
                popup.remove();
                backdrop.remove();
                opt.action();
            };
        });
    }

    async deleteChatPrompt(chatId) {
        this.showConfirm(
            this.lang === 'ar' ? 'حذف المحادثة' : 'Delete Conversation',
            this.lang === 'ar' ? 'تحذير: هل أنت متأكد من مسح أو مغادرة هذه المحادثة نهائياً؟' : 'Warning: Are you sure you want to completely delete or leave this conversation?',
            async () => {
                const chat = this.allChats.find(c => c.id === chatId);
                if (!chat) return;
                const newMembers = chat.memberIds.filter(id => id !== this.user.uid);
                await setDoc(doc(db, 'chats', chatId), { memberIds: newMembers }, { merge: true });
                this.closeMobileOverlay();
                this.activeChatId = null;
                this.renderFilteredChats();
                this.closeModal();
                const chatWindow = document.getElementById('chat-window');
                if (chatWindow) chatWindow.classList.add('hidden');
                const emptyState = document.getElementById('empty-state');
                if (emptyState) emptyState.classList.remove('hidden');
            }
        );
    }

    // --- Long Press Handlers for Message Options ---
    onMsgContextMenu(e, chatId, msgId) {
        e.preventDefault();
        this.showMsgOptions(e, chatId, msgId);
    }

    onMsgTouchStart(e, chatId, msgId) {
        this._longPressTimer = setTimeout(() => {
            // Simulate position from touch
            const touch = e.touches[0];
            const fakeEvent = { clientX: touch.clientX, clientY: touch.clientY, preventDefault: () => { } };
            this.showMsgOptions(fakeEvent, chatId, msgId);
            if (navigator.vibrate) navigator.vibrate(30);
        }, 500);
    }

    onMsgTouchEnd(e) {
        clearTimeout(this._longPressTimer);
    }

    onMsgMouseDown(e, chatId, msgId) {
        // Only on desktop (not touch)
        if (e.button !== 0) return; // left click only
        this._longPressTimer = setTimeout(() => {
            this.showMsgOptions(e, chatId, msgId);
        }, 500);
    }

    onMsgMouseUp(e) {
        clearTimeout(this._longPressTimer);
    }

    showMsgOptions(e, chatId, msgId) {
        const msg = this.currentMessages[msgId];
        if (!msg) return;
        const isMine = msg.senderId === this.user.uid;
        const canEdit = isMine && !msg.image && !msg.audio;

        let buttonsHTML = '';
        buttonsHTML += `<button class="msg-option-btn" onclick="app.prepareReply('${chatId}', '${msgId}')">
            <i data-lucide="corner-down-left"></i>
            ${this.lang === 'ar' ? 'رد' : 'Reply'}
        </button>`;

        if (msg.text) {
            buttonsHTML += `<button class="msg-option-btn" onclick="app.copyMsg('${msgId}')">
                <i data-lucide="copy"></i>
                ${this.lang === 'ar' ? 'نسخ النص' : 'Copy Text'}
            </button>`;
        }
        if (canEdit) {
            buttonsHTML += `<button class="msg-option-btn" onclick="app.editMsgPrompt('${chatId}', '${msgId}')">
                <i data-lucide="edit-2"></i>
                ${this.lang === 'ar' ? 'تعديل' : 'Edit Message'}
            </button>`;
        }
        if (msg.image) {
            buttonsHTML += `<button class="msg-option-btn" onclick="app.viewImage('${msg.image}'); app.closeMsgOptionsPopup();">
                <i data-lucide="maximize"></i>
                ${this.lang === 'ar' ? 'عرض الصورة كاملة' : 'View Full Image'}
            </button>`;
        }

        if (!buttonsHTML && !isMine) return;

        if (!buttonsHTML) return;

        // Reaction Bar
        const emojis = ['❤️', '😂', '😮', '😢', '🔥', '👍'];
        const reactionsHTML = `
            <div class="reaction-picker">
                ${emojis.map(e => `<button class="reaction-btn" onclick="app.addReaction('${chatId}', '${msgId}', '${e}')">${e}</button>`).join('')}
            </div>
        `;

        if (buttonsHTML && isMine) {
            buttonsHTML += `<div class="msg-option-divider"></div>`;
        }
        if (isMine) {
            buttonsHTML += `<button class="msg-option-btn danger" onclick="app.deleteMsg('${chatId}', '${msgId}')">
                <i data-lucide="trash-2"></i>
                ${this.lang === 'ar' ? 'حذف للكل' : 'Delete for Everyone'}
            </button>`;
        }

        if (!buttonsHTML) return;

        // Remove any existing popup
        this.closeMsgOptionsPopup();

        // Create backdrop
        const backdrop = document.createElement('div');
        backdrop.id = 'msg-options-backdrop';
        backdrop.onclick = () => this.closeMsgOptionsPopup();
        document.body.appendChild(backdrop);

        // Create popup
        const popup = document.createElement('div');
        popup.id = 'msg-options-popup';
        popup.innerHTML = reactionsHTML + buttonsHTML;
        document.body.appendChild(popup);
        lucide.createIcons({ node: popup });

        // Position popup near the touch/click point
        const popupW = 220;
        const popupH = popup.getBoundingClientRect().height || 180;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        let x = e.clientX;
        let y = e.clientY;

        // Flip if too close to edges
        let originClass = '';
        if (x + popupW > vw - 10) { x = x - popupW; originClass += ' popup-bottom-right'; }
        if (y + popupH > vh - 10) { y = y - popupH; originClass += ' popup-top-left'; }
        if (originClass.includes('popup-bottom-right') && originClass.includes('popup-top-left')) {
            originClass = 'popup-top-right';
        }
        popup.className = 'msg-options-popup ' + originClass.trim();
        popup.id = 'msg-options-popup';
        popup.style.left = Math.max(8, x) + 'px';
        popup.style.top = Math.max(8, y) + 'px';
    }

    closeMsgOptionsPopup() {
        document.getElementById('msg-options-popup')?.remove();
        document.getElementById('msg-options-backdrop')?.remove();
    }

    prepareReply(chatId, msgId) {
        this.closeMsgOptionsPopup();
        this.replyToMsgId = msgId;
        const msg = this.currentMessages[msgId];
        if (!msg) return;

        let replyPreview = document.getElementById('reply-preview-box');
        if (!replyPreview) {
            replyPreview = document.createElement('div');
            replyPreview.id = 'reply-preview-box';
            replyPreview.style.cssText = `
                background: var(--glass-panel-solid);
                backdrop-filter: blur(10px);
                border-${this.lang === 'ar' ? 'right' : 'left'}: 4px solid var(--accent);
                padding: 10px 14px;
                border-radius: 12px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                font-size: 13px;
                margin: 0 16px -12px 16px;
                position: relative;
                z-index: 10;
                box-shadow: var(--shadow-sm);
            `;
            const inputArea = document.querySelector('.input-area > div');
            inputArea.parentElement.insertBefore(replyPreview, inputArea);
        }

        let previewText = msg.text || (msg.image ? (this.lang === 'ar' ? '📷 صورة' : '📷 Image') : (this.lang === 'ar' ? '🎤 تسجيل صوتي' : '🎤 Voice Message'));
        if (previewText.length > 60) previewText = previewText.substring(0, 60) + '...';

        const chat = this.allChats.find(c => c.id === chatId);
        const replyName = msg.senderId === this.user.uid ? (this.lang === 'ar' ? 'أنت' : 'You') : (chat.memberData[msg.senderId]?.name || 'User');

        replyPreview.innerHTML = `
            <div style="flex: 1; min-width: 0; text-align: ${this.lang === 'ar' ? 'right' : 'left'};">
                <div style="font-weight: 700; color: var(--accent); margin-bottom: 2px;">${replyName}</div>
                <div style="color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${previewText}</div>
            </div>
            <button onclick="app.cancelReply()" style="background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px; flex-shrink: 0; margin-${this.lang === 'ar' ? 'right' : 'left'}: 12px;">
                <i data-lucide="x" style="width: 18px;"></i>
            </button>
        `;
        lucide.createIcons();
        document.getElementById('msg-input').focus();
    }

    cancelReply() {
        this.replyToMsgId = null;
        document.getElementById('reply-preview-box')?.remove();
    }

    async copyMsg(msgId) {
        const msg = this.currentMessages[msgId];
        if (msg && msg.text) {
            navigator.clipboard.writeText(msg.text);
        }
        this.closeMsgOptionsPopup();
    }

    async editMsgPrompt(chatId, msgId) {
        this.closeMsgOptionsPopup();
        const msg = this.currentMessages[msgId];
        this.showPrompt(
            this.lang === 'ar' ? 'تعديل الرسالة' : 'Edit Message',
            this.lang === 'ar' ? 'قم بتعديل نص الرسالة:' : 'Edit the message text:',
            msg.text,
            async (newText) => {
                if (newText && newText.trim() !== '' && newText.trim() !== msg.text) {
                    const text = newText.trim();
                    await updateDoc(doc(db, `chats/${chatId}/messages`, msgId), { text, edited: true });

                    // Update sidebar if this was the last message
                    const chat = this.allChats.find(c => c.id === chatId);
                    if (chat && chat.lastMessage && chat.lastMessage.msgId === msgId) {
                        await updateDoc(doc(db, 'chats', chatId), {
                            'lastMessage.text': text
                        });
                    }
                }
            }
        );
    }

    async deleteMsg(chatId, msgId) {
        this.closeMsgOptionsPopup();
        this.showConfirm(
            this.lang === 'ar' ? 'حذف الرسالة' : 'Delete Message',
            this.lang === 'ar' ? 'هل أنت متأكد من حذف هذه الرسالة نهائياً؟' : 'Are you sure you want to delete this message permanently?',
            async () => {
                await deleteDoc(doc(db, `chats/${chatId}/messages`, msgId));

                // Update sidebar if this was the last message
                const chat = this.allChats.find(c => c.id === chatId);
                if (chat && chat.lastMessage && chat.lastMessage.msgId === msgId) {
                    const q = query(collection(db, `chats/${chatId}/messages`), orderBy('createdAt', 'desc'), limit(1));
                    const snap = await getDocs(q);
                    if (!snap.empty) {
                        const last = snap.docs[0].data();
                        const lastText = last.text || (last.image ? (this.lang === 'ar' ? '📷 صورة' : '📷 Image') : (this.lang === 'ar' ? '🎤 تسجيل صوتي' : '🎤 Voice Message'));
                        await updateDoc(doc(db, 'chats', chatId), {
                            lastMessage: { text: lastText, senderId: last.senderId, msgId: snap.docs[0].id }
                        });
                    } else {
                        await updateDoc(doc(db, 'chats', chatId), { lastMessage: null });
                    }
                }
            }
        );
    }

    // --- Search & Real Users ---
    showModal(contentHTML) {
        const overlay = document.getElementById('modal-overlay');
        const content = document.getElementById('modal-content');
        content.innerHTML = contentHTML;
        overlay.classList.remove('hidden');
    }

    closeModal() {
        document.getElementById('modal-overlay').classList.add('hidden');
    }

    showNewChatModal() {
        this.showModal(`
            <h2 style="font-size: 24px; font-weight: 700; margin-bottom: 24px;">${this.t('start_context')}</h2>
            <div style="display:flex; gap: 12px; margin-bottom: 24px;">
                <button class="glass-btn" style="flex:1" onclick="app.renderChatForm('direct')">${this.t('private_chat')}</button>
                <button class="btn-ghost" style="flex:1;" onclick="app.renderChatForm('group')">${this.t('group_chat')}</button>
            </div>
            <div id="modal-form-area" style="display:flex; flex-direction: column; gap: 16px;"></div>
        `);
        this.renderChatForm('direct');
    }

    renderChatForm(type) {
        const area = document.getElementById('modal-form-area');
        if (type === 'direct') {
            area.innerHTML = `
                <input type="text" id="target-identifier" placeholder="${this.t('email_user_placeholder')}" autocomplete="off" style="width: 100%; padding: 16px 20px; border-radius: 14px; background: white; border: 1px solid rgba(0,0,0,0.05); font-size: 15px;">
                <div style="display: flex; gap: 12px; margin-top: 12px;">
                    <button class="btn-ghost" style="flex:1" onclick="app.closeModal()">${this.t('dismiss')}</button>
                    <button class="glass-btn" style="flex:1" onclick="app.startDirectChat()">${this.t('connect')}</button>
                </div>
            `;
        } else {
            area.innerHTML = `
                <input type="text" id="group-name" placeholder="${this.t('group_name_placeholder')}" autocomplete="off" style="width: 100%; padding: 16px 20px; border-radius: 14px; background: white; border: 1px solid rgba(0,0,0,0.05); font-size: 15px;">
                <input type="text" id="target-identifier" placeholder="${this.t('members_placeholder')}" autocomplete="off" style="width: 100%; padding: 16px 20px; border-radius: 14px; background: white; border: 1px solid rgba(0,0,0,0.05); font-size: 15px;">
                    <div style="display: flex; gap: 12px; margin-top: 12px;">
                        <button class="btn-ghost" style="flex:1" onclick="app.closeModal()">${this.t('dismiss')}</button>
                        <button class="glass-btn" style="flex:1" onclick="app.startGroupChat()">${this.t('form_group')}</button>
                    </div>
                    `;
        }
    }

    async findUsersByIdentifiers(identifiers) {
        const users = [];
        for (let id of identifiers) {
            id = id.trim().toLowerCase();
            if (!id) continue;

            let q = query(collection(db, 'users'), where('email', '==', id));
            let snap = await getDocs(q);

            if (snap.empty) {
                q = query(collection(db, 'users'), where('username', '==', id));
                snap = await getDocs(q);
            }

            if (!snap.empty && snap.docs[0].data().uid !== this.user.uid) {
                users.push(snap.docs[0].data());
            }
        }
        return users;
    }

    async startDirectChat() {
        const val = document.getElementById('target-identifier').value;
        if (!val) return;

        const users = await this.findUsersByIdentifiers([val]);
        if (users.length === 0) {
            this.showAlert(this.lang === 'ar' ? 'لم يتم العثور على الحساب' : 'Account Not Found', this.lang === 'ar' ? 'لا توجد حسابات مطابقة لهذا الاسم أو البريد.' : 'No matching accounts found.');
            return;
        }

        const target = users[0];
        const existingChat = this.allChats.find(c => c.type === 'direct' && c.memberIds.includes(target.uid));
        this.closeModal();

        if (existingChat) {
            document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            document.querySelector('.nav-item[data-page="chats"]').classList.add('active');
            this.handleNavigation('chats');
            this.selectChat(existingChat.id);
            return;
        }

        const newChatRef = await addDoc(collection(db, 'chats'), {
            type: 'direct',
            memberIds: [this.user.uid, target.uid],
            memberData: {
                [this.user.uid]: { name: this.userData?.displayName || this.user.displayName, photo: this.userData?.photoURL || this.user.photoURL, email: this.user.email, username: this.userData?.username },
                [target.uid]: { name: target.displayName, photo: target.photoURL, email: target.email, username: target.username }
            },
            archivedBy: [],
            updatedAt: serverTimestamp(),
            lastMessage: null
        });

        this.handleNavigation('chats');
        this.selectChat(newChatRef.id);
    }

    async startGroupChat() {
        const name = document.getElementById('group-name').value.trim();
        const membs = document.getElementById('target-identifier').value.split(',');
        if (!name || membs.length === 0) return this.showAlert(this.lang === 'ar' ? 'معلومات ناقصة' : 'Details Required', this.lang === 'ar' ? 'يرجى ملء كافة تفاصيل المجموعة.' : 'Please fill all details.');

        // Cooldown check: 1 minute (60,000 ms)
        const now = Date.now();
        const cooldown = 60000;
        if (now - this.lastGroupCreationTime < cooldown) {
            const remaining = Math.ceil((cooldown - (now - this.lastGroupCreationTime)) / 1000);
            return this.showAlert(this.lang === 'ar' ? 'تمهل قليلاً' : 'Slow Down', this.lang === 'ar' ? `يرجى الانتظار ${remaining} ثانية قبل إنشاء مجموعة أخرى.` : `Please wait ${remaining} seconds before creating another group.`);
        }

        if (this.isCreatingGroup) return;

        const users = await this.findUsersByIdentifiers(membs);
        if (users.length === 0) {
            this.showAlert(this.lang === 'ar' ? 'أعضاء غير صالحين' : 'Invalid Members', this.lang === 'ar' ? 'لم يتم العثور على أعضاء صالحين للمجموعة.' : 'No valid users located.');
            return;
        }

        // Show loading state
        this.isCreatingGroup = true;
        const btn = document.querySelector('.glass-btn[onclick="app.startGroupChat()"]');
        if (btn) {
            btn.disabled = true;
            btn.innerText = this.lang === 'ar' ? 'جاري الإنشاء...' : 'Creating...';
            btn.style.opacity = '0.7';
        }

        try {
            const memberIds = [this.user.uid, ...users.map(u => u.uid)];
            const memberData = {
                [this.user.uid]: { name: this.userData.displayName, photo: this.userData.photoURL }
            };
            users.forEach(u => {
                memberData[u.uid] = { name: u.displayName, photo: u.photoURL };
            });

            const newChatRef = await addDoc(collection(db, 'chats'), {
                type: 'group',
                name: name,
                memberIds: memberIds,
                memberData: memberData,
                archivedBy: [],
                updatedAt: serverTimestamp(),
                lastMessage: null,
                admins: [this.user.uid]
            });

            this.lastGroupCreationTime = Date.now();
            this.closeModal();
            this.handleNavigation('chats');
            this.selectChat(newChatRef.id);
        } catch (e) {
            console.error("Group creation failed:", e);
            this.showAlert(this.lang === 'ar' ? 'خطأ' : 'Error', this.lang === 'ar' ? 'فشل إنشاء المجموعة. حاول لاحقاً.' : 'Failed to create group. Try again later.');
        } finally {
            this.isCreatingGroup = false;
        }
    }

    // --- Dynamic Fullscreen Pages ---
    renderProfilePage() {
        this.pendingProfileImage = null;
        const container = document.getElementById('page-content');
        container.classList.remove('hidden');
        document.getElementById('chat-window').classList.add('hidden');
        document.getElementById('empty-state').classList.add('hidden');

        container.innerHTML = `
            <div class="page-container">
                <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 32px;">
                    <button class="mobile-back-btn" onclick="app.handleNavigation('chats')"><i data-lucide="chevron-left"></i></button>
                    <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: var(--text-primary);">${this.t('profile')}</h1>
                </div>

                        <div style="display: flex; align-items: center; gap: 20px; margin-bottom: 32px;">
                            <label style="cursor: pointer; position: relative; flex-shrink: 0;">
                                <img id="prof-img-preview" src="${this.userData.photoURL}" style="width: 80px; height: 80px; border-radius: 50%; object-fit: cover; box-shadow: var(--shadow-sm);">
                                    <div style="position: absolute; bottom: 0; right: 0; background: var(--accent); color: white; border-radius: 50%; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; box-shadow: var(--shadow-sm);"><i data-lucide="camera" style="width: 14px;"></i></div>
                                    <input type="file" accept="image/*" style="display: none;" onchange="app.handleImageUpload(event)">
                                    </label>
                                    <div style="overflow: hidden;">
                                        <h2 style="margin: 0; font-size: 20px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${this.userData.displayName}</h2>
                                        <span style="color: var(--text-secondary); font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block;">${this.user.email}</span>
                                    </div>
                                </div>

                                <div class="form-group">
                                    <label>${this.t('display_name')}</label>
                                    <input type="text" id="prof-name" value="${this.userData.displayName}" autocomplete="off">
                                </div>
                                <div class="form-group">
                                    <label>${this.t('email_user_placeholder')}</label>
                                    <input type="text" id="prof-user" value="${this.userData.username || ''}" placeholder="example: assem" autocomplete="off">
                                </div>

                                <button class="glass-btn" style="width: 100%; border-radius: 12px; padding: 14px; font-size: 15px; margin-top: 8px;" onclick="app.saveProfile()">${this.t('sync_profile')}</button>

                <div style="margin-top: 24px;">
                    <button class="btn-ghost" style="width: 100%; justify-content: space-between; padding: 16px; border-radius: 12px; display: flex; align-items: center; border: 1px solid var(--glass-border);" onclick="app.renderAboutPage()">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <i data-lucide="info" style="width: 20px;"></i>
                            <span style="font-weight: 500;">${this.t('about_app')}</span>
                        </div>
                        <i data-lucide="chevron-right" style="width: 18px; opacity: 0.5;"></i>
                    </button>
                </div>

                <hr style="margin: 32px 0; border: none; border-top: 1px solid var(--glass-border);">

                                    <button class="glass-btn" style="background: var(--danger); width: 100%; padding: 14px; border-radius: 12px; font-size: 15px;" onclick="app.logout()">${this.t('sign_out')}</button>
                                </div>
                                `;
        lucide.createIcons();
    }

    handleImageUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const size = 150;
                canvas.width = size;
                canvas.height = size;

                const minDim = Math.min(img.width, img.height);
                const sx = (img.width - minDim) / 2;
                const sy = (img.height - minDim) / 2;

                ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);

                this.pendingProfileImage = canvas.toDataURL('image/jpeg', 0.8);
                document.getElementById('prof-img-preview').src = this.pendingProfileImage;
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }
    async saveProfile() {
        const n = document.getElementById('prof-name').value.trim();
        const u = document.getElementById('prof-user').value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');

        if (!n || !u) return this.showAlert(
            this.lang === 'ar' ? 'تنبيه' : 'Alert',
            this.lang === 'ar' ? 'الحقول لا يمكن أن تكون فارغة.' : 'Fields cannot be empty.'
        );

        // Enforce username format: only letters, numbers, underscores
        if (u.length < 3) return this.showAlert(
            this.lang === 'ar' ? 'يوزرنيم قصير' : 'Too Short',
            this.lang === 'ar' ? 'يجب أن يكون اليوزرنيم 3 أحرف على الأقل.' : 'Username must be at least 3 characters.'
        );

        // --- Uniqueness check ---
        try {
            // Skip check if user didn't change their username
            if (u !== this.userData?.username) {
                const qCheck = query(collection(db, 'users'), where('username', '==', u));
                const checkSnap = await getDocs(qCheck);
                const isTaken = checkSnap.docs.some(d => d.id !== this.user.uid);

                if (isTaken) {
                    return this.showAlert(
                        this.lang === 'ar' ? 'اليوزرنيم محجوز' : 'Username Taken',
                        this.lang === 'ar'
                            ? `"${u}" محجوز بالفعل، اختر يوزرنيم مختلف.`
                            : `"${u}" is already taken. Please choose a different username.`
                    );
                }
            }

            const payload = { displayName: n, username: u };
            if (this.pendingProfileImage) {
                payload.photoURL = this.pendingProfileImage;
                this.userData.photoURL = this.pendingProfileImage;
                this.pendingProfileImage = null;
            }

            await setDoc(doc(db, 'users', this.user.uid), payload, { merge: true });

            this.userData.displayName = n;
            this.userData.username = u;

            this.updateGlobalUserUI();

            // Update in all chats
            const batch = writeBatch(db);
            this.allChats.forEach(chat => {
                const memberUpdate = { name: n, username: u };
                if (payload.photoURL) memberUpdate.photo = payload.photoURL;
                batch.set(doc(db, 'chats', chat.id), {
                    memberData: { [this.user.uid]: memberUpdate }
                }, { merge: true });
            });
            await batch.commit();

            this.showAlert(
                this.lang === 'ar' ? 'تم التحديث' : 'Profile Synced',
                this.lang === 'ar' ? 'تم تحديث بيانات حسابك بنجاح.' : 'Profile updated successfully.'
            );
        } catch (e) {
            console.error(e);
            this.showAlert(
                this.lang === 'ar' ? 'خطأ' : 'Error',
                this.lang === 'ar' ? 'حدث خطأ أثناء المزامنة.' : 'An error occurred while saving.'
            );
        }
    }

    listenForStories() {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const q = query(
            collection(db, 'stories'),
            where('createdAt', '>', oneDayAgo),
            orderBy('createdAt', 'desc')
        );

        onSnapshot(q, (snapshot) => {
            this.allStories = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            if (this.currentPage === 'stories') this.renderStoriesPage();
        });
    }

    renderStoriesPage() {
        const container = document.getElementById('page-content');
        container.classList.remove('hidden');
        document.getElementById('chat-window').classList.add('hidden');
        document.getElementById('empty-state').classList.add('hidden');

        let storiesHTML = '';
        const myStory = this.allStories?.find(s => s.uid === this.user.uid);

        // My Story Section - Large & Prominent
        storiesHTML += `
            <div style="margin-bottom: 32px;">
                <h3 style="font-size: 14px; color: var(--text-secondary); margin-bottom: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">${this.lang === 'ar' ? 'قصتي' : 'Your Status'}</h3>
                <div style="background: ${myStory ? 'linear-gradient(135deg, var(--accent), #9333ea)' : 'var(--glass-panel)'}; border-radius: 24px; padding: 24px; display: flex; align-items: center; gap: 20px; box-shadow: ${myStory ? '0 10px 20px rgba(109, 40, 217, 0.2)' : 'none'}; cursor: pointer; transition: transform 0.2s;" onclick="${myStory ? `app.viewStory('${myStory.id}')` : `document.getElementById('story-upload').click()`}">
                    <div style="position: relative;">
                        <img src="${this.userData.photoURL}" style="width: 64px; height: 64px; border-radius: 50%; object-fit: cover; border: 3px solid white;">
                        <div style="position: absolute; bottom: -2px; right: -2px; background: ${myStory ? '#10b981' : 'var(--accent)'}; color: white; border-radius: 50%; width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; font-size: 16px; border: 2px solid white;">${myStory ? '✓' : '+'}</div>
                    </div>
                    <div style="flex: 1;">
                        <h3 style="margin: 0; font-size: 18px; font-weight: 700; color: ${myStory ? 'white' : 'var(--text-primary)'};">${myStory ? (this.lang === 'ar' ? 'عرض قصتك' : 'View your story') : (this.lang === 'ar' ? 'إضافة قصة' : 'Add to story')}</h3>
                        <p style="margin: 4px 0 0; font-size: 14px; color: ${myStory ? 'rgba(255,255,255,0.8)' : 'var(--text-secondary)'};">${myStory ? (this.lang === 'ar' ? 'نشطة الآن' : 'Active now') : (this.lang === 'ar' ? 'شارك يومياتك مع أصدقائك' : 'Share moments with friends')}</p>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button class="glass-btn" onclick="event.stopPropagation(); document.getElementById('story-upload').click()" style="width: 36px; height: 36px; border-radius: 50%; padding: 0; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.2); border: none;"><i data-lucide="camera" style="width: 16px;"></i></button>
                        <button class="glass-btn" onclick="event.stopPropagation(); app.promptTextStory()" style="width: 36px; height: 36px; border-radius: 50%; padding: 0; display: flex; align-items: center; justify-content: center; background: rgba(255,255,255,0.2); border: none;"><i data-lucide="type" style="width: 16px;"></i></button>
                    </div>
                    <input type="file" id="story-upload" hidden accept="image/*" onchange="app.handleStoryUpload(event)">
                </div>
            </div>
        `;

        // Build a set of UIDs this user has chatted with before
        const contactUids = new Set();
        (this.allChats || []).forEach(chat => {
            (chat.memberIds || []).forEach(uid => {
                if (uid !== this.user.uid) contactUids.add(uid);
            });
        });

        const otherStories = (this.allStories || []).filter(s =>
            s.uid !== this.user.uid && contactUids.has(s.uid)
        );

        if (otherStories.length > 0) {
            storiesHTML += `<h3 style="font-size: 14px; color: var(--text-secondary); margin-bottom: 16px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px;">${this.lang === 'ar' ? 'تحديثات الأصدقاء' : 'Recent Updates'}</h3>`;
            storiesHTML += `<div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px;">`;
            otherStories.forEach(s => {
                storiesHTML += `
                    <div class="glass-card" style="position: relative; height: 200px; border-radius: 20px; overflow: hidden; cursor: pointer; background: ${s.type === 'text' ? (s.bg || 'var(--accent)') : 'none'};" onclick="app.viewStory('${s.id}')">
                        ${s.type === 'text' ? `
                            <div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; padding: 20px; text-align: center; color: white; font-weight: 700; font-size: 14px;">
                                ${s.text}
                            </div>
                        ` : `
                            <img src="${s.image}" style="width: 100%; height: 100%; object-fit: cover; filter: brightness(0.8);">
                        `}
                        <div style="position: absolute; top: 12px; left: 12px; display: flex; align-items: center; gap: 8px;">
                            <div style="width: 32px; height: 32px; border-radius: 50%; border: 2px solid var(--accent); padding: 1px; background: white;">
                                <img src="${s.photo}" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">
                            </div>
                        </div>
                        <div style="position: absolute; bottom: 0; left: 0; right: 0; padding: 12px; background: linear-gradient(to top, rgba(0,0,0,0.8), transparent);">
                            <span style="font-size: 14px; font-weight: 600; color: white; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${s.name}</span>
                        </div>
                    </div>
                `;
            });
            storiesHTML += `</div>`;
        } else {
            storiesHTML += `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; background: var(--glass-panel); border-radius: 30px; text-align: center; border: 2px dashed var(--glass-border);">
                    <div style="width: 60px; height: 60px; background: var(--app-bg); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-bottom: 16px; color: var(--text-secondary);">
                        <i data-lucide="circle-dashed" style="width: 32px; height: 32px;"></i>
                    </div>
                    <h3 style="margin: 0 0 8px; font-size: 16px; color: var(--text-primary);">${this.lang === 'ar' ? 'لا توجد قصص بعد' : 'Quiet for now'}</h3>
                    <p style="margin: 0; font-size: 14px; color: var(--text-secondary); line-height: 1.5;">${this.lang === 'ar' ? 'كن أول من يشارك قصة اليوم!' : 'Be the first one to share a story today and inspire others!'}</p>
                </div>
            `;
        }

        container.innerHTML = `
            <div class="page-container" style="padding: 24px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 32px;">
                    <div style="display: flex; align-items: center; gap: 16px;">
                        <button class="mobile-back-btn" onclick="app.handleNavigation('chats')" style="background: var(--glass-panel); border: none; width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--text-primary);"><i data-lucide="chevron-left"></i></button>
                        <h1 style="margin: 0; font-size: 28px; font-weight: 800; color: var(--text-primary); letter-spacing: -0.5px;">${this.t('stories')}</h1>
                    </div>
                    <button class="glass-btn" onclick="document.getElementById('story-upload').click()" style="width: 40px; height: 40px; border-radius: 12px; padding: 0; display: flex; align-items: center; justify-content: center;"><i data-lucide="camera" style="width: 20px;"></i></button>
                </div>
                ${storiesHTML}
            </div>
        `;
        lucide.createIcons();
    }

    async handleStoryUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const reader = new FileReader();
            reader.onload = async (e) => {
                const img = new Image();
                img.onload = async () => {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');

                    // Story aspect ratio is usually 9:16, but we'll crop to square for simplicity or keep original
                    const maxWidth = 1080;
                    let width = img.width;
                    let height = img.height;

                    if (width > maxWidth) {
                        height = (maxWidth / width) * height;
                        width = maxWidth;
                    }

                    canvas.width = width;
                    canvas.height = height;
                    ctx.drawImage(img, 0, 0, width, height);
                    const base64 = canvas.toDataURL('image/jpeg', 0.7);

                    await addDoc(collection(db, 'stories'), {
                        uid: this.user.uid,
                        name: this.userData.displayName,
                        photo: this.userData.photoURL,
                        image: base64,
                        createdAt: serverTimestamp()
                    });

                    this.showAlert(this.lang === 'ar' ? 'تم النشر' : 'Moment Captured', this.lang === 'ar' ? 'تم نشر القصة بنجاح!' : 'Story posted successfully!');
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        } catch (err) {
            console.error(err);
            this.showAlert(this.lang === 'ar' ? 'خطأ' : 'Upload Error', this.lang === 'ar' ? 'فشل رفع القصة.' : 'Error uploading story');
        }
    }

    viewStory(storyId) {
        const story = this.allStories.find(s => s.id === storyId);
        if (!story) return;

        const isMine = story.uid === this.user.uid;
        const timeStr = story.createdAt ? new Date(story.createdAt.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        
        let contentHTML = '';
        if (story.type === 'text') {
            contentHTML = `
                <div style="width: 100%; min-height: 400px; background: ${story.bg || 'var(--accent)'}; display: flex; align-items: center; justify-content: center; padding: 40px; text-align: center; color: white; font-size: 24px; font-weight: 800; line-height: 1.4;">
                    ${story.text}
                </div>
            `;
        } else {
            contentHTML = `<img src="${story.image}" style="width: 100%; height: auto; max-height: 80vh; object-fit: contain; display: block;">`;
        }

        const deleteBtnHTML = isMine ? `
            <button onclick="app.deleteStory('${story.id}')" style="background: rgba(239, 68, 68, 0.2); border: none; color: #ef4444; padding: 8px 16px; border-radius: 12px; font-size: 12px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 6px;">
                <i data-lucide="trash-2" style="width: 14px;"></i> ${this.lang === 'ar' ? 'حذف' : 'Delete'}
            </button>
        ` : '';

        this.showModal(`
            <div style="position: relative; width: 100%; max-width: 500px; margin: 0 auto; background: #000; border-radius: 24px; overflow: hidden; min-height: 300px;">
                <!-- Header -->
                <div style="position: absolute; top: 0; left: 0; right: 0; padding: 20px; background: linear-gradient(to bottom, rgba(0,0,0,0.7), transparent); display: flex; align-items: center; justify-content: space-between; z-index: 10;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <img src="${story.photo}" style="width: 40px; height: 40px; border-radius: 50%; border: 2px solid white;">
                        <div style="color: white;">
                            <div style="font-weight: 600; font-size: 14px;">${story.name}</div>
                            <div style="font-size: 11px; opacity: 0.8;">${timeStr}</div>
                        </div>
                    </div>
                    ${deleteBtnHTML}
                </div>

                ${contentHTML}

                <button onclick="app.closeModal()" style="position: absolute; top: 15px; right: 15px; background: rgba(0,0,0,0.5); border: none; color: white; border-radius: 50%; width: 36px; height: 36px; cursor: pointer; display: flex; align-items: center; justify-content: center; z-index: 20; font-size: 18px;">✕</button>
            </div>
        `);
        lucide.createIcons({ node: document.getElementById('modal-content') });
    }

    async deleteStory(storyId) {
        this.closeModal();
        this.showConfirm(
            this.lang === 'ar' ? 'حذف القصة' : 'Delete Story',
            this.lang === 'ar' ? 'هل أنت متأكد من حذف هذه القصة؟' : 'Are you sure you want to delete this story?',
            async () => {
                await deleteDoc(doc(db, 'stories', storyId));
            }
        );
    }

    promptTextStory() {
        this.showPrompt(
            this.lang === 'ar' ? 'قصة نصية' : 'Text Story',
            this.lang === 'ar' ? 'ماذا يدور في ذهنك؟' : 'What is on your mind?',
            '',
            async (text) => {
                if (text && text.trim()) {
                    await this.submitTextStory(text.trim());
                }
            }
        );
    }

    async submitTextStory(text) {
        const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f97316', '#10b981', '#06b6d4'];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];
        
        await addDoc(collection(db, 'stories'), {
            uid: this.user.uid,
            name: this.userData.displayName,
            photo: this.userData.photoURL,
            type: 'text',
            text: text,
            bg: randomColor,
            createdAt: serverTimestamp()
        });
        
        this.showAlert(this.lang === 'ar' ? 'تم النشر' : 'Moment Captured', this.lang === 'ar' ? 'تم نشر القصة بنجاح!' : 'Story shared successfully!');
    }

    renderSettingsPage() {
        const container = document.getElementById('page-content');
        container.classList.remove('hidden');
        document.getElementById('chat-window').classList.add('hidden');
        document.getElementById('empty-state').classList.add('hidden');

        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';

        container.innerHTML = `
                                <div class="page-container">
                                    <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 32px;">
                                        <button class="mobile-back-btn" onclick="app.handleNavigation('chats')"><i data-lucide="chevron-left"></i></button>
                                        <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: var(--text-primary);">${this.t('settings')}</h1>
                                    </div>

                                    <div class="form-group">
                                        <label>${this.t('language')}</label>
                                        <select id="lang-sel" onchange="app.setLang(this.value)">
                                            <option value="en" ${this.lang === 'en' ? 'selected' : ''}>English</option>
                                            <option value="ar" ${this.lang === 'ar' ? 'selected' : ''}>العربية</option>
                                        </select>
                                    </div>

                                    <div class="form-group">
                                        <label>${this.t('app_theme')}</label>
                                        <select id="theme-sel" onchange="app.setTheme(this.value)">
                                            <option value="light" ${currentTheme === 'light' ? 'selected' : ''}>${this.t('light_mode')}</option>
                                            <option value="dark" ${currentTheme === 'dark' ? 'selected' : ''}>${this.t('dark_mode')}</option>
                                        </select>
                                    </div>

                                    <div class="form-group" style="padding-top: 16px;">
                                        <label style="display: flex; align-items: center; gap: 12px; font-size: 15px; cursor: pointer; color: var(--text-primary);">
                                            <input type="checkbox" checked style="width: 20px; height: 20px; accent-color: var(--accent);">
                                                ${this.t('desktop_notifs')}
                                        </label>
                                    </div>

                                    <div class="form-group">
                                        <label style="display: flex; align-items: center; gap: 12px; font-size: 15px; cursor: pointer; color: var(--text-primary);">
                                            <input type="checkbox" checked style="width: 20px; height: 20px; accent-color: var(--accent);">
                                                ${this.t('read_receipts')}
                                        </label>
                                    </div>

                                    <button class="glass-btn" style="width: 100%; border-radius: 12px; padding: 14px; font-size: 15px; margin-top: 16px;" onclick="app.showAlert(app.lang === 'ar' ? 'تم الحفظ' : 'Preferences Saved', app.lang === 'ar' ? 'تم حفظ التفضيلات بنجاح.' : 'Environment localized successfully.')">${this.t('commit')}</button>
                                </div>
                                `;
        lucide.createIcons();
    }

    renderAboutPage() {
        const container = document.getElementById('page-content');
        container.classList.remove('hidden');
        document.getElementById('chat-window').classList.add('hidden');
        document.getElementById('empty-state').classList.add('hidden');

        container.innerHTML = `
            <div class="page-container" style="max-width: 500px; margin: 0 auto; padding-top: 10px;">
                <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 40px;">
                    <button class="mobile-back-btn" onclick="app.renderProfilePage()"><i data-lucide="chevron-left"></i></button>
                    <h1 style="margin: 0; font-size: 24px; font-weight: 800; color: var(--text-primary);">${this.t('about_app')}</h1>
                </div>

                <div style="text-align: center; margin-bottom: 48px;">
                    <div style="width: 100px; height: 100px; border-radius: 28px; background: white; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; box-shadow: 0 20px 40px rgba(0,0,0,0.1); overflow: hidden;">
                        <img src="assets/logo.jpg" style="width: 100%; height: 100%; object-fit: cover;">
                    </div>
                    <h2 style="margin: 0; font-size: 28px; font-weight: 800; color: var(--text-primary);">Hamster Chat</h2>
                    <p style="margin: 8px 0 0; color: var(--text-secondary); font-size: 15px; opacity: 0.7;">Version 2.0.0</p>
                </div>

                <div style="background: var(--glass-panel); border-radius: 24px; padding: 24px; border: 1px solid var(--glass-border); margin-bottom: 24px;">
                    <h3 style="margin: 0 0 16px; font-size: 14px; color: var(--text-secondary); font-weight: 600; text-transform: uppercase; letter-spacing: 1px;">${this.lang === 'ar' ? 'عن المطور' : 'Developer Info'}</h3>
                    <div style="display: flex; align-items: center; gap: 16px;">
                        <img src="assets/me.jpg" style="width: 48px; height: 48px; border-radius: 50%; object-fit: cover; border: 2px solid var(--accent);">
                        <div>
                            <div style="font-weight: 700; color: var(--text-primary); font-size: 18px;">Assem Mohamed</div>
                            <div style="font-size: 13px; color: var(--text-secondary);">${this.lang === 'ar' ? 'مطور واجهات ومصمم تجربة مستخدم' : 'Frontend Developer & UI/UX Designer'}</div>
                        </div>
                    </div>
                    <a href="https://portfolio-for-assem.netlify.app" target="_blank" style="display: flex; align-items: center; justify-content: center; gap: 10px; margin-top: 24px; background: var(--accent); color: white; padding: 14px; border-radius: 14px; text-decoration: none; font-weight: 700; font-size: 15px; transition: transform 0.2s;">
                        <i data-lucide="external-link" style="width: 18px;"></i>
                        ${this.lang === 'ar' ? 'زيارة معرض أعمالي' : 'Explore My Portfolio'}
                    </a>
                </div>

                <div style="text-align: center; color: var(--text-secondary); font-size: 13px; line-height: 1.6; opacity: 0.6; margin-top: 40px;">
                    &copy; ${new Date().getFullYear()} Tadfuq Company.<br>
                    ${this.lang === 'ar' ? 'تم التطوير بكل حب بواسطة عاصم محمد' : 'Designed & Built with ❤️ by Assem Mohamed'}
                </div>
            </div>
        `;
        lucide.createIcons();
    }

    // --- Stabilized Voice Messages ---
    async startRecording() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            return alert(this.lang === 'ar' ? 'المتصفح لا يدعم التسجيل الصوتي' : 'Browser does not support recording');
        }
        try {
            this.audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this.mediaRecorder = new MediaRecorder(this.audioStream);
            this.audioChunks = [];

            this.mediaRecorder.ondataavailable = e => {
                if (e.data.size > 0) this.audioChunks.push(e.data);
            };

            this.mediaRecorder.onstop = () => this.handleAudioUpload();
            this.mediaRecorder.start();

            const voiceBtn = document.getElementById('voice-btn');
            if (voiceBtn) {
                voiceBtn.style.color = '#ef4444';
                voiceBtn.style.transform = 'scale(1.2)';
            }
        } catch (e) {
            console.error(e);
            alert(this.lang === 'ar' ? 'فشل الوصول للميكروفون' : 'Mic access denied');
        }
    }

    stopRecording() {
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
            if (this.audioStream) {
                this.audioStream.getTracks().forEach(t => t.stop());
            }
            const voiceBtn = document.getElementById('voice-btn');
            if (voiceBtn) {
                voiceBtn.style.color = 'var(--text-secondary)';
                voiceBtn.style.transform = 'scale(1)';
            }
        }
    }

    async handleAudioUpload() {
        if (this.audioChunks.length === 0) return;
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });

        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
            const base64Audio = reader.result;
            if (this.activeChatId) {
                const payload = {
                    senderId: this.user.uid,
                    audio: base64Audio,
                    createdAt: serverTimestamp(),
                    status: 'sent'
                };
                if (this.replyToMsgId) {
                    payload.replyTo = this.replyToMsgId;
                }

                const msgRef = await addDoc(collection(db, `chats/${this.activeChatId}/messages`), payload);
                const text = this.lang === 'ar' ? '🎤 تسجيل صوتي' : '🎤 Voice Message';
                await updateDoc(doc(db, 'chats', this.activeChatId), {
                    updatedAt: serverTimestamp(),
                    lastMessage: { text, senderId: this.user.uid, msgId: msgRef.id }
                });

                this.cancelReply();
            }
        };
    }

    // --- Enterprise-Grade Call System (WebRTC) ---
    listenForCalls() {
        const qCalls = query(collection(db, 'calls'), where('receiverId', '==', this.user.uid), where('status', '==', 'ringing'));
        onSnapshot(qCalls, (snap) => {
            snap.docs.forEach(d => {
                if (!this.activeCallId) this.showIncomingCall(d.id, d.data());
            });
        });
    }

    async setupCallInternal(callId) {
        if (this.callListener) this.callListener();
        this.callListener = onSnapshot(doc(db, 'calls', callId), async (snap) => {
            const data = snap.data();
            if (!data) return;

            if (data.status === 'ended') {
                this.cleanupCall();
            } else if (data.status === 'connected' && this.pc && this.pc.signalingState === 'have-local-offer' && data.answer) {
                const remoteDesc = new RTCSessionDescription(data.answer);
                await this.pc.setRemoteDescription(remoteDesc);
                this.startCallTimer();
            } else if (data.status === 'connected' && this.isReceiver) {
                this.startCallTimer();
            }
        });

        // Pull remote candidates
        const type = this.isReceiver ? 'callerCandidates' : 'receiverCandidates';
        const remoteCandidatesRef = collection(db, `calls/${callId}/${type}`);
        onSnapshot(remoteCandidatesRef, (snap) => {
            snap.docChanges().forEach(async (change) => {
                if (change.type === 'added' && this.pc) {
                    const data = change.doc.data();
                    try {
                        await this.pc.addIceCandidate(new RTCIceCandidate(data));
                    } catch (e) {
                        console.warn("ICE candidate error", e);
                    }
                }
            });
        });
    }

    // --- WhatsApp Audio Player Logic ---
    toggleAudio(btn, msgId) {
        const audio = document.getElementById(`audio-${msgId}`);
        const icon = document.getElementById(`icon-${msgId}`);

        if (audio.paused) {
            // Stop all other audios
            document.querySelectorAll('audio').forEach(a => {
                if (a.id.startsWith('audio-') && a.id !== `audio-${msgId}`) {
                    a.pause();
                    const otherId = a.id.replace('audio-', '');
                    const otherIcon = document.getElementById(`icon-${otherId}`);
                    if (otherIcon) {
                        otherIcon.setAttribute('data-lucide', 'play');
                    }
                }
            });
            audio.play();
            icon.setAttribute('data-lucide', 'pause');
        } else {
            audio.pause();
            icon.setAttribute('data-lucide', 'play');
        }
        lucide.createIcons();
    }

    updateAudioProgress(msgId) {
        const audio = document.getElementById(`audio-${msgId}`);
        const slider = document.querySelector(`#player-${msgId} .wa-audio-slider`);
        const timeDisplay = document.getElementById(`dur-${msgId}`);
        const bars = document.querySelectorAll(`#player-${msgId} .wa-waveform-bar`);

        if (audio && slider) {
            const progress = (audio.currentTime / audio.duration) * 100;
            slider.value = progress || 0;

            // Highlight bars
            const activeBarsCount = Math.floor((progress / 100) * bars.length);
            bars.forEach((bar, index) => {
                if (index < activeBarsCount) bar.classList.add('active');
                else bar.classList.remove('active');
            });

            // Update time
            const m = Math.floor(audio.currentTime / 60);
            const s = Math.floor(audio.currentTime % 60).toString().padStart(2, '0');
            timeDisplay.innerText = `${m}:${s}`;
        }
    }

    seekAudio(slider, msgId) {
        const audio = document.getElementById(`audio-${msgId}`);
        if (audio && audio.duration) {
            audio.currentTime = (slider.value / 100) * audio.duration;
        }
    }

    resetAudioPlayer(msgId) {
        const icon = document.getElementById(`icon-${msgId}`);
        const slider = document.querySelector(`#player-${msgId} .wa-audio-slider`);
        const bars = document.querySelectorAll(`#player-${msgId} .wa-waveform-bar`);

        if (icon) {
            icon.setAttribute('data-lucide', 'play');
            lucide.createIcons();
        }
        if (slider) slider.value = 0;
        bars.forEach(bar => bar.classList.remove('active'));
    }

    setAudioDuration(msgId) {
        const audio = document.getElementById(`audio-${msgId}`);
        const timeDisplay = document.getElementById(`dur-${msgId}`);
        if (!audio || !timeDisplay) return;

        const setDisplay = (duration) => {
            if (!duration || !isFinite(duration)) return;
            const m = Math.floor(duration / 60);
            const s = Math.floor(duration % 60).toString().padStart(2, '0');
            timeDisplay.innerText = `${m}:${s}`;
        };

        // Try native duration first (works on desktop/Chrome)
        if (audio.duration && isFinite(audio.duration)) {
            setDisplay(audio.duration);
            return;
        }

        // Fallback: decode with AudioContext (fixes mobile/iOS/Safari issue)
        try {
            const src = audio.src;
            let bufferPromise;

            if (src.startsWith('data:')) {
                // Efficiently convert base64 data URL to ArrayBuffer without fetch
                const base64 = src.split(',')[1];
                const binaryStr = atob(base64);
                const bytes = new Uint8Array(binaryStr.length);
                for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
                bufferPromise = Promise.resolve(bytes.buffer);
            } else {
                bufferPromise = fetch(src).then(r => r.arrayBuffer());
            }

            bufferPromise
                .then(buffer => {
                    const ctx = new (window.AudioContext || window.webkitAudioContext)();
                    return ctx.decodeAudioData(buffer);
                })
                .then(decoded => setDisplay(decoded.duration))
                .catch(() => {
                    audio.addEventListener('loadedmetadata', () => setDisplay(audio.duration), { once: true });
                });
        } catch (_) {
            audio.addEventListener('loadedmetadata', () => setDisplay(audio.duration), { once: true });
        }
    }

    async startCall(chatId) {
        const chat = this.allChats.find(c => c.id === chatId);
        const partnerId = chat.memberIds.find(id => id !== this.user.uid);
        this.isReceiver = false;

        this.renderCallUI(partnerId, 'outgoing', chat.memberData[partnerId]?.name || 'User');

        const servers = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' },
                { urls: 'stun:stun.services.mozilla.com' }
            ]
        };
        this.pc = new RTCPeerConnection(servers);

        this.pc.onicecandidate = (event) => {
            if (event.candidate) {
                addDoc(collection(db, `calls/${this.activeCallId}/callerCandidates`), event.candidate.toJSON());
            }
        };

        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        this.localStream.getTracks().forEach(track => this.pc.addTrack(track, this.localStream));

        this.pc.ontrack = (event) => {
            const remoteAudio = document.getElementById('remote-audio');
            if (remoteAudio) {
                remoteAudio.srcObject = event.streams[0];
                remoteAudio.play().catch(e => console.warn('Audio play restricted:', e));
            }
        };

        const offerDescription = await this.pc.createOffer();
        await this.pc.setLocalDescription(offerDescription);

        const callDoc = await addDoc(collection(db, 'calls'), {
            callerId: this.user.uid,
            callerName: this.userData.displayName,
            receiverId: partnerId,
            status: 'ringing',
            offer: { sdp: offerDescription.sdp, type: offerDescription.type },
            createdAt: serverTimestamp()
        });

        this.activeCallId = callDoc.id;
        this.setupCallInternal(this.activeCallId);
    }

    async showIncomingCall(callId, data) {
        this.activeCallId = callId;
        this.isReceiver = true;
        this.renderCallUI(data.callerId, 'incoming', data.callerName);
    }

    async answerCall() {
        const callRef = doc(db, 'calls', this.activeCallId);
        const snap = await getDoc(callRef);
        const data = snap.data();

        const servers = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' },
                { urls: 'stun:stun3.l.google.com:19302' },
                { urls: 'stun:stun4.l.google.com:19302' },
                { urls: 'stun:stun.services.mozilla.com' }
            ]
        };
        this.pc = new RTCPeerConnection(servers);

        this.pc.onicecandidate = (event) => {
            if (event.candidate) {
                addDoc(collection(db, `calls/${this.activeCallId}/receiverCandidates`), event.candidate.toJSON());
            }
        };

        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        this.localStream.getTracks().forEach(track => this.pc.addTrack(track, this.localStream));

        this.pc.ontrack = (event) => {
            const remoteAudio = document.getElementById('remote-audio');
            if (remoteAudio) {
                remoteAudio.srcObject = event.streams[0];
                remoteAudio.play().catch(e => console.warn('Audio play restricted:', e));
            }
        };

        await this.pc.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answerDescription = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answerDescription);

        await updateDoc(callRef, {
            answer: { sdp: answerDescription.sdp, type: answerDescription.type },
            status: 'connected'
        });

        this.setupCallInternal(this.activeCallId);
        document.getElementById('answer-btn')?.remove();
        document.getElementById('call-status').innerText = this.lang === 'ar' ? 'متصل' : 'Connected';
    }

    renderCallUI(partnerId, type, name = '') {
        const overlay = document.createElement('div');
        overlay.id = 'call-overlay';
        overlay.style = 'position: fixed; inset: 0; z-index: 1000; display: flex; flex-direction: column; align-items: center; justify-content: center; background: rgba(0,0,0,0.95); backdrop-filter: blur(20px); color: white;';
        overlay.innerHTML = `
            <div style="text-align: center; margin-bottom: 40px;">
                <div style="width: 120px; height: 120px; border-radius: 50%; border: 4px solid var(--accent); padding: 5px; margin: 0 auto 20px;"><img src="https://ui-avatars.com/api/?name=${name || 'User'}&size=120&background=random" style="width: 100%; height: 100%; border-radius: 50%;"></div>
                <h2 style="font-size: 24px; margin: 0;">${name}</h2>
                <div id="call-status" style="opacity: 0.7; margin: 10px 0;">${type === 'incoming' ? (this.lang === 'ar' ? 'مكالمة واردة...' : 'Incoming Call...') : (this.lang === 'ar' ? 'يرن...' : 'Ringing...')}</div>
                <div id="call-timer" class="hidden" style="font-family: monospace; font-size: 18px; margin-top: 10px;">00:00</div>
            </div>
            <audio id="remote-audio" autoplay playsinline></audio>
            <div style="display: flex; gap: 40px;">
                ${type === 'incoming' ? `<button id="answer-btn" onclick="app.answerCall()" style="width: 64px; height: 64px; border-radius: 50%; background: #10b981; border: none; color: white; cursor: pointer; display: flex; align-items: center; justify-content: center;"><i data-lucide="phone"></i></button>` : ''}
                <button onclick="app.endCall()" style="width: 64px; height: 64px; border-radius: 50%; background: #ef4444; border: none; color: white; cursor: pointer; display: flex; align-items: center; justify-content: center;"><i data-lucide="phone-off"></i></button>
            </div>
        `;
        document.body.appendChild(overlay); lucide.createIcons();
    }

    startCallTimer() {
        const timerEl = document.getElementById('call-timer');
        if (!timerEl) return;
        timerEl.classList.remove('hidden');
        let sec = 0;
        this.callInterval = setInterval(() => {
            sec++;
            const m = Math.floor(sec / 60).toString().padStart(2, '0');
            const s = (sec % 60).toString().padStart(2, '0');
            timerEl.innerText = `${m}:${s}`;
        }, 1000);
    }

    async endCall() {
        if (this.activeCallId) {
            await updateDoc(doc(db, 'calls', this.activeCallId), { status: 'ended' });
        }
        this.cleanupCall();
    }

    cleanupCall() {
        if (this.callInterval) clearInterval(this.callInterval);
        if (this.pc) { this.pc.close(); this.pc = null; }
        if (this.localStream) { this.localStream.getTracks().forEach(t => t.stop()); this.localStream = null; }
        if (this.callListener) { this.callListener(); this.callListener = null; }
        document.getElementById('call-overlay')?.remove();
        this.activeCallId = null;
    }

    // --- Elegant Glassmorphism Dialog System ---
    showAlert(title, message) {
        this.showDialog({ title, message, type: 'alert' });
    }

    showConfirm(title, message, onConfirm) {
        this.showDialog({ title, message, type: 'confirm', onConfirm });
    }

    showPrompt(title, message, defaultValue, onConfirm) {
        this.showDialog({ title, message, type: 'prompt', defaultValue, onConfirm });
    }

    showDialog({ title, message, type, defaultValue = '', onConfirm = null }) {
        const overlay = document.createElement('div');
        overlay.className = 'dialog-overlay';

        let icon = 'info';
        if (type === 'confirm') icon = 'help-circle';
        if (type === 'prompt') icon = 'edit-3';

        const isRTL = this.lang === 'ar';
        const okText = isRTL ? 'موافق' : 'Confirm';
        const cancelText = isRTL ? 'إلغاء' : 'Cancel';

        overlay.innerHTML = `
            <div class="dialog-card">
                <div class="dialog-icon"><i data-lucide="${icon}"></i></div>
                <h2>${title}</h2>
                <p>${message}</p>
                ${type === 'prompt' ? `<input type="text" id="dialog-input" class="dialog-input" value="${defaultValue}" autocomplete="off">` : ''}
                <div class="dialog-actions">
                    ${type !== 'alert' ? `<button class="dialog-btn secondary" id="dialog-cancel">${cancelText}</button>` : ''}
                    <button class="dialog-btn primary" id="dialog-confirm">${okText}</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        lucide.createIcons({ node: overlay });

        // Trigger animation
        setTimeout(() => overlay.classList.add('active'), 10);

        const input = overlay.querySelector('#dialog-input');
        if (input) {
            setTimeout(() => input.focus(), 100);
            input.onkeydown = (e) => {
                if (e.key === 'Enter') overlay.querySelector('#dialog-confirm').click();
            };
        }

        const close = () => {
            overlay.classList.remove('active');
            setTimeout(() => overlay.remove(), 300);
        };

        overlay.querySelector('#dialog-confirm').onclick = () => {
            const val = input ? input.value : true;
            close();
            if (onConfirm) onConfirm(val);
        };

        const cancelBtn = overlay.querySelector('#dialog-cancel');
        if (cancelBtn) cancelBtn.onclick = close;

        // Prevent background clicks from closing to avoid accidental dismissal
    }

    // --- Modern Features Expansion ---

    async addReaction(chatId, msgId, emoji) {
        this.closeMsgOptionsPopup();
        const msgRef = doc(db, `chats/${chatId}/messages`, msgId);
        const updateObj = {};
        updateObj[`reactions.${this.user.uid}`] = emoji;
        await updateDoc(msgRef, updateObj);
        if (navigator.vibrate) navigator.vibrate(20);
    }

    showReactionDetails(chatId, msgId) {
        const msg = this.currentMessages[msgId];
        if (!msg || !msg.reactions) return;

        const chat = this.allChats.find(c => c.id === chatId);
        const reactions = Object.entries(msg.reactions);

        let html = `
            <div style="padding: 20px;">
                <h3 style="margin: 0 0 20px; font-size: 18px; font-weight: 700;">Reactions</h3>
                <div style="display: flex; flex-direction: column; gap: 12px; max-height: 300px; overflow-y: auto;">
                    ${reactions.map(([uid, emoji]) => {
            const member = chat.memberData[uid] || { name: 'Unknown User', photo: 'assets/logo.jpg' };
            return `
                            <div style="display: flex; align-items: center; gap: 12px; padding: 8px; background: var(--glass-panel); border-radius: 12px;">
                                <img src="${member.photo}" style="width: 36px; height: 36px; border-radius: 50%; object-fit: cover;">
                                <div style="flex: 1; font-weight: 600;">${member.name}</div>
                                <div style="font-size: 20px;">${emoji}</div>
                            </div>
                        `;
        }).join('')}
                </div>
            </div>
        `;

        this.showModal(html);
    }

    // --- App Lock System ---
    showLockScreen() {
        this.isLocked = true;
        this.currentPinInput = "";
        const overlay = document.getElementById('app-lock-overlay');
        overlay.classList.remove('hidden');
        this.updatePinDots();
        lucide.createIcons({ node: overlay });
    }

    handlePinInput(digit) {
        if (this.currentPinInput.length < 4) {
            this.currentPinInput += digit;
            this.updatePinDots();
            if (navigator.vibrate) navigator.vibrate(10);
            
            if (this.currentPinInput.length === 4) {
                setTimeout(() => this.verifyPin(), 200);
            }
        }
    }

    clearPin() {
        this.currentPinInput = "";
        this.updatePinDots();
    }

    updatePinDots() {
        const dots = document.querySelectorAll('.pin-dot');
        dots.forEach((dot, i) => {
            dot.classList.toggle('active', i < this.currentPinInput.length);
        });
    }

    verifyPin() {
        if (this.currentPinInput === this.userData?.appLockPin) {
            this.unlockApp();
        } else {
            if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
            this.currentPinInput = "";
            this.updatePinDots();
            const title = document.getElementById('lock-title');
            title.innerText = this.lang === 'ar' ? 'رمز خاطئ!' : 'Incorrect PIN!';
            title.style.color = '#ef4444';
            setTimeout(() => {
                title.innerText = this.lang === 'ar' ? 'هامستر مقفول' : 'Hamster Locked';
                title.style.color = 'white';
            }, 1000);
        }
    }

    unlockApp() {
        this.isLocked = false;
        this.isUnlockedSession = true; // Stay unlocked this session
        document.getElementById('app-lock-overlay').classList.add('hidden');
    }

    async toggleAppLock() {
        if (this.userData?.appLockPin) {
            this.showConfirm(
                this.lang === 'ar' ? 'إلغاء قفل التطبيق' : 'Disable App Lock',
                this.lang === 'ar' ? 'هل أنت متأكد من رغبتك في إلغاء قفل التطبيق؟' : 'Are you sure you want to disable the app lock?',
                async () => {
                    await updateDoc(doc(db, 'users', this.user.uid), { appLockPin: null });
                    this.userData.appLockPin = null;
                    localStorage.removeItem('hamster-lock-pin');
                    this.renderSettingsPage();
                }
            );
        } else {
            this.showPrompt(
                this.lang === 'ar' ? 'تعيين رمز قفل' : 'Set App Lock PIN',
                this.lang === 'ar' ? 'أدخل رمزاً من 4 أرقام:' : 'Enter a 4-digit PIN:',
                '',
                async (pin) => {
                    if (pin && /^\d{4}$/.test(pin)) {
                        await updateDoc(doc(db, 'users', this.user.uid), { appLockPin: pin });
                        this.userData.appLockPin = pin;
                        localStorage.setItem('hamster-lock-pin', pin);
                        this.renderSettingsPage();
                    } else {
                        this.showAlert(this.lang === 'ar' ? 'خطأ' : 'Invalid PIN', this.lang === 'ar' ? 'يجب أن يكون الرمز 4 أرقام فقط.' : 'PIN must be exactly 4 digits.');
                    }
                }
            );
        }
    }

    // --- Wallpaper System ---
    loadWallpaper() {
        const saved = localStorage.getItem('hamster-wallpaper');
        if (saved) {
            if (!this.userData) this.userData = {};
            this.userData.wallpaper = saved;
        }
    }

    loadLock() {
        const saved = localStorage.getItem('hamster-lock-pin');
        if (saved) {
            if (!this.userData) this.userData = {};
            this.userData.appLockPin = saved;
        }
    }

    async setWallpaper(url) {
        if (!this.userData) this.userData = {};
        this.userData.wallpaper = url;
        localStorage.setItem('hamster-wallpaper', url);
        await updateDoc(doc(db, 'users', this.user.uid), { wallpaper: url });
        
        const area = document.getElementById('messages-area');
        if (area) {
            area.style.backgroundImage = url ? `url(${url})` : 'none';
        }
        
        this.renderSettingsPage();
    }

    handleWallpaperUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = async () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                // Max resolution for wallpaper
                const maxWidth = 1280;
                let w = img.width;
                let h = img.height;
                if (w > maxWidth) {
                    h = (maxWidth / w) * h;
                    w = maxWidth;
                }
                
                canvas.width = w;
                canvas.height = h;
                ctx.drawImage(img, 0, 0, w, h);
                const dataURL = canvas.toDataURL('image/jpeg', 0.8);
                this.setWallpaper(dataURL);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    // --- Privacy Helpers ---
    async togglePrivacy(key) {
        const newState = !this.userData?.privacy?.[key];
        const updateObj = {};
        updateObj[`privacy.${key}`] = newState;
        await updateDoc(doc(db, 'users', this.user.uid), updateObj);
        this.userData.privacy = { ...(this.userData.privacy || {}), [key]: newState };
        this.renderSettingsPage();
    }

    // Re-rendering settings with new options
    renderSettingsPage() {
        const container = document.getElementById('page-content');
        container.classList.remove('hidden');
        document.getElementById('chat-window').classList.add('hidden');
        document.getElementById('empty-state').classList.add('hidden');

        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const showLastSeen = this.userData?.privacy?.showLastSeen !== false;
        const appLockEnabled = !!this.userData?.appLockPin;

        container.innerHTML = `
            <div class="page-container" style="max-height: 100%; overflow-y: auto; padding-bottom: 40px;">
                <div style="display: flex; align-items: center; gap: 16px; margin-bottom: 32px;">
                    <button class="mobile-back-btn" onclick="app.handleNavigation('chats')"><i data-lucide="chevron-left"></i></button>
                    <h1 style="margin: 0; font-size: 28px; font-weight: 700; color: var(--text-primary);">${this.t('settings')}</h1>
                </div>

                <div class="form-group">
                    <label>${this.t('language')}</label>
                    <select id="lang-sel" onchange="app.setLang(this.value)">
                        <option value="en" ${this.lang === 'en' ? 'selected' : ''}>English</option>
                        <option value="ar" ${this.lang === 'ar' ? 'selected' : ''}>العربية</option>
                    </select>
                </div>

                <div class="form-group">
                    <label>${this.t('app_theme')}</label>
                    <select id="theme-sel" onchange="app.setTheme(this.value)">
                        <option value="light" ${currentTheme === 'light' ? 'selected' : ''}>${this.t('light_mode')}</option>
                        <option value="dark" ${currentTheme === 'dark' ? 'selected' : ''}>${this.t('dark_mode')}</option>
                    </select>
                </div>

                <h3 style="font-size: 14px; text-transform: uppercase; color: var(--text-muted); margin: 24px 0 12px; letter-spacing: 0.5px;">Privacy & Security</h3>
                
                <div class="privacy-item">
                    <div class="privacy-info">
                        <h4>${this.lang === 'ar' ? 'قفل التطبيق' : 'App Lock'}</h4>
                        <p>${this.lang === 'ar' ? 'حماية التطبيق برمز PIN' : 'Require PIN to open Hamster Chat'}</p>
                    </div>
                    <div class="toggle-switch ${appLockEnabled ? 'active' : ''}" onclick="app.toggleAppLock()"></div>
                </div>

                <div class="privacy-item">
                    <div class="privacy-info">
                        <h4>${this.lang === 'ar' ? 'آخر ظهور' : 'Last Seen'}</h4>
                        <p>${this.lang === 'ar' ? 'إظهار وقت تواجدك للآخرين' : 'Share when you were last online'}</p>
                    </div>
                    <div class="toggle-switch ${showLastSeen ? 'active' : ''}" onclick="app.togglePrivacy('showLastSeen')"></div>
                </div>

                <h3 style="font-size: 14px; text-transform: uppercase; color: var(--text-muted); margin: 24px 0 12px; letter-spacing: 0.5px;">Chat Customization</h3>
                
                <div class="privacy-item" style="border: none;">
                    <div class="privacy-info">
                        <h4>${this.lang === 'ar' ? 'خلفية المحادثة' : 'Chat Wallpaper'}</h4>
                        <p>${this.lang === 'ar' ? 'اختر صورة من جهازك كخلفية للمحادثات' : 'Set a custom image from your device'}</p>
                    </div>
                    <label class="glass-btn" style="padding: 8px 16px; font-size: 13px; border-radius: 10px; cursor: pointer;">
                        <i data-lucide="image" style="width:16px; margin-right: 6px;"></i>
                        ${this.lang === 'ar' ? 'رفع صورة' : 'Upload'}
                        <input type="file" accept="image/*" style="display: none;" onchange="app.handleWallpaperUpload(event)">
                    </label>
                </div>

                ${this.userData?.wallpaper ? `
                <div style="margin-top: 12px; position: relative; width: 100%; height: 120px; border-radius: 16px; overflow: hidden; border: 1px solid var(--glass-border);">
                    <img src="${this.userData.wallpaper}" style="width: 100%; height: 100%; object-fit: cover; opacity: 0.6;">
                    <button onclick="app.setWallpaper('')" style="position: absolute; top: 10px; right: 10px; background: rgba(239, 68, 68, 0.2); color: #ef4444; border: none; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center;"><i data-lucide="trash-2" style="width:16px;"></i></button>
                    <div style="position: absolute; bottom: 10px; left: 15px; color: var(--text-primary); font-size: 12px; font-weight: 600;">Current Wallpaper</div>
                </div>
                ` : ''}

                <hr style="margin: 32px 0; border: none; border-top: 1px solid var(--glass-border);">

                <button class="glass-btn" style="width: 100%; border-radius: 12px; padding: 14px; font-size: 15px;" onclick="app.showAlert(app.lang === 'ar' ? 'تم الحفظ' : 'Preferences Saved', app.lang === 'ar' ? 'تم حفظ التفضيلات بنجاح.' : 'Settings updated successfully.')">${this.t('commit')}</button>
            </div>
        `;
        lucide.createIcons();
    }

    formatLastSeen(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const oneDay = 24 * 60 * 60 * 1000;

        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });

        // Zero out the hours for day comparison
        const dDate = new Date(date).setHours(0,0,0,0);
        const dNow = new Date(now).setHours(0,0,0,0);
        const dDiff = Math.floor((dNow - dDate) / oneDay);

        if (dDiff === 0) {
            return (this.lang === 'ar' ? 'نشط منذ ' : 'Last seen ') + timeStr;
        } else if (dDiff === 1) {
            return (this.lang === 'ar' ? 'نشط أمس ' : 'Last seen yesterday ') + timeStr;
        } else if (dDiff < 7) {
            return (this.lang === 'ar' ? `نشط منذ ${dDiff} أيام ` : `Last seen ${dDiff} days ago `) + timeStr;
        } else {
            const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
            return (this.lang === 'ar' ? 'نشط في ' : 'Last seen on ') + dateStr + ' ' + timeStr;
        }
    }

    // --- PWA Installation Logic ---
    checkInstallPrompt() {
        const isDismissed = localStorage.getItem('hamster-install-dismissed');
        if (isDismissed || !this.deferredPrompt) return;

        const prompt = document.getElementById('install-prompt');
        if (prompt) {
            // Update localization
            const title = document.getElementById('prompt-title');
            const desc = document.getElementById('prompt-desc');
            const btns = document.querySelectorAll('#install-prompt button');

            if (this.lang === 'ar') {
                title.innerText = "تحميل تطبيق هامستر";
                desc.innerText = "ثبّت التطبيق لتجربة اتصال أفضل";
                btns[0].innerText = "لاحقاً";
                btns[1].innerText = "تنزيل الآن";
            }

            setTimeout(() => prompt.classList.add('visible'), 2000);
        }
    }

    async installApp() {
        if (!this.deferredPrompt) return;
        this.deferredPrompt.prompt();
        const { outcome } = await this.deferredPrompt.userChoice;
        if (outcome === 'accepted') {
            console.log('Hamster: User accepted install');
            this.dismissInstall();
        }
        this.deferredPrompt = null;
    }

    dismissInstall() {
        const prompt = document.getElementById('install-prompt');
        if (prompt) prompt.classList.remove('visible');
        localStorage.setItem('hamster-install-dismissed', 'true');
    }

    showGroupQR(chatId) {
        const chat = this.allChats.find(c => c.id === chatId);
        if (!chat) return;
        const joinLink = `${window.location.origin}${window.location.pathname}?joinGroup=${chatId}`;
        const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(joinLink)}`;
        this.showModal(`
            <div class="qr-modal-content">
                <h3 style="margin-bottom: 8px;">${chat.name}</h3>
                <p style="font-size: 14px; color: var(--text-secondary);">${this.lang === 'ar' ? 'سكان لمشاركة المجموعة' : 'Scan to share group'}</p>
                <img src="${qrUrl}" class="qr-code-img">
                <div style="font-size: 11px; color: var(--text-muted); line-height: 1.6; background: var(--app-bg); padding: 12px; border-radius: 12px; word-break: break-all; margin-top: 10px;">
                    ${joinLink}
                </div>
                <button class="glass-btn" style="width: 100%; margin-top: 20px;" onclick="app.closeModal()">${this.t('dismiss')}</button>
            </div>
        `);
    }

    async handleGroupJoinLink(chatId) {
        window.history.replaceState({}, document.title, window.location.pathname);
        const join = async () => {
            const chatRef = doc(db, 'chats', chatId);
            const snap = await getDoc(chatRef);
            if (!snap.exists()) return;
            const data = snap.data();
            if (!data.memberIds.includes(this.user.uid)) {
                await updateDoc(chatRef, { memberIds: arrayUnion(this.user.uid) });
            }
            this.selectChat(chatId);
        };
        if (this.user) { join(); } else {
            const int = setInterval(() => {
                if (this.user) { clearInterval(int); join(); }
            }, 1000);
        }
    }
}

// Global Execution
const app = new HamsterApp();
window.app = app;
