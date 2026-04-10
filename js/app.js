import {
    auth, db, googleProvider,
    onAuthStateChanged, signInWithPopup, signOut,
    collection, onSnapshot, query, orderBy, where, doc, getDoc, setDoc, serverTimestamp, getDocs, writeBatch, addDoc, updateDoc, deleteDoc, limit, arrayUnion, arrayRemove
} from './firebase-config.js';

import { extendAuth } from './auth.js';
import { extendCalls } from './calls.js';
import { extendAI } from './ai.js';
import { extendStories } from './stories.js';
import { extendUI } from './ui.js';
import { extendSettings } from './settings.js';
import { extendAdmin } from './admin.js';
import { extendMedia } from './media.js';
import { extendE2E } from './E2E.js';

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

        // --- Agora RTC ---
        this.agoraAppId = "a32681136c9e4af6a429b8cb9b96cd98"; // User should set this in the file
        this.agoraClient = null;
        this.localAudioTrack = null;
        this.localVideoTrack = null;
        this.isVideoCall = false;
        this.activeCallListener = null;
        this.currentCallData = null;

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

        // Global Protection: Prevent right-click downloading on all images
        document.addEventListener('contextmenu', (e) => {
            if (e.target.tagName === 'IMG') e.preventDefault();
        }, false);

        // Global click listener to close dropdowns
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#attachment-menu') && this.closeAttachmentMenu) {
                this.closeAttachmentMenu();
            }
        });
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

    // Note: Online status moved to ui.js


    // Note: Image methods moved to media.js

    // Note: Localization methods moved to ui.js

    updateStaticUI() {
        const search = document.getElementById('global-search');
        if (search) search.placeholder = this.t('search');
    }

    // Note: Theme methods moved to ui.js


    // Note: Auth methods moved to auth.js

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

        onSnapshot(q, async (snapshot) => {
            let docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            // Async decrypt last message for sidebar preview
            docs = await Promise.all(docs.map(async chat => {
                if (chat.lastMessage && chat.lastMessage.isE2E) {
                    try {
                        const decrypted = await this.decryptMessagePayload(chat.lastMessage);
                        if (decrypted.decrypted) {
                            let previewText = "";
                            if (decrypted.image) {
                                previewText = this.lang === 'ar' ? '📷 صورة' : '📷 Image';
                            } else if (decrypted.audio) {
                                previewText = this.lang === 'ar' ? '🎤 تسجيل صوتي' : '🎤 Voice Message';
                            } else if (decrypted.gifUrl) {
                                previewText = 'GIF';
                            } else {
                                previewText = decrypted.text || chat.lastMessage.text;
                            }
                            chat.lastMessage.text = previewText;
                        }
                    } catch(e) { }
                }
                return chat;
            }));

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
                        'hamster_ai_bot': { name: 'Hamster AI', photo: 'assets/logo.jpg' }
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

            const typingUsers = Object.keys(chat.typing || {}).filter(uid => uid !== this.user.uid && chat.typing[uid] === true);
            const isTyping = typingUsers.length > 0;
            const lastMsg = isTyping ? (this.lang === 'ar' ? 'يكتب الآن...' : 'Typing...') : (chat.lastMessage?.text || "Started conversation");

            const unreadCount = chat.unreadCounts?.[this.user.uid] || 0;
            const badgeHTML = unreadCount > 0 && chat.id !== this.activeChatId ? `<div class="unread-badge">${unreadCount > 99 ? '+99' : unreadCount}</div>` : '';

            return `
                <div class="chat-card ${active}" onclick="app.selectChat('${chat.id}')">
                    <img src="${partner.photo || 'https://i.pravatar.cc/150'}" class="card-avatar">
                    <div class="card-body">
                        <div class="card-top">
                            <h4 style="display: flex; justify-content: space-between; align-items: center; width: 100%;">${partner.name} ${badgeHTML}</h4>
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
            type: 'direct',
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

        // Reset unread count
        if (chat.unreadCounts && chat.unreadCounts[this.user.uid] > 0) {
            chat.unreadCounts[this.user.uid] = 0;
            updateDoc(doc(db, 'chats', chatId), {
                [`unreadCounts.${this.user.uid}`]: 0
            }).catch(e => console.error("Reset unread error", e));
        }

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

        const isAI = chatId === this.user.uid + '_ai';

        let inputAreaHTML = `
            <div class="input-area">
                <div style="display: flex; flex-direction: column; gap: 8px; position: relative;" id="input-area-inner">
                    <div id="reply-to-placeholder"></div>
                    <div id="gif-picker-container" class="hidden" style="background: var(--glass-panel-solid); border: 1px solid var(--glass-border); border-radius: 12px; padding: 10px; max-height: 250px; overflow-y: auto; position: absolute; bottom: calc(100% + 10px); left: 0; right: 0; z-index: 100;">
                        <input type="text" id="gif-search" placeholder="${this.lang === 'ar' ? 'بحث عن ملصقات...' : 'Search stickers...'}" style="width: 100%; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--border); background: var(--glass-bg); color: var(--text-primary); margin-bottom: 10px;" oninput="app.searchGiphy(this.value, '${chatId}')">
                        <div id="gif-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: 8px;"></div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <form id="msg-form" class="input-container" style="flex: 1;">
                            <input type="text" id="msg-input" placeholder="${this.t('msg_placeholder')}" autocomplete="off" oninput="app.handleTyping('${chatId}')">
                            ${!isAI ? `
                            <div style="position: relative; display: flex; align-items: center;">
                                <button type="button" onclick="app.toggleAttachmentMenu(event)" style="background: none; border: none; color: var(--text-secondary); flex-shrink: 0; display: flex; align-items: center; justify-content: center; cursor: pointer; margin-right: 4px;" title="Attach">
                                    <i data-lucide="paperclip" style="width: 20px;"></i>
                                </button>
                                <div id="attachment-menu" class="hidden" style="position: absolute; bottom: 44px; right: 0; background: var(--glass-panel-solid); border: 1px solid var(--glass-border); border-radius: 12px; padding: 8px; box-shadow: var(--shadow-md); z-index: 101; display: flex; flex-direction: column; gap: 4px; min-width: 140px; backdrop-filter: blur(16px);" onclick="event.stopPropagation()">
                                    <label class="attachment-btn">
                                        <i data-lucide="image" style="width: 18px; color: #3b82f6;"></i>
                                        <span>${this.lang === 'ar' ? 'إرسال صورة' : 'Send Image'}</span>
                                        <input type="file" accept="image/*" style="display: none;" onchange="app.handleChatImageUpload(event, '${chatId}'); app.closeAttachmentMenu();">
                                    </label>
                                    <button type="button" class="attachment-btn" onclick="app.toggleGifPicker('${chatId}'); app.closeAttachmentMenu();">
                                        <i data-lucide="smile" style="width: 18px; color: #f59e0b;"></i>
                                        <span>${this.lang === 'ar' ? 'تحديد ملصق' : 'Send Sticker'}</span>
                                    </button>
                                    ${chat.type === 'group' ? `
                                    <button type="button" class="attachment-btn" onclick="app.showPollModal('${chatId}'); app.closeAttachmentMenu();">
                                        <i data-lucide="bar-chart-2" style="width: 18px; color: #10b981;"></i>
                                        <span>${this.lang === 'ar' ? 'استطلاع رأي' : 'Create Poll'}</span>
                                    </button>
                                    ` : ''}
                                </div>
                            </div>
                            <button type="button" id="voice-btn" style="background: none; border: none; color: var(--text-secondary); flex-shrink: 0; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: 50%; cursor: pointer;" onmousedown="app.startRecording()" onmouseup="app.stopRecording()" ontouchstart="app.startRecording()" ontouchend="app.stopRecording()">
                                <i data-lucide="mic" style="width: 20px;"></i>
                            </button>
                            ` : ''}
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
        } else if (isAI) {
            const maintenanceMsg = this.lang === 'ar' ? 'هامستر في استراحة قصيرة للصيانة.. سنعود قريباً! 🐹🛠️' : 'Hamster is on a short maintenance break.. back soon! 🐹🛠️';
            inputAreaHTML = `
                <div class="input-area" style="justify-content: center; opacity: 0.9;">
                    <div style="display: flex; align-items: center; gap: 10px; color: var(--accent); font-size: 14px; background: var(--glass-panel); border: 1px solid var(--glass-border); padding: 14px 28px; border-radius: 16px; font-weight: 600; box-shadow: var(--shadow-sm);">
                        <i data-lucide="wrench" style="width: 18px;"></i>
                        ${maintenanceMsg}
                    </div>
                </div>
            `;
        }

        const typingUsers = Object.keys(chat.typing || {}).filter(uid => uid !== this.user.uid && chat.typing[uid] === true);
        const isTyping = typingUsers.length > 0;
        const statusText = isTyping ? (this.lang === 'ar' ? 'يكتب الآن...' : 'Typing...') : (chat.type === 'group' ? 'Group Space' : (partner.status === 'online' ? (this.lang === 'ar' ? 'متصل الآن' : 'Online') : ''));

        chatWindow.innerHTML = `
            <header class="chat-header">
                <div style="display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0; ${isAI ? '' : 'cursor: pointer;'}" ${isAI ? '' : `onclick="app.renderChatInfo('${chatId}')"`}>
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
                    ${!isAI ? `
                    <div style="position: relative;" id="call-dropdown-wrap">
                        <button class="nav-item" onclick="app.toggleCallDropdown()" title="Call"><i data-lucide="phone"></i><i data-lucide="chevron-down" style="width: 12px; height: 12px; margin-left: -2px;"></i></button>
                        <div id="call-dropdown" class="hidden" style="position: absolute; top: 100%; right: 0; min-width: 180px; background: var(--glass-panel-solid); border: 1px solid var(--glass-border); border-radius: 14px; box-shadow: var(--shadow-lg); z-index: 999; overflow: hidden; padding: 6px;">
                            <button onclick="app.startCall('${chat.id}', 'audio'); app.toggleCallDropdown()" style="width: 100%; padding: 12px 16px; border: none; background: none; color: var(--text-primary); display: flex; align-items: center; gap: 12px; cursor: pointer; border-radius: 10px; font-size: 14px; font-weight: 500; font-family: inherit;" onmouseover="this.style.background='var(--hover-bg)'" onmouseout="this.style.background='none'">
                                <i data-lucide="phone" style="width: 18px; color: var(--accent);"></i>
                                ${this.lang === 'ar' ? 'مكالمة صوتية' : 'Voice Call'}
                            </button>
                            <button onclick="app.startCall('${chat.id}', 'video'); app.toggleCallDropdown()" style="width: 100%; padding: 12px 16px; border: none; background: none; color: var(--text-primary); display: flex; align-items: center; gap: 12px; cursor: pointer; border-radius: 10px; font-size: 14px; font-weight: 500; font-family: inherit;" onmouseover="this.style.background='var(--hover-bg)'" onmouseout="this.style.background='none'">
                                <i data-lucide="video" style="width: 18px; color: #10b981;"></i>
                                ${this.lang === 'ar' ? 'مكالمة فيديو' : 'Video Call'}
                            </button>
                        </div>
                    </div>
                    <button class="nav-item" onclick="app.toggleChatSearch()" title="Search in Chat"><i data-lucide="search"></i></button>
                    <button class="nav-item" onclick="app.renderChatInfo('${chat.id}')"><i data-lucide="more-vertical"></i></button>
                    ` : ''}
                </div>
            </header>
            <div id="chat-search-container" class="hidden">
                <div class="chat-search-bar">
                    <i data-lucide="search" style="width: 18px; color: var(--accent);"></i>
                    <input type="text" class="chat-search-input" placeholder="${this.lang === 'ar' ? 'بحث في الرسائل...' : 'Search messages...'}" oninput="app.filterChatMessages(this.value)">
                    <button onclick="app.toggleChatSearch()" style="background:none; border:none; color: var(--text-muted); cursor:pointer; display: flex; align-items: center;"><i data-lucide="x" style="width: 18px;"></i></button>
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

        // Ctrl+V Paste Image Support
        const msgInput = document.getElementById('msg-input');
        if (msgInput) {
            msgInput.addEventListener('paste', (e) => {
                const items = e.clipboardData?.items;
                if (!items) return;
                for (const item of items) {
                    if (item.type.startsWith('image/')) {
                        e.preventDefault();
                        const file = item.getAsFile();
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                            this.showPasteImagePreview(ev.target.result, chatId);
                        };
                        reader.readAsDataURL(file);
                        break;
                    }
                }
            });
        }
    }

    showPasteImagePreview(dataURL, chatId) {
        document.getElementById('paste-preview-modal')?.remove();

        const modal = document.createElement('div');
        modal.id = 'paste-preview-modal';
        modal.style.cssText = `
            position: fixed; inset: 0; z-index: 10000;
            background: rgba(0,0,0,0.7);
            backdrop-filter: blur(8px);
            display: flex; align-items: center; justify-content: center;
        `;
        modal.innerHTML = `
            <div style="background: var(--glass-panel-solid); border: 1px solid var(--glass-border); border-radius: 20px; padding: 20px; max-width: 90vw; display: flex; flex-direction: column; align-items: center; gap: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.4);">
                <h3 style="margin: 0; font-size: 16px; font-weight: 600; color: var(--text-primary);">
                    ${this.lang === 'ar' ? 'إرسال الصورة؟' : 'Send this image?'}
                </h3>
                <img src="${dataURL}" style="max-width: 100%; max-height: 50vh; border-radius: 12px; object-fit: contain; box-shadow: 0 8px 24px rgba(0,0,0,0.2);">
                <div style="display: flex; gap: 12px; width: 100%;">
                    <button onclick="document.getElementById('paste-preview-modal').remove()"
                        style="flex: 1; padding: 12px; border-radius: 12px; border: 1px solid var(--glass-border); background: var(--glass-panel); color: var(--text-primary); cursor: pointer; font-size: 14px; font-weight: 500;">
                        ${this.lang === 'ar' ? 'إلغاء' : 'Cancel'}
                    </button>
                    <button id="paste-send-btn"
                        style="flex: 1; padding: 12px; border-radius: 12px; border: none; background: linear-gradient(135deg, var(--accent), var(--accent-light)); color: white; cursor: pointer; font-size: 14px; font-weight: 600; box-shadow: 0 4px 12px rgba(109,40,217,0.35);">
                        ${this.lang === 'ar' ? 'إرسال' : 'Send'}
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        document.getElementById('paste-send-btn').onclick = async () => {
            modal.remove();
            await this.sendMessageWithMedia(chatId, dataURL);
        };

        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
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

    formatMessageContent(msg) {
        let text = msg.text || '';
        
        // Sanitize HTML slightly but allow some formatting
        text = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");

        // Linkify URLs
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        text = text.replace(urlRegex, '<a href="$1" target="_blank" style="color:var(--accent); text-decoration:underline;">$1</a>');

        // Simple Markdown: **bold**, *italic*, `code`
        text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        text = text.replace(/\*(.*?)\*/g, '<em>$1</em>');
        text = text.replace(/`(.*?)`/g, '<code style="background:rgba(0,0,0,0.05); padding:2px 4px; border-radius:4px; font-family:monospace;">$1</code>');

        // New lines to <br>
        text = text.replace(/\n/g, '<br>');

        return text;
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

        this.messagesUnsubscribe = onSnapshot(q, async (snapshot) => {
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

            // Async decryption
            const decryptedDocs = await Promise.all(docs.map(async docSnap => {
                let msg = docSnap.data();
                if (msg.isE2E) {
                    msg = await this.decryptMessagePayload(msg);
                }
                return { msgId: docSnap.id, msg };
            }));

            messagesHTML += decryptedDocs.map(({ msgId, msg }) => {
                this.currentMessages[msgId] = msg;

                // Handle System Messages
                if (msg.type === 'system') {
                    return `
                        <div style="display: flex; justify-content: center; width: 100%; margin: 16px 0;">
                            <span style="background: rgba(0,0,0,0.05); color: var(--text-muted); font-size: 11px; padding: 4px 12px; border-radius: 20px; font-weight: 500; letter-spacing: 0.5px; backdrop-filter: blur(4px); border: 1px solid var(--glass-border);">
                                ${msg.text}
                            </span>
                        </div>
                    `;
                }

                const isMine = msg.senderId === this.user.uid;

                // Mark as read if received and in active chat and window focused
                // GHOST MODE: Skip marking as read if user enabled ghostMode
                const ghostMode = !!this.userData?.privacy?.ghostMode;
                if (!isMine && msg.status !== 'read' && document.visibilityState === 'visible' && !ghostMode) {
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
                } else if (msg.gifUrl) {
                    contentStr = `<img src="${msg.gifUrl}" style="width: 200px; max-width: 100%; height: auto; display: block;">`;
                    extraBubbleClass = 'gif-bubble';
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
                } else if (msg.type === 'poll') {
                    const totalVotes = (msg.options || []).reduce((sum, opt) => sum + (opt.votes ? opt.votes.length : 0), 0);
                    
                    const optionsHTML = (msg.options || []).map((opt, idx) => {
                        const voteCount = opt.votes ? opt.votes.length : 0;
                        const percent = totalVotes > 0 ? (voteCount / totalVotes) * 100 : 0;
                        const hasVoted = opt.votes && opt.votes.includes(this.user.uid);
                        
                        return `
                            <div class="poll-option ${hasVoted ? 'voted' : ''}" onclick="app.voteInPoll('${chatId}', '${msgId}', ${idx}); event.stopPropagation();">
                                <div class="poll-bar" style="width: ${percent}%;"></div>
                                <div class="poll-option-content">
                                    <span style="display: flex; align-items: center; gap: 6px;">
                                        ${hasVoted ? '✓ ' : ''}${opt.text}
                                    </span>
                                    <span class="poll-count">${voteCount}</span>
                                </div>
                            </div>
                        `;
                    }).join('');
                    
                    contentStr = `
                        <div class="poll-container">
                            <h4 class="poll-question">${msg.question}</h4>
                            <div class="poll-options-list">
                                ${optionsHTML}
                            </div>
                            <div class="poll-footer">
                                <span>${totalVotes} ${this.lang === 'ar' ? 'تصويت' : 'votes'}</span>
                            </div>
                        </div>
                    `;
                    extraBubbleClass = 'poll-bubble';
                } else {
                    contentStr = this.formatMessageContent(msg);
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
                        ontouchend="app.onMsgTouchEnd(event, '${chatId}', '${msgId}')"
                        ontouchmove="app.onMsgTouchMove(event, '${chatId}', '${msgId}')"
                        onmouseup="app.onMsgMouseUp(event)"
                        onmouseleave="app.onMsgMouseUp(event)">
                        <div style="display: flex; flex-direction: column; width: 100%;">
                            ${senderLabel}
                            <div class="bubble-content ${extraBubbleClass}">
                                ${replyHTML}
                                <div class="bubble-text" dir="auto">
                                    ${contentStr}
                                </div>
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

            let preE2E = { image: imageData };
            let e2eData = preE2E;
            if (chat.type !== 'ai') {
                e2eData = await this.encryptMessagePayload(chat, preE2E);
            }

            const payload = {
                chatId, senderId: this.user.uid, createdAt: serverTimestamp(), status: 'sent',
                ...e2eData
            };

            if (this.replyToMsgId) {
                payload.replyTo = this.replyToMsgId;
            }

            batch.set(msgRef, payload);

            let displayLastMsg = this.lang === 'ar' ? '🔒 وسائط مشفرة' : '🔒 Encrypted Media';
            batch.set(doc(db, 'chats', chatId), {
                lastMessage: { text: displayLastMsg, senderId: this.user.uid, msgId: msgRef.id, ...e2eData },
                ...this.getUnreadCountsUpdate(chat),
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
        if (!text && !this.replyToMsgId) return;

        if (chatId === this.user.uid + '_ai') {
            this.handleAIMessage(chatId, text);
            return;
        }

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

            let preE2E = { text };
            if (linkPreview) preE2E.linkPreview = linkPreview;

            let e2eData = preE2E;
            if (chat.type !== 'ai') {
                e2eData = await this.encryptMessagePayload(chat, preE2E);
            }

            const payload = {
                chatId, senderId: this.user.uid, createdAt: serverTimestamp(), status: 'sent',
                ...e2eData
            };

            if (this.replyToMsgId) {
                payload.replyTo = this.replyToMsgId;
            }

            batch.set(msgRef, payload);

            let displayLastMsg = text;
            if (chat.type !== 'ai') {
                displayLastMsg = this.lang === 'ar' ? '🔒 رسالة مشفرة' : '🔒 Encrypted Message';
            }
            batch.set(doc(db, 'chats', chatId), {
                lastMessage: { text: displayLastMsg, senderId: this.user.uid, msgId: msgRef.id, ...e2eData },
                ...this.getUnreadCountsUpdate(chat),
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
            
            // 1. Setup initial doc with timestamp
            await setDoc(aiMsgRef, {
                chatId, text: '...', senderId: 'hamster_ai_bot', createdAt: serverTimestamp(), status: 'read'
            });

            // 2. Stream words to Firestore for a real typing effect
            const words = response.split(' ');
            let currentText = '';
            const chunkSize = words.length > 50 ? 3 : 1; // Faster for long texts

            for (let i = 0; i < words.length; i++) {
                currentText += (i === 0 ? '' : ' ') + words[i];
                
                // Update every chunk of words
                if (i % chunkSize === 0 || i === words.length - 1) {
                    await updateDoc(aiMsgRef, { text: currentText });
                    await new Promise(r => setTimeout(r, 80)); // 80ms delay per chunk
                }
            }
        } catch (e) {
            console.error(e);
            this.showAlert("Error", "Failed to connect to Hamster AI.");
        } finally {
            await setDoc(chatRef, { typing: { 'hamster_ai_bot': false } }, { merge: true });
        }
    }

    // Note: AI and formatting methods moved to ai.js

    linkify(text) {
        // Stop matching URLs at spaces OR HTML tags (<)
        const urlRegex = /(https?:\/\/[^\s<]+)/g;
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
        if (chatId === this.user.uid + '_ai') return;
        const chat = this.allChats.find(c => c.id === chatId);
        if (!chat) return;
        const partner = this.getChatPartner(chat);
        const chatWindow = document.getElementById('chat-window');

        const isArchived = chat.archivedBy && chat.archivedBy.includes(this.user.uid);
        const archiveIcon = isArchived ? 'package-open' : 'archive';
        const archiveText = isArchived ? (this.lang === 'ar' ? 'إلغاء الأرشفة' : 'Unarchive Chat') : (this.lang === 'ar' ? 'أرشفة المحادثة' : 'Archive Chat');


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
                        <img src="${partner.photo}" style="width: 150px; height: 150px; border-radius: 50%; object-fit: cover; box-shadow: var(--shadow-lg); border: 4px solid var(--glass-border); cursor: pointer;" onclick="app.viewImage('${partner.photo}', false)">
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
                        
                        <button class="glass-btn" style="width: 100%; justify-content: space-between; padding: 16px 20px; border-radius: 16px; background: var(--glass-panel); border: 1px solid var(--glass-border); color: var(--text-primary); transition: all 0.2s;" onclick="app.toggleArchive('${chatId}'); setTimeout(() => app.renderChatInfo('${chatId}'), 300)">
                            <div style="display: flex; align-items: center; gap: 12px;">
                                <i data-lucide="${archiveIcon}" style="color: var(--accent); width: 20px;"></i>
                                <span style="font-weight: 500;">${archiveText}</span>
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
                    <img src="${partner.photo}" style="width: 150px; height: 150px; border-radius: 50%; object-fit: cover; box-shadow: var(--shadow-lg); border: 4px solid var(--glass-border); cursor: pointer;" onclick="app.viewImage('${partner.photo}', false)">
                </div>
                <div style="text-align: center;">
                    <h2 style="font-size: 24px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">${partner.name}</h2>
                    ${partner.username ? `<p style="color: var(--accent); font-weight: 600; font-size: 14px;">@${partner.username}</p>` : ''}
                </div>
                
                <div style="width: 100%; max-width: 400px; display: flex; flex-direction: column; gap: 12px; margin-top: 20px;">
                    <button class="glass-btn" style="width: 100%; justify-content: space-between; padding: 16px 20px; border-radius: 16px; background: var(--glass-panel); border: 1px solid var(--glass-border); color: var(--text-primary); transition: all 0.2s;" onclick="app.toggleArchive('${chatId}'); setTimeout(() => app.renderChatInfo('${chatId}'), 300)">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <i data-lucide="${archiveIcon}" style="color: var(--accent); width: 20px;"></i>
                            <span style="font-weight: 500;">${archiveText}</span>
                        </div>
                        <i data-lucide="chevron-right" style="width: 16px; opacity: 0.5;"></i>
                    </button>

                    <button class="glass-btn" style="width: 100%; justify-content: space-between; padding: 16px 20px; border-radius: 16px; background: var(--glass-panel); border: 1px solid var(--glass-border); color: var(--text-primary); transition: all 0.2s;" onclick="app.toggleBlock('${chatId}')">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <i data-lucide="${isBlocked ? 'user-check' : 'user-x'}" style="color: #ef4444; width: 20px;"></i>
                            <span style="font-weight: 500;">${isBlocked ? (this.lang === 'ar' ? 'إلغاء الحظر' : 'Unblock Contact') : (this.lang === 'ar' ? 'حظر المستخدم' : 'Block Contact')}</span>
                        </div>
                        <i data-lucide="chevron-right" style="width: 16px; opacity: 0.5;"></i>
                    </button>
                    
                    <button class="glass-btn" style="width: 100%; justify-content: space-between; padding: 16px 20px; border-radius: 16px; background: var(--glass-panel); border: 1px solid var(--glass-border); color: var(--text-primary); transition: all 0.2s;" onclick="app.reportUser('${chatId}')">
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

    reportUser(chatId) {
        this.showPrompt(
            this.lang === 'ar' ? 'الإبلاغ عن إساءة' : 'Report Abuse',
            this.lang === 'ar' ? 'حدثنا عن المشكلة باختصار وسنقوم بمراجعة آخر 10 رسائل:' : 'Tell us the reason (we will review the last 10 messages):',
            '',
            async (reason) => {
                if (!reason || !reason.trim()) return;

                const btn = document.querySelector('.glass-btn[onclick^="app.reportUser"]');
                if(btn) btn.style.opacity = '0.5';

                try {
                    const q = query(
                        collection(db, `chats/${chatId}/messages`),
                        orderBy('createdAt', 'desc'),
                        limit(10)
                    );
                    const snap = await getDocs(q);
                    let messages = snap.docs.map(doc => doc.data()).reverse();

                    // E2E: Local Decryption for reporting (Voluntary Disclosure for Abuse Moderation)
                    messages = await Promise.all(messages.map(async m => {
                        if (m.isE2E) {
                            return await this.decryptMessagePayload(m);
                        }
                        return m;
                    }));

                    const chat = this.allChats.find(c => c.id === chatId);
                    const targetId = chat.type !== 'group' ? chat.memberIds.find(id => id !== this.user.uid) : chatId;

                    const reportPayload = {
                        reporterId: this.user.uid,
                        reporterName: this.userData.displayName,
                        targetId: targetId,
                        chatId: chatId,
                        chatType: chat.type || 'direct',
                        reason: reason.trim(),
                        status: 'pending',
                        messages: messages.map(m => ({
                            senderId: m.senderId,
                            text: m.text || (m.image ? '[صورة مشفرة]' : (m.audio ? '[صوت مشفر]' : (m.gifUrl ? '[ملصق مشفر]' : ''))),
                            createdAt: m.createdAt ? m.createdAt.toMillis() : Date.now()
                        })),
                        createdAt: serverTimestamp()
                    };

                    await addDoc(collection(db, 'reports'), reportPayload);
                    this.showAlert(this.lang === 'ar' ? 'تم استلام البلاغ' : 'Report Sent', this.lang === 'ar' ? 'شكراً لك. سيتم مراجعة بلاغك واتخاذ الإجراء اللازم.' : 'Your report has been sent to the admins for review.');
                    this.closeChatInfo();
                } catch (e) {
                    console.error("Report failed:", e);
                    this.showAlert(this.lang === 'ar' ? 'خطأ' : 'Error', this.lang === 'ar' ? 'حدث خطأ أثناء رفع البلاغ.' : 'Failed to submit report.');
                }
                
                if(btn) btn.style.opacity = '1';
            }
        );
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

    // --- Long Press & Swipe Gestures ---
    onMsgContextMenu(e, chatId, msgId) {
        e.preventDefault();
        this.showMsgOptions(e, chatId, msgId);
    }

    onMsgTouchStart(e, chatId, msgId) {
        this.msgTouchTarget = e.currentTarget;
        this.msgTouchStartX = e.touches[0].clientX;
        this.msgTouchStartY = e.touches[0].clientY;
        this.msgSwipeDx = 0;
        this.msgSwipeStarted = false;

        this._longPressTimer = setTimeout(() => {
            if (!this.msgSwipeStarted) {
                const touch = e.touches[0];
                const fakeEvent = { clientX: touch.clientX, clientY: touch.clientY, preventDefault: () => { } };
                this.showMsgOptions(fakeEvent, chatId, msgId);
                if (navigator.vibrate) navigator.vibrate(30);
            }
        }, 500);
    }

    onMsgTouchMove(e, chatId, msgId) {
        if (!this.msgTouchStartX || !this.msgTouchTarget) return;
        const dx = e.touches[0].clientX - this.msgTouchStartX;
        const dy = e.touches[0].clientY - this.msgTouchStartY;

        if (!this.msgSwipeStarted && Math.abs(dx) > 15 && Math.abs(dx) > Math.abs(dy)) {
            this.msgSwipeStarted = true;
            clearTimeout(this._longPressTimer);
        }

        if (this.msgSwipeStarted) {
            this.msgSwipeDx = dx;
            
            // Limit swipe visual representation
            let visualDx = this.lang === 'ar' ? dx : dx; 
            // In LTR, swipe left (negative) to reply. In RTL, swipe right (positive) to reply.
            if (this.lang === 'ar') {
                if (visualDx < 0) visualDx = 0;
                else if (visualDx > 60) visualDx = 60 + (visualDx - 60) * 0.2;
            } else {
                if (visualDx > 0) visualDx = 0;
                else if (visualDx < -60) visualDx = -60 + (visualDx + 60) * 0.2;
            }

            this.msgTouchTarget.style.transform = `translateX(${visualDx}px)`;
        } else if (Math.abs(dy) > 15) {
            clearTimeout(this._longPressTimer);
        }
    }

    onMsgTouchEnd(e, chatId, msgId) {
        clearTimeout(this._longPressTimer);
        if (this.msgSwipeStarted && this.msgTouchTarget) {
            const threshold = 50;
            if (Math.abs(this.msgSwipeDx) >= threshold) {
                if (navigator.vibrate) navigator.vibrate(15);
                this.prepareReply(chatId, msgId);
            }
            
            // Snap back
            this.msgTouchTarget.style.transition = 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
            this.msgTouchTarget.style.transform = 'translateX(0)';
            const target = this.msgTouchTarget;
            setTimeout(() => {
                if(target) {
                    target.style.transition = '';
                    target.style.transform = '';
                }
            }, 300);
        }
        
        this.msgTouchTarget = null;
        this.msgTouchStartX = null;
        this.msgSwipeStarted = false;
        this.msgSwipeDx = 0;
    }

    onMsgMouseDown(e, chatId, msgId) {
        if (e.button !== 0) return;
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
                    const chat = this.allChats.find(c => c.id === chatId);
                    
                    let updateData = { text, edited: true };
                    let sidebarUpdate = { 'lastMessage.text': text };

                    if (chat && chat.type !== 'ai') {
                        const e2eData = await this.encryptMessagePayload(chat, { text });
                        updateData = { 
                            ...e2eData, // This overwrites ciphertext, iv, keys
                            text: this.lang === 'ar' ? '🔒 رسالة مشفرة (بعد التعديل)' : '🔒 Encrypted (Edited)',
                            edited: true 
                        };
                        sidebarUpdate = { 
                            'lastMessage.text': this.lang === 'ar' ? '🔒 رسالة مشفرة' : '🔒 Encrypted Message',
                            ...Object.keys(e2eData).reduce((acc, k) => ({ ...acc, [`lastMessage.${k}`]: e2eData[k] }), {})
                        };
                    }

                    await updateDoc(doc(db, `chats/${chatId}/messages`, msgId), updateData);

                    // Update sidebar if this was the last message
                    if (chat && chat.lastMessage && chat.lastMessage.msgId === msgId) {
                        await updateDoc(doc(db, 'chats', chatId), sidebarUpdate);
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
                if (chat) {
                    const msg = this.currentMessages ? this.currentMessages[msgId] : null;

                    // Decrement unread counts for others if they had unread messages
                    // and this message wasn't explicitly marked as read
                    const updates = {};
                    let hasUpdates = false;
                    Object.keys(chat.unreadCounts || {}).forEach(uid => {
                        if (uid !== this.user.uid && chat.unreadCounts[uid] > 0) {
                            if (!(msg && msg.status === 'read')) {
                                updates[`unreadCounts.${uid}`] = chat.unreadCounts[uid] - 1;
                                hasUpdates = true;
                            }
                        }
                    });

                    if (chat.lastMessage && chat.lastMessage.msgId === msgId) {
                        const q = query(collection(db, `chats/${chatId}/messages`), orderBy('createdAt', 'desc'), limit(1));
                        const snap = await getDocs(q);
                        if (!snap.empty) {
                            const last = snap.docs[0].data();
                            const lastMsgId = snap.docs[0].id;
                            
                            const sidebarLabel = { 
                                ...last,
                                msgId: lastMsgId
                            };
                            if (sidebarLabel.createdAt) delete sidebarLabel.createdAt;

                            updates.lastMessage = sidebarLabel;
                            hasUpdates = true;
                        } else {
                            updates.lastMessage = null;
                            hasUpdates = true;
                        }
                    }

                    if (hasUpdates) {
                        try {
                            await updateDoc(doc(db, 'chats', chatId), updates);
                        } catch (e) {
                            console.error("Failed to update chat on msg deletion", e);
                        }
                    }
                }
            }
        );
    }

    // --- Search & Real Users ---
    // Note: Modal methods moved to ui.js

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
    // Note: Profile and About moved to settings.js


    // Note: Media and Giphy methods moved to media.js

    // Note: Time formatting moved to ui.js

    // Note: Audio helper methods moved to media.js

    // --- Elegant Glassmorphism Dialog System ---
    // Note: Dialog methods moved to ui.js

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

    // Note: App lock methods moved to settings.js

    // --- Wallpaper System ---
    // Note: Storage loaders moved to settings.js

    // Note: Settings and Wallpaper moved to settings.js

    // Note: Date formatting moved to ui.js

    // --- PWA Installation Logic ---
    // Note: PWA Install moved to ui.js

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

    // --- Attachment Menu Methods ---
    toggleAttachmentMenu(event) {
        if (event) event.stopPropagation();
        const menu = document.getElementById('attachment-menu');
        if (menu) {
            menu.classList.toggle('hidden');
        }
    }

    closeAttachmentMenu() {
        const menu = document.getElementById('attachment-menu');
        if (menu) {
            menu.classList.add('hidden');
        }
    }

    // --- Hamster Poll Methods ---
    showPollModal(chatId) {
        this.showModal(`
            <div class="modal-card" style="width: 100%; max-width: 400px; padding: 24px;">
                <h2 style="margin-bottom: 20px; font-size: 20px; font-weight: 800; color: var(--accent); display: flex; align-items: center; gap: 10px;">
                    <i data-lucide="bar-chart-2"></i> ${this.lang === 'ar' ? 'إنشاء استطلاع رأي' : 'Create Poll'}
                </h2>
                
                <div class="form-group" style="margin-bottom: 24px;">
                    <label style="display: block; font-size: 13px; font-weight: 700; color: var(--text-secondary); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
                        ${this.lang === 'ar' ? 'سؤال الهامستر' : 'Hamster Question'}
                    </label>
                    <input type="text" id="poll-question-input" placeholder="${this.lang === 'ar' ? 'ما هو استطلاعك؟' : 'What is your poll about?'}" style="width: 100%; padding: 12px 16px; border-radius: 12px; border: 1px solid var(--glass-border); background: var(--glass-bg); color: var(--text-primary); font-family: inherit;">
                </div>

                <div id="poll-options-inputs-container">
                    <label style="display: block; font-size: 13px; font-weight: 700; color: var(--text-secondary); margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;">
                        ${this.lang === 'ar' ? 'الخيارات' : 'Options'}
                    </label>
                    <div id="poll-inputs-list">
                        <!-- Options will be added here -->
                    </div>
                </div>

                <div style="margin-top: 24px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                    <button class="glass-btn secondary" style="width: 100%;" onclick="app.closeModal()">${this.t('dismiss')}</button>
                    <button class="glass-btn primary" style="width: 100%;" onclick="app.sendPoll('${chatId}')">${this.lang === 'ar' ? 'إرسال الاستطلاع' : 'Cast Poll'}</button>
                </div>
            </div>
        `);
        
        // Add initial 2 options
        this.addPollOptionRow();
        this.addPollOptionRow();
        lucide.createIcons();
    }

    addPollOptionRow() {
        const container = document.getElementById('poll-inputs-list');
        if (!container) return;
        
        const index = container.children.length + 1;
        const row = document.createElement('div');
        row.className = 'poll-creator-option-row';
        row.innerHTML = `
            <input type="text" class="poll-opt-input" placeholder="${this.lang === 'ar' ? 'خيار ' : 'Option '}${index}" style="width: 100%; padding: 12px 16px; border-radius: 12px; border: 1px solid var(--glass-border); background: var(--glass-bg); color: var(--text-primary);">
            ${index > 2 ? `<button class="glass-btn secondary" onclick="this.parentElement.remove()" style="padding: 0; color: var(--danger);"><i data-lucide="trash-2" style="width: 18px;"></i></button>` : ''}
        `;
        
        // Insert before the last child if it's the add button? No, I'll just append.
        container.appendChild(row);

        // Add the "Add Option" button if not already there or move it to end
        let addBtn = document.getElementById('add-poll-opt-btn');
        if (addBtn) addBtn.remove();
        
        const addBtnRow = document.createElement('div');
        addBtnRow.id = 'add-poll-opt-btn';
        addBtnRow.style.marginTop = '8px';
        addBtnRow.innerHTML = `
            <button class="glass-btn secondary" style="width: 100%; height: 44px; border-style: dashed;" onclick="app.addPollOptionRow()">
                <i data-lucide="plus" style="width: 16px; margin-right: 4px;"></i> ${this.lang === 'ar' ? 'إضافة خيار' : 'Add Option'}
            </button>
        `;
        container.appendChild(addBtnRow);
        lucide.createIcons({ node: container });
    }

    async sendPoll(chatId) {
        const question = document.getElementById('poll-question-input')?.value.trim();
        const optionInputs = document.querySelectorAll('.poll-opt-input');
        const options = Array.from(optionInputs).map(i => i.value.trim()).filter(v => v !== '');

        if (!question || options.length < 2) {
            return this.showAlert(this.lang === 'ar' ? 'خطأ' : 'Incomplete', this.lang === 'ar' ? 'يرجى إدخال سؤال وخيارين على الأقل.' : 'Please enter a question and at least 2 options.');
        }

        const pollPayload = {
            type: 'poll',
            question,
            options: options.map(opt => ({ text: opt, votes: [] })),
            status: 'active'
        };

        try {
            const batch = writeBatch(db);
            const msgRef = doc(collection(db, `chats/${chatId}/messages`));
            
            const payload = {
                chatId, senderId: this.user.uid, createdAt: serverTimestamp(), status: 'sent',
                ...pollPayload
            };

            batch.set(msgRef, payload);
            batch.set(doc(db, 'chats', chatId), {
                lastMessage: { text: `📊 ${question}`, senderId: this.user.uid, msgId: msgRef.id },
                ...this.getUnreadCountsUpdate(chat),
                updatedAt: serverTimestamp()
            }, { merge: true });

            await batch.commit();
            this.closeModal();
            this.scrollToBottom();
        } catch (e) {
            console.error("Poll send failed", e);
        }
    }

    async voteInPoll(chatId, msgId, optionIdx) {
        const msgRef = doc(db, `chats/${chatId}/messages`, msgId);
        try {
            const snap = await getDoc(msgRef);
            if (!snap.exists()) return;
            const data = snap.data();
            const options = [...data.options];

            // Toggle vote: Remove from all options, then add to selected if it wasn't there
            let alreadyVotedThis = false;
            options.forEach((opt, idx) => {
                if (!opt.votes) opt.votes = [];
                if (idx === optionIdx && opt.votes.includes(this.user.uid)) {
                    alreadyVotedThis = true;
                }
                opt.votes = opt.votes.filter(uid => uid !== this.user.uid);
            });

            if (!alreadyVotedThis) {
                options[optionIdx].votes.push(this.user.uid);
            }

            await updateDoc(msgRef, { options });
        } catch (e) {
            console.error("Vote failed", e);
        }
    }

    // --- Admin Dashboard (Abuse Reports) ---
    // Note: Admin logic moved to admin.js

    // --- Agora Voice & Video Call Logic ---

    // Note: Call methods moved to calls.js

    getUnreadCountsUpdate(chat) {
        if (!chat) return {};
        const unreadCounts = chat.unreadCounts || {};
        chat.memberIds.forEach(id => {
            if (id !== this.user.uid) {
                unreadCounts[id] = (unreadCounts[id] || 0) + 1;
            }
        });
        return { unreadCounts };
    }

}


extendAuth(HamsterApp);
extendCalls(HamsterApp);
extendAI(HamsterApp);
extendStories(HamsterApp);
extendUI(HamsterApp);
extendSettings(HamsterApp);
extendAdmin(HamsterApp);
extendMedia(HamsterApp);
extendE2E(HamsterApp);

// Global Execution
const app = new HamsterApp();
window.app = app;